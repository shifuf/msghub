package com.shifuf.prism.push

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.shifuf.prism.BuildConfig
import com.shifuf.prism.core.PreferenceStore
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Pairing, heartbeat and signed per-message receipts for msg.shifuf.com. */
object DevicePlatformClient {
    private const val TAG = "PrismDeviceApi"
    private const val CONNECT_TIMEOUT = 12000
    private const val READ_TIMEOUT = 12000
    private const val MAX_RESPONSE = 64 * 1024
    private const val OBSERVATION_ATTEMPTS = 15

    private val workers = DeviceWorkExecutors()
    private val io = workers.network
    private val receiptIo = workers.receipts
    private val main = Handler(Looper.getMainLooper())
    private val drainLock = Any()
    private var draining = false
    private val drainCallbacks = mutableListOf<(Boolean) -> Unit>()
    @Volatile private var retryDelaySeconds = 30L
    @Volatile private var retryScheduled: java.util.concurrent.ScheduledFuture<*>? = null

    fun pair(context: Context, code: String, onComplete: (Result<String>) -> Unit) {
        val app = context.applicationContext
        val callback = onComplete
        if (!DevicePlatformProtocol.isPairCode(code)) {
            main.post { callback(Result.failure(IllegalArgumentException("配对码需要 16 位十六进制字符"))) }
            return
        }
        io.execute {
            val result = runCatching {
                val rid = JPushHelper.registrationId(app)
                val body = pairBody(app, code, rid)
                val response = post("/api/device/pair", body)
                if (response.code !in 200..299) throw ApiFailure(response.code)
                val (id, token) = DevicePlatformProtocol.parsePairResponse(response.body)
                DevicePairingStore(app).apply {
                    save(id, token)
                    status = "设备已关联 · 连接状态待同步"
                }
                id
            }.onFailure {
                Log.w(TAG, "Device pairing failed: ${it.javaClass.simpleName}")
            }
            if (result.isSuccess) {
                DeviceSyncJobService.schedule(app)
                retryPending(app)
            }
            main.post { callback(result.map { "设备已关联 · ${shortId(it)}" }) }
        }
    }

    /** Called when network, app, or push connection state may have changed. */
    fun updateHeartbeat(context: Context) {
        val app = context.applicationContext
        val store = DevicePairingStore(app)
        if (store.hasEncryptedToken) {
            store.heartbeatPending = true
            DeviceSyncJobService.schedule(app)
        }
        retryPending(app)
    }

    /** Persist receipt evidence immediately, then deliver it off the JPush callback thread. */
    fun recordReceipt(
        context: Context,
        extras: String,
        pendingResult: BroadcastReceiver.PendingResult? = null,
    ) {
        val app = context.applicationContext
        if (!JPushHelper.isEnabled(app)) { pendingResult?.finish(); return }
        val immediateRid = JPushHelper.registrationId(app)
        val immediateToken = PushPayload.receivedToken(extras, immediateRid)
        if (immediateToken == null && immediateRid.isNotBlank()) { pendingResult?.finish(); return }
        receiptIo.execute {
            try {
                val rid = immediateRid.ifBlank {
                    runCatching { cn.jpush.android.api.JPushInterface.getRegistrationID(app) }.getOrNull().orEmpty()
                }
                val receivedToken = immediateToken ?: PushPayload.receivedToken(extras, rid) ?: return@execute
                if (rid.isBlank()) return@execute
                PreferenceStore(app).deviceReceiptQueue().enqueue(receivedToken, rid)
                DeviceSyncJobService.schedule(app)
            } catch (error: Exception) {
                Log.w(TAG, "Could not persist push receipt: ${error.javaClass.simpleName}")
            } finally {
                pendingResult?.finish()
                retryPending(app)
            }
        }
    }

    /** Poll the system tray for an exact SDK notification ID; callback arrival alone is insufficient. */
    fun observePostedNotification(context: Context, extras: String, notificationId: Int) {
        if (notificationId <= 0) return
        val app = context.applicationContext
        if (!JPushHelper.isEnabled(app)) return
        val observed = AtomicBoolean(false)
        repeat(OBSERVATION_ATTEMPTS) { index ->
            receiptIo.schedule({
                if (observed.get()) return@schedule
                if (!JPushHelper.isEnabled(app)) { observed.set(true); return@schedule }
                val rid = JPushHelper.registrationId(app)
                    .ifBlank { runCatching { cn.jpush.android.api.JPushInterface.getRegistrationID(app) }.getOrNull().orEmpty() }
                val receivedToken = PushPayload.receivedToken(extras, rid)
                if (receivedToken != null && PushNotifier.isNotificationActive(app, notificationId)) {
                    val queue = PreferenceStore(app).deviceReceiptQueue()
                    if (queue.markDisplayed(receivedToken, rid)) {
                        DeviceSyncJobService.schedule(app)
                        retryPending(app)
                    }
                    observed.set(true)
                }
            }, index.toLong(), TimeUnit.SECONDS)
        }
    }

