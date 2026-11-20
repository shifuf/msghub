package com.shifuf.prism.push

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import cn.jiguang.api.utils.JCollectionAuth
import cn.jpush.android.api.BasicPushNotificationBuilder
import cn.jpush.android.api.JPushInterface
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.BuildConfig
import com.shifuf.prism.R
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * JPush helper — all heavy work runs off the main thread.
 * Master Secret must NEVER ship in the APK.
 */
object JPushHelper {
    private const val TAG = "PrismJPush"
    private const val PREF = "jpush_prefs"
    private const val KEY_REG_ID = "registration_id"
    private const val KEY_KEEP_ALIVE = "keep_alive"
    private const val KEY_LAST_STATUS = "last_status"
    private const val KEY_ENABLED = "push_enabled"

    private val io = Executors.newSingleThreadExecutor { r ->
        Thread(r, "prism-jpush").apply { isDaemon = true; priority = Thread.NORM_PRIORITY - 1 }
    }
    private val main = Handler(Looper.getMainLooper())
    private val initStarted = AtomicBoolean(false)
    private val fullyReady = AtomicBoolean(false)
    private val initLock = Any()
    private val initCallbacks = mutableListOf<(Boolean) -> Unit>()

    @Volatile private var cachedRid: String = ""
    @Volatile private var connected = false
    @Volatile private var retryAttempt = 0

    fun isEnabled(context: Context): Boolean = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        .getBoolean(KEY_ENABLED, true)

    fun onConnectionChanged(context: Context, value: Boolean) {
        connected = value
        DevicePlatformClient.updateHeartbeat(context)
    }

    fun init(context: Context, privacyAgreed: Boolean = true, onComplete: ((Boolean) -> Unit)? = null) {
        val app = context.applicationContext
        // Only the main process owns lifecycle decisions. The SDK manages :pushcore.
        if (!PushProcess.isMainProcess(app)) {
            onComplete?.let { main.post { it(false) } }
            return
        }
        if (!privacyAgreed) {
            appendStatusAsync(app, "privacy=false")
            onComplete?.let { main.post { it(false) } }
            return
        }
        val start = synchronized(initLock) {
            if (fullyReady.get()) {
                onComplete?.let { main.post { it(true) } }
                false
            } else {
                if (onComplete != null) initCallbacks += onComplete
                initStarted.compareAndSet(false, true)
            }
        }
        if (!start) return

        // Never block UI thread with JPush network/native init
        io.execute {
            runCatching {
                // Channel create is cheap; keep it off UI too
                PushNotifier.ensureChannel(app)
                JCollectionAuth.setAuth(app, true)
                // Debug mode floods logs and slows the whole process — only for debug builds
                JPushInterface.setDebugMode(BuildConfig.DEBUG)
                runCatching {
                    val builder = BasicPushNotificationBuilder(app)
                    builder.statusBarDrawable = R.drawable.jpush_notification_icon
                    builder.notificationDefaults =
                        android.app.Notification.DEFAULT_SOUND or
                            android.app.Notification.DEFAULT_VIBRATE or
                            android.app.Notification.DEFAULT_LIGHTS
                    JPushInterface.setDefaultPushNotificationBuilder(builder)
                }
                JPushInterface.init(app)
                if (isEnabled(app)) JPushInterface.resumePush(app) else JPushInterface.stopPush(app)
                runCatching { JPushInterface.setLatestNotificationNumber(app, 5) }
                val rid = JPushInterface.getRegistrationID(app).orEmpty()
                if (rid.isNotBlank()) saveRegistrationId(app, rid)
                fullyReady.set(true)
                retryAttempt = 0
                completeInit(true)
                appendStatusAsync(app, if (rid.isBlank()) "JPush ready; waiting for registration" else "JPush ready; registration ID available")
                Log.i(TAG, "JPush ready; registration ID available=${rid.isNotBlank()}")
                DevicePlatformClient.updateHeartbeat(app)
                if (isEnabled(app) && isKeepAliveEnabled(app)) {
                    // start keep-alive later on main, but not immediately
                    main.postDelayed({
                        runCatching { PushKeepAliveService.start(app) }
                    }, 2500L)
                }
            }.onFailure {
                initStarted.set(false)
                fullyReady.set(false)
                completeInit(false)
                appendStatusAsync(app, "init FAILED: ${it.javaClass.simpleName}")
                Log.e(TAG, "JPush init failed: ${it.javaClass.simpleName}")
                if (isEnabled(app) && retryAttempt < 5) {
                    val delay = (5000L shl retryAttempt++).coerceAtMost(120000L)
                    main.postDelayed({ init(app, true) }, delay)
                }
            }
        }
    }

    private fun completeInit(success: Boolean) {
        val callbacks = synchronized(initLock) { initCallbacks.toList().also { initCallbacks.clear() } }
        callbacks.forEach { callback -> main.post { runCatching { callback(success) } } }
    }

