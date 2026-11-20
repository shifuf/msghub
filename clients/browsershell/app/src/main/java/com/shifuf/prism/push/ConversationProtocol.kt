package com.shifuf.prism.push

import org.json.JSONObject
import java.util.UUID

data class ConversationCredentials(val messageId: String, val token: String)
data class ConversationReply(val id: String, val author: String, val content: String,
    val createdAt: String, val readAt: String?, val clientId: String? = null)
data class Conversation(val messageId: String, val title: String, val content: String,
    val replies: List<ConversationReply>, val canReply: Boolean)
data class PendingReply(val clientId: String, val content: String) {
    companion object { fun create(content: String) = PendingReply(UUID.randomUUID().toString(), content.trim()) }
}

object ConversationProtocol {
    fun endpoint(configuredBase: String, originalBase: String, action: String): String? {
        if (action !in setOf("conversation", "reply")) return null
        val configured = ReadReceiptQueue.trustedBase(configuredBase) ?: return null
        if (configured != ReadReceiptQueue.trustedBase(originalBase)) return null
        return "$configured/api/public/messages/$action"
    }

    fun replyBody(credentials: ConversationCredentials, pending: PendingReply): JSONObject {
        val content = pending.content.trim()
        require(content.length in 1..4000) { "回复内容需要 1 至 4000 个字符" }
        return JSONObject().put("messageId", credentials.messageId).put("token", credentials.token)
            .put("content", content).put("clientId", pending.clientId)
    }

    private fun data(raw: String): JSONObject {
        val envelope = JSONObject(raw)
        require(envelope.optBoolean("success", false)) { "服务端未确认操作成功" }
        return envelope.getJSONObject("data")
    }

    fun parseConversation(raw: String, messageId: String): Conversation {
        val value = data(raw)
        require(value.getString("messageId") == messageId) { "会话响应不匹配" }
        val replies = value.getJSONArray("replies")
        require(value.has("title") && value.has("content")) { "缺少原始消息字段" }
        return Conversation(messageId, if (value.isNull("title")) "" else value.getString("title"),
            if (value.isNull("content")) "" else value.getString("content"),
            (0 until replies.length()).map { parseReply(replies.getJSONObject(it)) }.distinctBy { it.id },
            value.getBoolean("canReply"))
    }

    fun parseReplyResponse(raw: String): ConversationReply = parseReply(data(raw))

    private fun parseReply(value: JSONObject): ConversationReply {
        val author = value.getString("author")
        require(author in setOf("device", "admin")) { "回复作者无效" }
        val id = value.getString("id")
        require(id.isNotBlank())
        val created = value.getString("createdAt")
        java.time.Instant.parse(created)
        return ConversationReply(id, author, value.getString("content"), created,
            value.optString("readAt").takeIf { !value.isNull("readAt") && it.isNotBlank() },
            value.optString("clientId").takeIf { !value.isNull("clientId") && it.isNotBlank() })
    }
}
