package com.shifuf.prism.core

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.shifuf.prism.MainActivity
import com.shifuf.prism.R
import com.shifuf.prism.ui.DownloadsActivity

object DownloadNotifier {
    private const val CHANNEL_ID = "prism_downloads"
    private const val CHANNEL_NAME = "下载"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "下载完成通知"
            }
        )
    }

    fun notifyCompleted(context: Context, item: DownloadItem) {
        if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(context,
                android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        ensureChannel(context)
        val openIntent = Intent(context, DownloadsActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            context,
            item.id.toInt(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val homePi = PendingIntent.getActivity(
            context,
            (item.id + 1).toInt(),
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_download)
            .setContentTitle("下载完成")
            .setContentText(item.fileName)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${item.fileName}\n${item.url}"))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .addAction(0, "打开下载", pi)
            .addAction(0, "打开浏览器", homePi)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        runCatching {
            NotificationManagerCompat.from(context).notify(30000 + (item.id % 10000).toInt(), notif)
        }
    }

    fun notifyFailed(context: Context, item: DownloadItem) {
        if (Build.VERSION.SDK_INT >= 33 && androidx.core.content.ContextCompat.checkSelfPermission(context,
                android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        ensureChannel(context)
        val openIntent = Intent(context, DownloadsActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            context,
            item.id.toInt(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_download)
            .setContentTitle("下载失败")
            .setContentText(item.fileName)
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "${item.fileName}\n${item.error.ifBlank { "未知错误" }}"
                )
            )
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        runCatching {
            NotificationManagerCompat.from(context).notify(40000 + (item.id % 10000).toInt(), notif)
        }
    }
}
