package com.shifuf.prism.push

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.net.URI
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

data class ReadReceipt(val base: String, val messageId: String, val token: String)

/** Persistent queue uses a sidecar lock so UI/SDK processes cannot overwrite each other. */
class ReadReceiptQueue(val file: File) {
    companion object {
        private val processLock = Any()
        fun trustedBase(value: String): String? = runCatching {
            val uri = URI(value.trim())
            if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null ||
                uri.query != null || uri.fragment != null || uri.path !in listOf("", "/")) null
            else URI("https", null, uri.host.lowercase(), uri.port, null, null, null).toASCIIString()
        }.getOrNull()
        private fun key(base: String, mid: String, token: String): String = MessageDigest.getInstance("SHA-256")
            .digest("$base\u0000$mid\u0000$token".toByteArray()).joinToString("") { "%02x".format(it) }
    }
    private fun <T> transaction(block: (JSONObject) -> T): T = synchronized(processLock) {
        file.parentFile?.mkdirs()
        RandomAccessFile(File(file.path + ".lock"), "rw").use { handle ->
            handle.channel.lock().use {
                var recovered = false
                val state = if (file.exists()) runCatching {
                    JSONObject(file.readText()).also { it.getJSONArray("pending"); it.getJSONObject("acknowledged") }
                }.getOrElse {
                    file.copyTo(File(file.path + ".corrupt-${System.currentTimeMillis()}"))
                    recovered = true
                    JSONObject().put("pending", JSONArray()).put("acknowledged", JSONObject())
                } else JSONObject().put("pending", JSONArray()).put("acknowledged", JSONObject())
                val before = state.toString()
                val result = block(state)
                if (recovered || !file.exists() || before != state.toString()) {
                    val temp = File(file.path + ".tmp")
                    java.io.FileOutputStream(temp).use { stream ->
                        stream.write(state.toString().toByteArray(Charsets.UTF_8)); stream.fd.sync()
                    }
                    Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                }
                result
            }
        }
    }
    fun enqueue(base: String, messageId: String, token: String) {
        val target = trustedBase(base) ?: return
        if (messageId.isBlank() || token.isBlank()) return
        transaction { state ->
            state.put("origins", (state.optJSONObject("origins") ?: JSONObject()).put(target, true))
            if (state.getJSONObject("acknowledged").has(key(target, messageId, token))) return@transaction
            val pending = state.getJSONArray("pending")
            if ((0 until pending.length()).none { pending.getJSONObject(it).let { o -> o.getString("base") == target && o.getString("messageId") == messageId && o.getString("token") == token } })
                pending.put(JSONObject().put("base", target).put("messageId", messageId).put("token", token))
        }
    }
    fun pending(): List<ReadReceipt> = transaction { state ->
        val queue = state.getJSONArray("pending")
        (0 until queue.length()).map { queue.getJSONObject(it).let { o -> ReadReceipt(o.getString("base"), o.getString("messageId"), o.getString("token")) } }
    }
    fun acknowledge(receipt: ReadReceipt) = transaction { state ->
        val pending = state.getJSONArray("pending")
        val remaining = JSONArray()
        for (i in 0 until pending.length()) {
            val item = pending.getJSONObject(i)
            if (item.getString("base") != receipt.base || item.getString("messageId") != receipt.messageId || item.getString("token") != receipt.token) remaining.put(item)
        }
        state.put("pending", remaining)
        val acknowledgements = state.getJSONObject("acknowledged")
        acknowledgements.put(key(receipt.base, receipt.messageId, receipt.token), System.currentTimeMillis())
        if (acknowledgements.length() > 2000) {
            acknowledgements.keys().asSequence().toList().sortedBy { acknowledgements.getLong(it) }
                .take(acknowledgements.length() - 2000).forEach { acknowledgements.remove(it) }
        }
        Unit
    }
    fun isAcknowledged(messageId: String, token: String, base: String? = null): Boolean = transaction { state ->
        val acknowledgements = state.getJSONObject("acknowledged")
        val origin = base?.let { trustedBase(it) }
        if (base != null) origin != null && acknowledgements.has(key(origin, messageId, token))
        else state.optJSONObject("origins")?.keys()?.asSequence()?.any {
            acknowledgements.has(key(it, messageId, token))
        } == true
    }
}