    fun retryPending(context: Context, onComplete: ((Boolean) -> Unit)? = null) {
        val app = context.applicationContext
        synchronized(drainLock) {
            if (onComplete != null) drainCallbacks += onComplete
            if (draining) return
            draining = true
            retryScheduled?.cancel(false)
            retryScheduled = null
        }
        io.execute {
            val pairing = DevicePairingStore(app)
            val queue = PreferenceStore(app).deviceReceiptQueue()
            try {
                val currentRid = JPushHelper.registrationId(app)
                if (currentRid.isNotBlank()) queue.resolveRegistrationId(currentRid)
                for (receipt in queue.pending()) {
                    if (sendReceipt(app, pairing, receipt)) queue.acknowledge(receipt)
                }
                if (pairing.hasEncryptedToken && pairing.heartbeatPending && currentRid.isNotBlank()) {
                    sendHeartbeat(app, pairing, currentRid)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Pending device synchronization failed: ${e.javaClass.simpleName}")
            } finally {
                val pending = runCatching { queue.pending().isNotEmpty() }.getOrDefault(true) ||
                    (pairing.hasEncryptedToken && pairing.heartbeatPending)
                val callbacks = synchronized(drainLock) {
                    draining = false
                    if (pending) {
                        retryScheduled = io.schedule({ retryPending(app) }, retryDelaySeconds, TimeUnit.SECONDS)
                        retryDelaySeconds = (retryDelaySeconds * 2).coerceAtMost(900L)
                    } else retryDelaySeconds = 30L
                    drainCallbacks.toList().also { drainCallbacks.clear() }
                }
                callbacks.forEach { callback -> main.post { runCatching { callback(pending) } } }
            }
        }
    }

    fun diagnosticStatus(context: Context): String {
        val pairing = DevicePairingStore(context)
        if (!pairing.hasEncryptedToken) return "设备关联：未关联"
        val status = pairing.status.ifBlank { "已关联" }
        return "设备关联：$status" + if (pairing.heartbeatPending) " · 连接状态待同步" else ""
    }

    fun pairingLabel(context: Context): String {
        return DevicePairingStore(context).pairingLabel()
    }

    private fun pairBody(context: Context, code: String, registrationId: String): JSONObject =
        DevicePlatformProtocol.pairBody(
            code = code,
            registrationId = registrationId,
            appKey = BuildConfig.JPUSH_APPKEY,
            name = Build.MODEL,
            appVersion = BuildConfig.VERSION_NAME,
            osVersion = Build.VERSION.RELEASE,
            notificationsEnabled = notificationsEnabled(context),
            channelEnabled = PushNotifier.isMessageChannelEnabled(context),
            connected = JPushHelper.isConnected(context),
        )

    private fun heartbeatBody(context: Context, registrationId: String): JSONObject =
        DevicePlatformProtocol.heartbeatBody(
            registrationId = registrationId,
            appKey = BuildConfig.JPUSH_APPKEY,
            appVersion = BuildConfig.VERSION_NAME,
            osVersion = Build.VERSION.RELEASE,
            notificationsEnabled = notificationsEnabled(context),
            channelEnabled = PushNotifier.isMessageChannelEnabled(context),
            connected = JPushHelper.isConnected(context),
        )

    private fun sendHeartbeat(context: Context, pairing: DevicePairingStore, registrationId: String) {
        val token = pairing.token
        if (token.isBlank()) { pairing.revoke(); return }
        val response = post("/api/device/heartbeat", heartbeatBody(context, registrationId), token)
        when {
            response.code == 401 -> {
                pairing.revoke()
                Log.i(TAG, "Device heartbeat reported revoked credentials")
            }
            response.code !in 200..299 -> throw ApiFailure(response.code)
            !DevicePlatformProtocol.isAcknowledged(response.body) -> throw IllegalStateException("Unconfirmed device heartbeat")
            else -> {
                pairing.heartbeatPending = false
                pairing.status = "设备已关联 · 心跳正常"
            }
        }
    }

    private fun sendReceipt(context: Context, pairing: DevicePairingStore, receipt: DeviceReceipt): Boolean {
        val body = DevicePlatformProtocol.receiptBody(receipt.receivedToken, receipt.registrationId, receipt.displayed)
        val token = pairing.token.takeIf { pairing.hasEncryptedToken }
        var response = post("/api/device/receipts", body, token)
        // Message signatures independently authorize receipts; a revoked device session must not strand them.
        if (response.code == 401 && !token.isNullOrBlank()) response = post("/api/device/receipts", body)
        return response.code in 200..299 && DevicePlatformProtocol.isAcknowledged(response.body)
    }

    private fun post(path: String, body: JSONObject, bearer: String? = null): ApiResponse {
        var connection: HttpURLConnection? = null
        try {
            val conn = (URL(DevicePlatformProtocol.BASE_URL + path).openConnection() as HttpURLConnection).also { connection = it }
            conn.apply {
                requestMethod = "POST"
                connectTimeout = CONNECT_TIMEOUT
                readTimeout = READ_TIMEOUT
                doOutput = true
                instanceFollowRedirects = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
                if (!bearer.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $bearer")
            }
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) return ApiResponse(code, "")
            val stream = conn.inputStream
            val bytes = stream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (output.size() <= MAX_RESPONSE) {
                    val count = input.read(buffer, 0, minOf(buffer.size, MAX_RESPONSE + 1 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            if (bytes.size > MAX_RESPONSE) throw IllegalStateException("Device response too large")
            return ApiResponse(code, String(bytes, Charsets.UTF_8))
        } finally {
            connection?.disconnect()
        }
    }

    private fun notificationsEnabled(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    private fun shortId(value: String): String = if (value.length <= 12) value else value.take(8) + "…"

    private data class ApiResponse(val code: Int, val body: String)
    private class ApiFailure(val code: Int) : Exception("消息平台请求失败（$code）")
}
