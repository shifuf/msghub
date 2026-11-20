package com.shifuf.prism.push

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import cn.jpush.android.api.JPushInterface
import com.shifuf.prism.MainActivity
import com.shifuf.prism.R
import com.shifuf.prism.ui.PushHistoryActivity

/**
 * Keep JPush long-connection alive.
 * Shows a low-priority persistent notification with clear text (required by Android FGS).
 * Real push messages use a separate high-importance channel.
 */
class PushKeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        if (!startAsForegroundSafe()) {
            stopSelf()
            return
        }
        // Init is async inside JPushHelper — just nudge it
        JPushHelper.init(this, privacyAgreed = true)
        Log.i(TAG, "keep-alive service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!JPushHelper.isEnabled(this) || !JPushHelper.isKeepAliveEnabled(this)) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        JPushHelper.init(this)
        return START_STICKY
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        // Clean old channel ids
        listOf("prism_push_keepalive", "prism_svc_hidden", "prism_conn_min").forEach {
            runCatching { nm.deleteNotificationChannel(it) }
        }
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(
            CHANNEL_ID,
            "后台保活",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "保持推送连接（非消息）"
            setShowBadge(false)
            enableVibration(false)
            enableLights(false)
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
        nm.createNotificationChannel(ch)
    }

    private fun startAsForegroundSafe(): Boolean {
        val openHistory = PendingIntent.getActivity(
            this,
            1,
            Intent(this, PushHistoryActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val openApp = PendingIntent.getActivity(
            this,
            2,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.jpush_notification_icon)
            .setContentTitle("棱镜 · 后台服务")
            .setContentText("保持推送连接中")
            .setContentIntent(openApp)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .addAction(0, "推送历史", openHistory)
            .addAction(0, "打开应用", openApp)
            .build()
        return try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                    NOTIF_ID,
                    notif,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIF_ID, notif)
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed: ${e.message}", e)
            false
        }
    }

    companion object {
        private const val TAG = "PrismPushKeepAlive"
        private const val NOTIF_ID = 19001
        const val CHANNEL_ID = "prism_keepalive_low"

        fun start(context: Context) {
            val app = context.applicationContext
            // Defer so we never race UI startup on main thread
            Handler(Looper.getMainLooper()).post {
                if (!JPushHelper.isEnabled(app) || !JPushHelper.isKeepAliveEnabled(app)) return@post
                val i = Intent(app, PushKeepAliveService::class.java)
                runCatching {
                    if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(i)
                    else app.startService(i)
                }.onFailure { Log.e(TAG, "start failed: ${it.message}", it) }
            }
        }

        fun stop(context: Context) {
            runCatching {
                context.applicationContext.stopService(
                    Intent(context.applicationContext, PushKeepAliveService::class.java)
                )
            }
        }
    }
}
