package com.shifuf.prism.push

import org.json.JSONObject
import java.net.URI

/** Both SDK extras and platform extras may contain JSON encoded as a string. */
object PushPayload {
    fun conversationFields(extras: String): ConversationCredentials? = objects(extras).firstNotNullOfOrNull {
        val id = field(it, "conversationId", "conversation_id")
        val token = field(it, "conversationToken", "conversation_token")
        if (id != null && token != null) ConversationCredentials(id, token) else null
    }

    fun replyId(extras: String): String? = objects(extras).firstNotNullOfOrNull { field(it, "replyId", "reply_id") }

    /** Receipt signing credentials are separate from read and conversation credentials. */
    fun receivedToken(extras: String, registrationId: String? = null): String? {
        val payloads = objects(extras)
        payloads.firstNotNullOfOrNull { field(it, "receivedToken", "received_token") }?.let { return it }
        val rid = registrationId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return payloads.firstNotNullOfOrNull { payload ->
            val raw = payload.opt("receivedTokens")
            val tokens = when (raw) {
                is JSONObject -> raw
                is String -> runCatching { JSONObject(raw) }.getOrNull()
                else -> null
            }
            tokens?.opt(rid)?.let { value ->
                if (value is String) value.trim().takeIf { it.isNotEmpty() } else null
            }
        }
    }

    /** The JPush notification ID must match a live system tray record before display is asserted. */
    fun hasActiveNotification(activeIds: Set<Int>, notificationId: Int): Boolean =
        notificationId > 0 && notificationId in activeIds

    fun dedupeId(extras: String, sdkId: String): String {
        // Each administrator reply is a distinct notification, even with the same original messageId.
        val reply = replyId(extras)
        val original = conversationFields(extras)?.messageId ?: readFields(extras).first
        if (reply != null) return "reply_${original.orEmpty()}_$reply"
        if (original != null) return "plat_$original"
        return sdkId
    }
    private fun objects(extras: String): List<JSONObject> {
        val root = runCatching { JSONObject(extras) }.getOrNull() ?: return emptyList()
        val result = mutableListOf<JSONObject>()
        fun visit(value: JSONObject, depth: Int) {
            result += value
            if (depth >= 4) return
            listOf("cn.jpush.android.EXTRA_EXTRA", "extra", "extras").forEach { key ->
                val nested = when (val raw = value.opt(key)) {
                    is JSONObject -> raw
                    is String -> runCatching { JSONObject(raw) }.getOrNull()
                    else -> null
                }
                if (nested != null) visit(nested, depth + 1)
            }
        }
        visit(root, 0)
        return result
    }

    private fun field(o: JSONObject, vararg keys: String): String? = keys.firstNotNullOfOrNull { key ->
        val value = o.opt(key)
        if (value is String || value is Number) value.toString().trim().takeIf { it.isNotEmpty() } else null
    }

    fun readFields(extras: String): Pair<String?, String?> {
        val candidates = objects(extras).map {
            field(it, "messageId", "message_id", "platformMessageId") to field(it, "readToken", "read_token")
        }
        return candidates.firstOrNull { it.first != null && it.second != null }
            ?: candidates.firstOrNull { it.first != null } ?: (null to null)
    }

    fun openUrl(extras: String): String? = objects(extras).firstNotNullOfOrNull { o ->
        sequenceOf("url", "link", "open_url", "u").mapNotNull { field(o, it) }
            .firstOrNull { value -> runCatching {
                val uri = URI(value)
                uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null
            }.getOrDefault(false) }
    }
}
