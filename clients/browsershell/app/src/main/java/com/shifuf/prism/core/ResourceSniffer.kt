package com.shifuf.prism.core

import java.util.LinkedHashMap

data class SniffedResource(
    val url: String,
    val mimeHint: String,
    val pageUrl: String,
    val timestamp: Long = System.currentTimeMillis()
) {
    val typeLabel: String
        get() {
            val u = url.lowercase()
            val t = mimeHint.lowercase()
            return when {
                u.contains(".m3u8") || t.contains("mpegurl") || t.contains("x-mpegurl") -> "m3u8"
                u.contains(".mpd") -> "mpd"
                u.contains(".flv") -> "flv"
                u.contains(".webm") -> "webm"
                u.contains(".mkv") -> "mkv"
                u.contains(".ts") && !u.contains(".json") -> "ts"
                u.contains(".mp4") || t.contains("mp4") || t.contains("video") -> "mp4"
                else -> "video"
            }
        }
}

/**
 * Video-only sniffer, scoped to current page.
 */
class ResourceSniffer {
    private val lock = Any()
    private var pageKey: String = ""
    private val map = object : LinkedHashMap<String, SniffedResource>(64, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, SniffedResource>?): Boolean {
            return size > MAX
        }
    }

    fun setPage(pageUrl: String) {
        val key = pageKeyOf(pageUrl)
        synchronized(lock) {
            if (key != pageKey) {
                pageKey = key
                map.clear()
            }
        }
    }

    fun onRequest(url: String, mimeOrType: String, pageUrl: String) {
        if (!isVideo(url, mimeOrType)) return
        val clean = url.substringBefore('#')
        val key = pageKeyOf(pageUrl)
        synchronized(lock) {
            if (key.isNotBlank() && key != pageKey) {
                pageKey = key
                map.clear()
            }
            if (map.containsKey(clean)) return
            map[clean] = SniffedResource(clean, mimeOrType, pageUrl)
        }
    }

    fun snapshot(forPageUrl: String? = null): List<SniffedResource> = synchronized(lock) {
        val all = map.values.reversed()
        if (forPageUrl.isNullOrBlank()) return all
        val key = pageKeyOf(forPageUrl)
        all.filter { pageKeyOf(it.pageUrl) == key }
    }

    fun clear() = synchronized(lock) { map.clear() }

    fun clearForNewPage() {
        // kept for API compat — prefer setPage()
        clear()
    }

    companion object {
        private const val MAX = 200

        fun pageKeyOf(url: String): String {
            if (url.isBlank() || url.startsWith("about:")) return url
            return runCatching {
                val u = android.net.Uri.parse(url)
                (u.host.orEmpty() + u.path.orEmpty()).lowercase()
            }.getOrDefault(url)
        }

        fun isVideo(url: String, type: String = ""): Boolean {
            val u = url.lowercase()
            val t = type.lowercase()
            if (t.contains("video") || t.contains("mpegurl") || t.contains("x-mpegurl") || t.contains("dash+xml")) {
                return true
            }
            if (u.endsWith(".js") || u.endsWith(".css") || u.endsWith(".json") || u.endsWith(".png") ||
                u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".gif") || u.endsWith(".webp") ||
                u.endsWith(".svg") || u.endsWith(".woff") || u.endsWith(".woff2")
            ) return false
            val markers = listOf(
                ".mp4", ".m3u8", ".mpd", ".flv", ".webm", ".mkv", ".mov", ".m4v",
                "mime=video", "format=mp4", "type=video", "video/mp4",
                "application/x-mpegurl", "application/vnd.apple.mpegurl"
            )
            if (markers.any { u.contains(it) }) return true
            if (u.contains(".ts") && (u.contains("hls") || u.contains("m3u8") || u.contains("segment"))) return true
            return false
        }
    }
}
