package com.shifuf.prism.push

import android.content.Context
import android.util.Log
import com.shifuf.prism.core.PreferenceStore
import java.io.File

class PushHistoryStore(context: Context) {
    private val appContext = context.applicationContext
    private val storage = PushHistoryFile(File(appContext.filesDir, "push_history.json"))

    fun all(): List<PushHistoryItem> = runCatching { storage.all() }.getOrElse {
        Log.e("PushHistory", "Cannot read history: ${it.javaClass.simpleName}")
        emptyList()
    }
    fun get(id: String): PushHistoryItem? = all().find { it.id == id }
    fun unreadCount(): Int = all().count { !it.read }
    fun reloadFromDisk() = Unit // Every transaction reads the latest file.

    fun observe(onChanged: () -> Unit): android.os.FileObserver {
        val main = android.os.Handler(android.os.Looper.getMainLooper())
        @Suppress("DEPRECATION")
        val observer = object : android.os.FileObserver(appContext.filesDir.path, MOVED_TO or CLOSE_WRITE or DELETE) {
            override fun onEvent(event: Int, path: String?) {
                if (path == "push_history.json" || path == "read_receipts.json") main.post { onChanged() }
            }
        }
        observer.startWatching()
        return observer
    }

    fun receive(title: String, content: String, extras: String = "", kind: String = "notification",
                messageId: String = "", notifId: Int = 0): PushInsertResult = storage.insert(
        PushHistoryItem(title = title.ifBlank { "推送" }, content = content, extras = extras,
            kind = kind, messageId = messageId, notifId = notifId,
            receiptBase = ReadReceiptQueue.trustedBase(PreferenceStore(appContext).msgPlatformBaseUrl).orEmpty())
    ).also { result ->
        // Some SDK deliveries enrich an already opened notification with the receipt fields later.
        if (result.item.read) runCatching {
            MsgPlatformClient.markReadFromExtras(PreferenceStore(appContext), result.item.extras, result.item.receiptBase)
        }
    }

    fun add(title: String, content: String, extras: String = "", kind: String = "notification",
            messageId: String = ""): PushHistoryItem = receive(title, content, extras, kind, messageId).item

    fun markRead(id: String) {
        // Persist the receipt before changing local state so a process death cannot lose it.
        val before = get(id) ?: return
        runCatching { MsgPlatformClient.markReadFromExtras(PreferenceStore(appContext), before.extras, before.receiptBase) }
            .onFailure { Log.w("PushHistory", "Receipt could not be queued") }
        val item = storage.update { items ->
            val index = items.indexOfFirst { it.id == id }
            if (index < 0) null else items[index].also { items[index] = it.copy(read = true) }
        } ?: return
        cancel(item)
        // Reopening a locally read item can retry a previously failed receipt.
    }

    fun markAllRead() {
        all().forEach { runCatching { MsgPlatformClient.markReadFromExtras(PreferenceStore(appContext), it.extras, it.receiptBase) } }
        val unread = storage.update { items ->
            val snapshot = items.filter { !it.read }
            items.indices.forEach { items[it] = items[it].copy(read = true) }
            snapshot
        }
        unread.forEach {
            cancel(it)
        }
    }

    fun bindNotificationId(id: String, notifId: Int) = storage.update { items ->
        val index = items.indexOfFirst { it.id == id }
        if (index >= 0) items[index] = items[index].copy(notifId = notifId)
    }

    fun remove(id: String) {
        val removed = storage.update { items -> items.find { it.id == id }?.also { items.remove(it) } }
        removed?.let { cancel(it) }
    }

    fun clear() {
        val removed = storage.update { items -> items.toList().also { items.clear() } }
        removed.forEach { cancel(it) }
    }

    private fun cancel(item: PushHistoryItem) {
        PushNotifier.cancel(appContext, PushNotifier.notifIdFor(item.id))
        if (item.notifId != 0) PushNotifier.cancel(appContext, item.notifId)
    }
}
