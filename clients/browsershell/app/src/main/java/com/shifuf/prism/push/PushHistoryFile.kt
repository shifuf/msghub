package com.shifuf.prism.push

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

data class PushHistoryItem(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val content: String,
    val extras: String = "",
    val kind: String = "notification",
    val messageId: String = "",
    val receivedAt: Long = System.currentTimeMillis(),
    val read: Boolean = false,
    val notifId: Int = 0,
    val receiptBase: String = ""
)

data class PushInsertResult(val item: PushHistoryItem, val inserted: Boolean)

/** A stable sidecar lock protects read-modify-replace across processes. */
class PushHistoryFile(private val file: File) {
    companion object { private val processLock = Any() }

    private fun <T> transaction(block: () -> T): T = synchronized(processLock) {
        file.parentFile?.mkdirs()
        RandomAccessFile(File(file.path + ".lock"), "rw").use { handle ->
            handle.channel.lock().use { block() }
        }
    }

    fun all(): List<PushHistoryItem> = transaction { read() }

    fun <T> update(block: (MutableList<PushHistoryItem>) -> T): T = transaction {
        val items = read()
        val result = block(items)
        write(items)
        result
    }

    fun insert(item: PushHistoryItem): PushInsertResult = update { items ->
        val capability = PushPayload.conversationFields(item.extras)
        val knownConversation = capability?.let { credentials ->
            items.firstOrNull {
                PushPayload.conversationFields(it.extras) == credentials
            }
        }
        // Reply delivery can occur after platform settings changed. Its credentials belong to
        // the original conversation, never the host currently selected in settings.
        val received = when {
            knownConversation != null -> item.copy(receiptBase = knownConversation.receiptBase)
            PushPayload.replyId(item.extras) != null -> item.copy(receiptBase = "")
            else -> item
        }
        val identity = PushPayload.dedupeId(item.extras, item.messageId)
        val existing = items.firstOrNull {
            identity.isNotBlank() && PushPayload.dedupeId(it.extras, it.messageId) == identity
        }
        if (existing != null) {
            val merged = existing.copy(
                extras = mergeExtras(existing.extras, item.extras),
                notifId = if (item.notifId != 0) item.notifId else existing.notifId
            )
            items[items.indexOf(existing)] = merged
            PushInsertResult(merged, false)
        } else {
            items.add(0, received)
            while (items.size > 300) items.removeAt(items.lastIndex)
            PushInsertResult(received, true)
        }
    }

    private fun read(): MutableList<PushHistoryItem> {
        if (!file.exists()) return mutableListOf()
        val array = try {
            JSONArray(file.readText()).also { entries ->
                for (i in 0 until entries.length()) entries.getJSONObject(i).getString("id")
            }
        } catch (e: Exception) {
            val backup = File(file.path + ".corrupt-${System.currentTimeMillis()}")
            file.copyTo(backup, overwrite = false)
            check(file.delete()) { "Cannot recover corrupt history" }
            JSONArray()
        }
        return (0 until array.length()).map { index ->
            val o = array.getJSONObject(index)
            PushHistoryItem(
                id = o.getString("id"), title = o.optString("title"), content = o.optString("content"),
                extras = o.optString("extras"), kind = o.optString("kind", "notification"),
                messageId = o.optString("messageId"), receivedAt = o.optLong("receivedAt"),
                read = o.optBoolean("read"), notifId = o.optInt("notifId"), receiptBase = o.optString("receiptBase")
            )
        }.toMutableList()
    }

    private fun mergeExtras(old: String, incoming: String): String {
        if (old.isBlank()) return incoming
        if (incoming.isBlank()) return old
        val a = runCatching { JSONObject(old) }.getOrNull() ?: return incoming
        val b = runCatching { JSONObject(incoming) }.getOrNull() ?: return old
        fun merge(target: JSONObject, source: JSONObject) {
            source.keys().forEach { key ->
                val value = source.opt(key)
                val current = target.opt(key)
                if ((current == null || current == JSONObject.NULL || current.toString().isBlank()) && value != null) {
                    target.put(key, value)
                } else {
                    fun asObject(v: Any?): JSONObject? = when (v) {
                        is JSONObject -> v
                        is String -> runCatching { JSONObject(v) }.getOrNull()
                        else -> null
                    }
                    val existingObject = asObject(current)
                    val incomingObject = asObject(value)
                    if (existingObject != null && incomingObject != null) {
                        merge(existingObject, incomingObject)
                        target.put(key, existingObject)
                    }
                }
            }
        }
        merge(a, b)
        return a.toString()
    }

    private fun write(items: List<PushHistoryItem>) {
        val array = JSONArray()
        items.forEach { item -> array.put(JSONObject()
            .put("id", item.id).put("title", item.title).put("content", item.content)
            .put("extras", item.extras).put("kind", item.kind).put("messageId", item.messageId)
            .put("receivedAt", item.receivedAt).put("read", item.read).put("notifId", item.notifId).put("receiptBase", item.receiptBase)) }
        val temp = File(file.path + ".tmp")
        java.io.FileOutputStream(temp).use { stream ->
            stream.write(array.toString().toByteArray(Charsets.UTF_8))
            stream.fd.sync()
        }
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
}