    fun registrationId(context: Context = BrowserApp.instance): String {
        // Refresh on the worker; a stored RID can be obsolete after SDK registration changes.
        if (fullyReady.get()) io.execute {
            val live = runCatching { JPushInterface.getRegistrationID(context.applicationContext) }.getOrNull().orEmpty()
            if (live.isNotBlank() && live != cachedRid) saveRegistrationId(context, live)
        }
        if (cachedRid.isNotBlank()) return cachedRid
        val cached = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getString(KEY_REG_ID, "").orEmpty()
        if (cached.isNotBlank()) {
            cachedRid = cached
            return cached
        }
        return ""
    }

    fun saveRegistrationId(context: Context, rid: String) {
        if (rid.isBlank()) return
        cachedRid = rid
        io.execute {
            context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_REG_ID, rid)
                .apply()
        }
        Log.i(TAG, "registration ID saved")
    }

    fun setAlias(context: Context, alias: String, sequence: Int = 1) {
        io.execute {
            runCatching { JPushInterface.setAlias(context.applicationContext, sequence, alias) }
        }
    }

    fun stop(context: Context) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).apply()
        connected = false
        io.execute {
            runCatching { if (!isEnabled(context)) JPushInterface.stopPush(context.applicationContext) }
        }
        PushKeepAliveService.stop(context)
        DevicePlatformClient.updateHeartbeat(context)
    }

    fun resume(context: Context) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, true).apply()
        // Lightweight — never re-run full init on UI
        if (!fullyReady.get()) {
            init(context, true)
            DevicePlatformClient.updateHeartbeat(context)
            return
        }
        DevicePlatformClient.updateHeartbeat(context)
        io.execute {
            runCatching {
                val app = context.applicationContext
                if (isEnabled(app)) {
                    JPushInterface.resumePush(app)
                    if (isKeepAliveEnabled(app)) PushKeepAliveService.start(app)
                }
            }
        }
    }

    fun isPushStopped(context: Context): Boolean = !isEnabled(context)

    fun recover(context: Context) {
        val app = context.applicationContext
        if (!isEnabled(app) || !PushProcess.isMainProcess(app)) return
        if (!fullyReady.get()) { init(app, true); return }
        io.execute {
            runCatching {
                if (isEnabled(app)) JPushInterface.resumePush(app)
                val rid = JPushInterface.getRegistrationID(app).orEmpty()
                if (rid.isNotBlank()) saveRegistrationId(app, rid)
                connected = runCatching { JPushInterface.getConnectionState(app) }.getOrDefault(connected)
                DevicePlatformClient.updateHeartbeat(app)
            }.onFailure { appendStatusAsync(app, "恢复连接失败：${it.javaClass.simpleName}") }
        }
    }

    fun isConnected(context: Context): Boolean =
        connected && isEnabled(context)

    fun isKeepAliveEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getBoolean(KEY_KEEP_ALIVE, true)

    fun setKeepAliveEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_KEEP_ALIVE, enabled)
            .apply()
        if (enabled && isEnabled(context)) PushKeepAliveService.start(context) else PushKeepAliveService.stop(context)
    }

    fun lastStatus(context: Context): String =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getString(KEY_LAST_STATUS, "").orEmpty()
            .replace(Regex("(?i)rid\\s*=\\s*[^\\s\\r\\n]+"), "registration ID available")

    private fun appendStatusAsync(context: Context, line: String) {
        io.execute {
            runCatching {
                val sp = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                val prev = sp.getString(KEY_LAST_STATUS, "").orEmpty()
                val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
                    .format(java.util.Date())
                sp.edit().putString(KEY_LAST_STATUS, ("[$ts] $line\n$prev").take(1200)).apply()
            }
        }
    }

    fun diagnosticText(context: Context): String {
        val rid = registrationId(context)
        val proc = PushProcess.currentProcessName(context) ?: "?"
        return buildString {
            appendLine("包名：${context.packageName}")
            appendLine("进程：$proc")
            appendLine("RID：${if (rid.isBlank()) "等待连接/初始化" else "已获取"}")
            appendLine("已就绪：${fullyReady.get()}")
            appendLine("当前连接：${isConnected(context)}")
            appendLine("推送停止：${isPushStopped(context)}")
            appendLine("后台保活：${isKeepAliveEnabled(context)}")
            appendLine("通知权限：${notificationAllowed(context)}")
            appendLine("消息渠道：${PushNotifier.channelStatus(context)}")
            appendLine(DevicePlatformClient.diagnosticStatus(context))
            appendLine("电池优化忽略：${batteryOptIgnored(context)}")
            appendLine()
            appendLine("—— 最近状态 ——")
            append(lastStatus(context).ifBlank { "(无)" })
        }
    }

    private fun notificationAllowed(context: Context): String =
        try {
            if (androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled())
                "已开启" else "未开启"
        } catch (_: Exception) {
            "?"
        }

    private fun batteryOptIgnored(context: Context): String =
        try {
            if (android.os.Build.VERSION.SDK_INT < 23) "N/A"
            else {
                val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                if (pm.isIgnoringBatteryOptimizations(context.packageName)) "是" else "否"
            }
        } catch (_: Exception) {
            "?"
        }
}
