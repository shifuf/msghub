package com.shifuf.prism.push

import java.io.File
import org.json.JSONObject
import java.nio.file.Files
import java.nio.file.StandardCopyOption

data class ConversationSession(val draft: String = "", val pending: PendingReply? = null)

class ConversationSessionFile(private val file: File) {
    companion object { private val lock = Any() }
    fun read(): ConversationSession = synchronized(lock) {
        if (!file.exists()) return@synchronized ConversationSession()
        val state = runCatching { JSONObject(file.readText()) }.getOrElse {
            file.copyTo(File(file.path + ".corrupt-${System.currentTimeMillis()}"))
            return@synchronized ConversationSession()
        }
        ConversationSession(state.optString("draft"), state.optJSONObject("pending")?.let {
            PendingReply(it.getString("clientId"), it.getString("content"))
        })
    }
    fun write(session: ConversationSession) = synchronized(lock) {
        file.parentFile?.mkdirs()
        val state = JSONObject().put("draft", session.draft)
        session.pending?.let { state.put("pending", JSONObject().put("clientId", it.clientId).put("content", it.content)) }
        val temp = File(file.path + ".tmp")
        java.io.FileOutputStream(temp).use { output ->
            output.write(state.toString().toByteArray(Charsets.UTF_8)); output.fd.sync()
        }
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        Unit
    }
}
