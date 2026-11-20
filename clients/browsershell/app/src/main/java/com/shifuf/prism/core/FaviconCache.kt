package com.shifuf.prism.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.util.LruCache
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Disk + memory favicon cache.
 * Remote fetch is best-effort; failures fall back to letter tiles in UI.
 */
class FaviconCache(context: Context) {
    private val dir = File(context.filesDir, "favicons").also { it.mkdirs() }
    private val memory = object : LruCache<String, Bitmap>(2 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount.coerceAtLeast(1)
    }
    private val inflight = ConcurrentHashMap<String, Boolean>()
    private val pool = Executors.newFixedThreadPool(2)

    fun fileForHost(host: String): File {
        val key = host.trim().lowercase().ifBlank { "unknown" }
        val hash = md5(key)
        return File(dir, "$hash.png")
    }

    fun dataUrlFor(url: String): String? {
        val host = hostOf(url) ?: return null
        val f = fileForHost(host)
        if (!f.exists() || f.length() < 16) return null
        return runCatching {
            val bytes = f.readBytes()
            "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        }.getOrNull()
    }

    fun getBitmap(url: String): Bitmap? {
        val host = hostOf(url) ?: return null
        memory.get(host)?.let { if (!it.isRecycled) return it }
        val f = fileForHost(host)
        if (!f.exists()) return null
        val bmp = BitmapFactory.decodeFile(f.absolutePath) ?: return null
        memory.put(host, bmp)
        return bmp
    }

    fun ensureCached(url: String, onDone: (() -> Unit)? = null) {
        val host = hostOf(url) ?: return
        val f = fileForHost(host)
        if (f.exists() && f.length() > 16) {
            onDone?.invoke()
            return
        }
        if (inflight.putIfAbsent(host, true) != null) return
        pool.execute {
            try {
                val remote = listOf(
                    "https://www.google.com/s2/favicons?domain=$host&sz=128",
                    "https://icons.duckduckgo.com/ip3/$host.ico",
                    "https://$host/favicon.ico"
                )
                var saved = false
                for (src in remote) {
                    val bytes = downloadBytes(src) ?: continue
                    if (bytes.size < 32 || bytes.size > 512_000) continue
                    // Try decode to ensure it's an image
                    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: continue
                    val out = ByteArrayOutputStream()
                    val ok = bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
                    if (!ok) {
                        bmp.recycle()
                        continue
                    }
                    f.writeBytes(out.toByteArray())
                    memory.put(host, bmp)
                    saved = true
                    break
                }
                if (!saved) {
                    // nothing
                }
            } catch (_: Exception) {
            } finally {
                inflight.remove(host)
                onDone?.invoke()
            }
        }
    }

    fun prefetch(urls: Collection<String>) {
        urls.forEach { ensureCached(it) }
    }

    fun clear() {
        memory.evictAll()
        dir.listFiles()?.forEach { runCatching { it.delete() } }
    }

    private fun downloadBytes(url: String): ByteArray? {
        return runCatching {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 8000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Prism/2.0")
            }
            conn.inputStream.use { it.readBytes() }.also { conn.disconnect() }
        }.getOrNull()
    }

    companion object {
        fun hostOf(url: String): String? {
            val host = runCatching { Uri.parse(url).host }.getOrNull()?.lowercase()?.removePrefix("www.")
            return host?.takeIf { it.isNotBlank() }
        }

        private fun md5(s: String): String {
            val dig = MessageDigest.getInstance("MD5").digest(s.toByteArray())
            return dig.joinToString("") { "%02x".format(it) }
        }
    }
}
