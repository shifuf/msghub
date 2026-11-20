package com.shifuf.prism.core

import java.net.MalformedURLException
import java.net.URL
import java.util.LinkedHashMap

private val audioMimeByExtension = mapOf(
    "mp3" to "audio/mpeg",
    "m4a" to "audio/mp4",
    "aac" to "audio/aac",
    "wav" to "audio/wav",
    "flac" to "audio/flac",
    "ogg" to "audio/ogg",
    "oga" to "audio/ogg",
    "opus" to "audio/opus",
    "amr" to "audio/amr",
)
private val audioExtensionByMime = audioMimeByExtension.entries.distinctBy { it.value }.associate { it.value to it.key }
private val audioMimeAliases = mapOf(
    "audio/mp3" to "audio/mpeg",
    "audio/x-mp3" to "audio/mpeg",
    "audio/x-m4a" to "audio/mp4",
    "audio/x-aac" to "audio/aac",
    "audio/x-wav" to "audio/wav",
    "audio/vnd.wave" to "audio/wav",
    "audio/x-flac" to "audio/flac",
    "audio/x-ogg" to "audio/ogg",
)
private val audioMimePattern = Regex("audio/[a-z0-9][a-z0-9!#$&^_.+-]*")
private val zeroQuality = Regex("(?:^|;)\\s*q\\s*=\\s*0(?:\\.0*)?\\s*(?:;|$)", RegexOption.IGNORE_CASE)

private fun singleMediaType(hint: String): String? {
    var quoted = false
    var escaped = false
    for (character in hint) {
        when {
            escaped -> escaped = false
            quoted && character == '\\' -> escaped = true
            character == '"' -> quoted = !quoted
            !quoted && character == ',' -> return null
        }
    }
    if (quoted || zeroQuality.containsMatchIn(hint)) return null
    return hint.substringBefore(';').trim().lowercase()
}

private fun httpAddress(url: String): URL? {
    if (!url.startsWith("https://", ignoreCase = true) && !url.startsWith("http://", ignoreCase = true)) return null
    val address = try {
        URL(url)
    } catch (_: MalformedURLException) {
        return null
    }
    return address.takeIf { !it.host.isNullOrBlank() && it.host.none(Char::isWhitespace) }
}

private fun detectAudioMime(url: String, type: String): String? {
    val hint = singleMediaType(type)
    if (hint?.startsWith("video/") == true || hint?.contains("mpegurl") == true || hint == "application/dash+xml") return null
    val path = httpAddress(url)?.path ?: return null
    val extension = path.substringAfterLast('/').substringAfterLast('.', "").lowercase()
    if (extension == "m3u8" || extension == "mpd") return null
    if (hint != null && audioMimePattern.matches(hint)) return audioMimeAliases[hint] ?: hint
    return audioMimeByExtension[extension]
}

data class SniffedResource(
    val url: String,
    val mimeHint: String,
    val pageUrl: String,
    val timestamp: Long = System.currentTimeMillis()
) {
    val audioMimeType: String? = detectAudioMime(url, mimeHint)

    val typeLabel: String
        get() {
            audioMimeType?.let { return audioExtensionByMime[it] ?: "audio" }
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
 * Collects audio and video for each tab's current document.
 */
class ResourceSniffer {
    private class Page(var url: String, val version: Long) {
        var available = true
        val resources = object : LinkedHashMap<String, SniffedResource>(64, 0.75f, false) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, SniffedResource>?): Boolean =
                size > MAX_PER_TAB
        }
    }

    private val lock = Any()
    private var activeScope: String? = null
    private val pages = mutableMapOf<String, Page>()

    fun activate(scopeId: String) = synchronized(lock) {
        activeScope = scopeId
    }

    fun forget(scopeId: String) {
        synchronized(lock) {
            pages.remove(scopeId)
            if (activeScope == scopeId) activeScope = null
        }
    }

    fun setPage(pageUrl: String, scopeId: String = DEFAULT_SCOPE, sameDocument: Boolean = false, version: Long = 0) {
        synchronized(lock) {
            val existing = pages[scopeId]
            when {
                !isWebPage(pageUrl) -> pages.remove(scopeId)
                sameDocument && existing?.version == version -> {
                    existing.url = pageUrl
                    existing.available = true
                }
                else -> pages[scopeId] = Page(pageUrl, version)
            }
        }
    }

    internal fun setPageAvailable(scopeId: String, available: Boolean) = synchronized(lock) {
        pages[scopeId]?.available = available
    }

    fun onRequest(url: String, mimeOrType: String, pageUrl: String, scopeId: String = DEFAULT_SCOPE, version: Long = 0) {
        val audioMime = detectAudioMime(url, mimeOrType)
        if (audioMime == null && !isVideo(url, mimeOrType)) return
        val clean = url.substringBefore('#')
        synchronized(lock) {
            val page = pages[scopeId] ?: if (scopeId == DEFAULT_SCOPE && isWebPage(pageUrl)) {
                Page(pageUrl, version).also { pages[scopeId] = it }
            } else {
                return
            }
            if (!page.available || page.version != version || pageKeyOf(page.url) != pageKeyOf(pageUrl)) return
            val previous = page.resources[clean]
            if (previous == null) {
                page.resources[clean] = SniffedResource(clean, audioMime ?: mimeOrType, pageUrl)
            } else if (previous.audioMimeType == null && audioMime != null) {
                page.resources[clean] = previous.copy(mimeHint = audioMime)
            }
        }
    }

    fun pageUrl(scopeId: String? = null): String = synchronized(lock) { pageFor(scopeId, null)?.url.orEmpty() }

    internal fun isCurrent(resource: SniffedResource, scopeId: String?): Boolean = synchronized(lock) {
        pageFor(scopeId, null)?.resources?.get(resource.url) === resource
    }

    fun snapshot(forPageUrl: String? = null, scopeId: String? = null): List<SniffedResource> = synchronized(lock) {
        val page = pageFor(scopeId, forPageUrl) ?: return emptyList()
        page.resources.values.reversed()
    }

    fun clear(scopeId: String? = null, forPageUrl: String? = null) = synchronized(lock) {
        pageFor(scopeId, forPageUrl)?.resources?.clear()
    }

    private fun pageFor(scopeId: String?, forPageUrl: String?): Page? {
        val page = pages[scopeId ?: activeScope ?: DEFAULT_SCOPE] ?: return null
        if (!page.available) return null
        if (!forPageUrl.isNullOrBlank() && pageKeyOf(forPageUrl) != pageKeyOf(page.url)) return null
        return page
    }

    companion object {
        private const val MAX_PER_TAB = 200
        private const val DEFAULT_SCOPE = ""

        private fun pageKeyOf(url: String): String = url.substringBefore('#')

        internal fun isWebPage(url: String): Boolean = httpAddress(url) != null && !InternalPage.isHome(url)

        fun isAudio(url: String, type: String = ""): Boolean = detectAudioMime(url, type) != null

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
