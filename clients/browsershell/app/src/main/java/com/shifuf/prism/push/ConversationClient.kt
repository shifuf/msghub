package com.shifuf.prism.push

import com.shifuf.prism.core.PreferenceStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ConversationException(message: String) : Exception(message)

/** Credentials never leave the explicitly configured HTTPS origin; redirects are never followed. */
class ConversationClient(private val prefs: PreferenceStore) {
    suspend fun load(credentials: ConversationCredentials, originalBase: String): Conversation = withContext(Dispatchers.IO) {
        val response = request("conversation", originalBase,
            JSONObject().put("messageId", credentials.messageId).put("token", credentials.token))
        try { ConversationProtocol.parseConversation(response, credentials.messageId) }
        catch (_: Exception) { throw ConversationException("会话响应格式异常，请更新消息平台后重试") }
    }

    suspend fun reply(credentials: ConversationCredentials, originalBase: String, pending: PendingReply): ConversationReply = withContext(Dispatchers.IO) {
        val response = request("reply", originalBase, ConversationProtocol.replyBody(credentials, pending))
        try { ConversationProtocol.parseReplyResponse(response) }
        catch (_: Exception) { throw ConversationException("发送结果未确认，请重试；相同回复不会重复提交") }
    }

    private fun request(action: String, originalBase: String, body: JSONObject): String {
        val endpoint = ConversationProtocol.endpoint(prefs.msgPlatformBaseUrl, originalBase, action)
            ?: throw ConversationException("消息平台地址已改变或不是 HTTPS，请在设置中恢复接收消息时的平台地址")
        var connection: HttpURLConnection? = null
        try {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).also { connection = it }
            conn.apply {
                requestMethod = "POST"; connectTimeout = 12000; readTimeout = 12000
                doOutput = true; instanceFollowRedirects = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
            }
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) throw ConversationException(when (code) {
                401, 403 -> "会话凭证无效或已过期，请联系消息发送方"
                404, 405 -> "当前消息平台不支持会话，或此消息已被删除"
                429 -> "请求过于频繁，请稍后重试"
                in 300..399 -> "消息平台返回重定向，已阻止发送会话凭证"
                else -> "消息平台暂不可用（$code），请重试"
            })
            val response = conn.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (output.size() <= MAX_RESPONSE) {
                    val count = input.read(buffer, 0, minOf(buffer.size, MAX_RESPONSE + 1 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            if (response.size > MAX_RESPONSE) throw ConversationException("会话响应过大，请联系消息发送方")
            return String(response, Charsets.UTF_8)
        } catch (e: ConversationException) { throw e }
        catch (_: java.net.SocketTimeoutException) { throw ConversationException("连接超时，回复内容已保留，请重试") }
        catch (_: Exception) { throw ConversationException("连接失败，请检查网络后重试") }
        finally { connection?.disconnect() }
    }

    companion object { private const val MAX_RESPONSE = 2 * 1024 * 1024 }
}
