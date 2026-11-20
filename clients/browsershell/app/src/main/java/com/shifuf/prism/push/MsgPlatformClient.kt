package com.shifuf.prism.push

import android.util.Log
import com.shifuf.prism.core.PreferenceStore
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

object MsgPlatformClient {
    private val io = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "prism-msg-platform").apply { isDaemon = true } }
    private val draining = AtomicBoolean(false)
    private var retryDelay = 30L
    private var scheduledRetry: java.util.concurrent.ScheduledFuture<*>? = null

    fun markReadAsync(prefs: PreferenceStore, messageId: String?, token: String?, originalBase: String? = null) {
        val mid = messageId?.trim().orEmpty(); val tok = token?.trim().orEmpty()
        if (mid.isBlank() || tok.isBlank()) return
        prefs.readReceiptQueue().enqueue(originalBase ?: prefs.msgPlatformBaseUrl, mid, tok)
        retryPending(prefs)
    }
    fun retryPending(prefs: PreferenceStore) {
        if (!draining.compareAndSet(false, true)) return
        io.execute {
            scheduledRetry?.cancel(false); scheduledRetry = null
            val queue = prefs.readReceiptQueue()
            try {
                // One-time migration retains old receipt targets; never redirect credentials to a newly configured host.
                val legacy = runCatching { JSONArray(prefs.pendingReadReceipts) }.getOrNull()
                if (legacy != null) {
                    for (i in 0 until legacy.length()) legacy.optJSONObject(i)?.let {
                        queue.enqueue(it.optString("base"), it.optString("messageId"), it.optString("token"))
                    }
                    prefs.pendingReadReceipts = "[]"
                }
                for (receipt in queue.pending()) {
                    if (receipt.base != ReadReceiptQueue.trustedBase(prefs.msgPlatformBaseUrl)) continue
                    if (send(receipt)) queue.acknowledge(receipt)
                }
            } catch (e: Exception) { Log.w("MsgPlatform", "Receipt synchronization failed: ${e.javaClass.simpleName}") }
            finally {
                draining.set(false)
                if (runCatching { queue.pending().isNotEmpty() }.getOrDefault(true)) {
                    scheduledRetry = io.schedule({ retryPending(prefs) }, retryDelay, TimeUnit.SECONDS)
                    retryDelay = (retryDelay * 2).coerceAtMost(900L)
                } else retryDelay = 30L
            }
        }
    }
    private fun send(receipt: ReadReceipt): Boolean {
        val base = ReadReceiptQueue.trustedBase(receipt.base) ?: return false
        var connection: HttpURLConnection? = null
        return try {
            val conn = URL("$base/api/public/messages/mark-read").openConnection() as HttpURLConnection
            connection = conn
            conn.apply {
                requestMethod = "POST"; connectTimeout = 12000; readTimeout = 12000
                doOutput = true; instanceFollowRedirects = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            conn.outputStream.use { it.write(JSONObject().put("messageId", receipt.messageId).put("token", receipt.token).toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) return false
            // A proxy's HTML 200 is not an acknowledged receipt; bound response memory usage.
            val response = conn.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(1024)
                while (output.size() <= 16384) {
                    val count = input.read(buffer, 0, minOf(buffer.size, 16385 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            if (response.size > 16384) return false
            JSONObject(String(response, Charsets.UTF_8)).optBoolean("success", false)
        } catch (e: Exception) { Log.w("MsgPlatform", "Receipt request failed: ${e.javaClass.simpleName}"); false }
        finally { connection?.disconnect() }
    }
    fun markReadFromExtras(prefs: PreferenceStore, extras: String?, originalBase: String? = null) {
        val (mid, token) = extractReadFields(extras.orEmpty()); markReadAsync(prefs, mid, token, originalBase)
    }
    fun receiptStatus(prefs: PreferenceStore, extras: String, originalBase: String? = null): String {
        val (mid, token) = extractReadFields(extras)
        if (mid.isNullOrBlank() || token.isNullOrBlank()) return "无需同步回执"
        if (originalBase != null && ReadReceiptQueue.trustedBase(originalBase) == null) return "本机已读 · 缺少原平台地址"
        if (runCatching { prefs.readReceiptQueue().isAcknowledged(mid, token, originalBase) }.getOrDefault(false)) return "本机已读 · 回执已同步"
        if (originalBase != null && ReadReceiptQueue.trustedBase(originalBase) != ReadReceiptQueue.trustedBase(prefs.msgPlatformBaseUrl)) return "本机已读 · 等待恢复原平台地址"
        return "本机已读 · 回执待同步"
    }
    fun extractReadFields(extras: String): Pair<String?, String?> = PushPayload.readFields(extras)
}
