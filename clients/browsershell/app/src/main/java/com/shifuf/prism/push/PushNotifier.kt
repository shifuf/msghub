package com.shifuf.prism.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.shifuf.prism.R
import com.shifuf.prism.ui.PushHistoryActivity

/**
 * High-priority notifications for real push messages only.
 * Keep-alive uses a separate silent channel and must never share this one.
 */
object PushNotifier {
    const val CHANNEL_ID = "prism_jpush_msg"
    private const val CHANNEL_NAME = "消息通知"
    private const val NOTIF_BASE = 0x500000

    fun channelStatus(context: Context): String {
        if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(context,
                android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return "通知权限未允许"
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return "系统通知已关闭"
        val manager = context.getSystemService(NotificationManager::class.java)
        val own = manager?.getNotificationChannel(CHANNEL_ID)
        if (own?.importance == NotificationManager.IMPORTANCE_NONE) return "消息渠道已关闭"
        val blocked = manager?.notificationChannels?.any {
            it.id != PushKeepAliveService.CHANNEL_ID && it.importance == NotificationManager.IMPORTANCE_NONE
        } == true
        if (blocked) return "部分通知渠道已关闭"
        return if (own == null) "消息渠道待初始化" else "通知已开启"
    }

    fun isMessageChannelEnabled(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.POST_NOTIFICATIONS
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return manager.getNotificationChannel(CHANNEL_ID)?.importance?.let { it != NotificationManager.IMPORTANCE_NONE } ?: false
    }

    fun isNotificationActive(context: Context, notificationId: Int): Boolean = runCatching {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return@runCatching false
        PushPayload.hasActiveNotification(manager.activeNotifications.map { it.id }.toSet(), notificationId)
    }.getOrDefault(false)

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = nm.getNotificationChannel(CHANNEL_ID)
        // Channel importance belongs to the user once created.
        if (existing != null) return
        val ch = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "推送消息"
            enableVibration(true)
            enableLights(true)
            setShowBadge(true)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(ch)
    }

    fun wakeBriefly(context: Context) {
        runCatching {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "prism:push")
            wl.acquire(3000L)
        }
    }

    fun notifIdFor(historyId: String): Int {
        // Stable positive id from history UUID
        return NOTIF_BASE + (historyId.hashCode() and 0x0FFFFF)
    }

    fun show(
        context: Context,
        title: String,
        content: String,
        historyId: String? = null,
        openUrl: String? = null
    ): Int {
        if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(context,
                android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return 0
        if (!JPushHelper.isEnabled(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return 0
        ensureChannel(context)
        wakeBriefly(context)
        val app = context.applicationContext
        val id = if (!historyId.isNullOrBlank()) notifIdFor(historyId)
        else synchronized(this) { NOTIF_BASE + (System.currentTimeMillis() % 100000).toInt() }

        val openHistory = Intent(app, PushHistoryActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (!historyId.isNullOrBlank()) putExtra(PushHistoryActivity.EXTRA_OPEN_ID, historyId)
            if (!openUrl.isNullOrBlank()) putExtra(PushHistoryActivity.EXTRA_OPEN_URL, openUrl)
        }
        val contentPi = PendingIntent.getActivity(
            app,
            id,
            openHistory,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(app, CHANNEL_ID)
            .setSmallIcon(R.drawable.jpush_notification_icon)
            .setContentTitle(title.ifBlank { "棱镜" })
            .setContentText(content)
            .setStyle(NotificationCompat.BigTextStyle().bigText(content))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setContentIntent(contentPi)
            .setOnlyAlertOnce(true)
            .build()

        val shown = runCatching {
            NotificationManagerCompat.from(app).notify(id, notif)
        }.isSuccess
        if (!shown) return 0
        if (!historyId.isNullOrBlank()) {
            runCatching {
                // Persist mapping so markRead can clear tray
                PushHistoryStore(app).bindNotificationId(historyId, id)
            }
        }
        return id
    }

    fun cancel(context: Context, notifId: Int) {
        if (notifId == 0) return
        runCatching {
            NotificationManagerCompat.from(context.applicationContext).cancel(notifId)
        }
    }

    fun cancelForHistory(context: Context, historyId: String) {
        cancel(context, notifIdFor(historyId))
        // also cancel any stored legacy id
        runCatching {
            val stored = PushHistoryStore(context).get(historyId)?.notifId ?: 0
            if (stored > 0 && stored != notifIdFor(historyId)) cancel(context, stored)
        }
    }
}
