package com.shifuf.prism.push

import android.content.Context
import android.content.Intent
import android.util.Log
import cn.jpush.android.api.CmdMessage
import cn.jpush.android.api.CustomMessage
import cn.jpush.android.api.JPushInterface
import cn.jpush.android.api.JPushMessage
import cn.jpush.android.api.NotificationMessage
import cn.jpush.android.service.JPushMessageReceiver
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.MainActivity

/**
 * JPush callbacks.
 * notification 由极光/系统自己上通知栏，禁止再补本地通知（否则每条显示 2 次）。
 * custom message 无系统托盘，才本地补一条。
 */
class PrismPushMessageReceiver : JPushMessageReceiver() {
    override fun onRegister(context: Context, registrationId: String) {
        Log.i(TAG, "JPush registered; ID available=${registrationId.isNotBlank()}")
        JPushHelper.saveRegistrationId(context, registrationId)
        PushNotifier.ensureChannel(context)
        DevicePlatformClient.updateHeartbeat(context)
    }

    override fun onMessage(context: Context, customMessage: CustomMessage) {
        if (!JPushHelper.isEnabled(context)) return
        PushNotifier.ensureChannel(context)
        val title = customMessage.title?.takeIf { it.isNotBlank() } ?: "自定义消息"
        val content = customMessage.message.orEmpty()
        val extras = customMessage.extra.orEmpty()
        DevicePlatformClient.recordReceipt(context, extras, pendingResult = goAsync())
        val msgId = resolveDedupeId(customMessage.messageId.orEmpty(), extras, "custom")
        val result = history(context).receive(
            title = title,
            content = content,
            extras = extras,
            kind = "custom",
            messageId = msgId,
        )
        if (!result.inserted) return
        val item = result.item
        // 仅自定义消息需要本地通知（系统不会自动展示）
        val notificationId = PushNotifier.show(
            context,
            title = title,
            content = content.ifBlank { "(空消息)" },
            historyId = item.id,
            openUrl = PushPayload.openUrl(extras),
        )
        DevicePlatformClient.observePostedNotification(context, extras, notificationId)
    }

    override fun onNotifyMessageArrived(context: Context, message: NotificationMessage) {
        if (!JPushHelper.isEnabled(context)) {
            PushNotifier.cancel(context, message.notificationId)
            return
        }
        Log.i(TAG, "JPush notification received; ID=${message.notificationId}")
        PushNotifier.ensureChannel(context)
        val title = message.notificationTitle.orEmpty().ifBlank { "通知" }
        val content = message.notificationContent.orEmpty()
        val extras = message.notificationExtras.orEmpty()
        DevicePlatformClient.recordReceipt(context, extras, pendingResult = goAsync())
        DevicePlatformClient.observePostedNotification(context, extras, message.notificationId)
        val msgId = resolveDedupeId(message.msgId.orEmpty(), extras, "notification")
        // 只记历史，不二次弹本地通知 —— 极光 notification 已在通知栏
        val result = history(context).receive(
            title = title,
            content = content,
            extras = extras,
            kind = "notification",
            messageId = msgId,
            notifId = message.notificationId,
        )
        if (result.item.read) PushNotifier.cancel(context, message.notificationId)
        super.onNotifyMessageArrived(context, message)
    }

    override fun onNotifyMessageUnShow(context: Context, message: NotificationMessage) {
        Log.i(TAG, "JPush notification was not displayed; ID=${message.notificationId}")
        DevicePlatformClient.recordReceipt(context, message.notificationExtras.orEmpty(), pendingResult = goAsync())
        super.onNotifyMessageUnShow(context, message)
    }

    override fun onNotifyMessageOpened(context: Context, message: NotificationMessage) {
        val title = message.notificationTitle.orEmpty().ifBlank { "通知" }
        val content = message.notificationContent.orEmpty()
        val extras = message.notificationExtras.orEmpty()
        // Preserve callback receipt without upgrading display state after the tray item has been removed.
        DevicePlatformClient.recordReceipt(context, extras, pendingResult = goAsync())
        val baseId = resolveDedupeId(message.msgId.orEmpty(), extras, "notification")
        val store = history(context)
        val item = store.receive(
                title = title,
                content = content,
                extras = extras,
                kind = "opened",
                messageId = baseId,
                notifId = message.notificationId,
            ).item
        runCatching {
            val i = Intent(context, com.shifuf.prism.ui.PushHistoryActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(com.shifuf.prism.ui.PushHistoryActivity.EXTRA_OPEN_ID, item.id)
            }
            context.startActivity(i)
        }.onFailure {
            Log.e(TAG, "open push failed", it)
            runCatching {
                context.startActivity(
                    Intent(context, com.shifuf.prism.ui.PushHistoryActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }

    override fun onNotifyMessageDismiss(context: Context, message: NotificationMessage) {
        Log.i(TAG, "onNotifyMessageDismiss")
    }

    override fun onConnected(context: Context, isConnected: Boolean) {
        Log.i(TAG, "onConnected: $isConnected")
        JPushHelper.onConnectionChanged(context, isConnected)
        if (isConnected) {
            val rid = JPushInterface.getRegistrationID(context)
            if (!rid.isNullOrBlank()) JPushHelper.saveRegistrationId(context, rid)
        }
    }

    override fun onCommandResult(context: Context, cmdMessage: CmdMessage) {
        Log.i(TAG, "JPush command completed: ${cmdMessage.cmd}")
    }

    override fun onTagOperatorResult(context: Context, jPushMessage: JPushMessage) {
        Log.i(TAG, "JPush tag operation completed: result=${jPushMessage.errorCode}")
        super.onTagOperatorResult(context, jPushMessage)
    }

    override fun onAliasOperatorResult(context: Context, jPushMessage: JPushMessage) {
        Log.i(TAG, "JPush alias operation completed: result=${jPushMessage.errorCode}")
        super.onAliasOperatorResult(context, jPushMessage)
    }

    override fun onNotificationSettingsCheck(context: Context, isOn: Boolean, source: Int) {
        super.onNotificationSettingsCheck(context, isOn, source)
        Log.i(TAG, "onNotificationSettingsCheck isOn=$isOn source=$source")
    }

    private fun history(context: Context): PushHistoryStore {
        return runCatching { BrowserApp.instance.pushHistory }
            .getOrElse { PushHistoryStore(context.applicationContext) }
    }

    private fun resolveDedupeId(jpushMsgId: String, extras: String, kind: String): String {
        return PushPayload.dedupeId(extras, jpushMsgId).ifBlank { "${kind}_${java.util.UUID.randomUUID()}" }
    }

    companion object {
        private const val TAG = "PrismPushReceiver"
        const val EXTRA_FROM_PUSH = "prism_from_push"
    }
}
