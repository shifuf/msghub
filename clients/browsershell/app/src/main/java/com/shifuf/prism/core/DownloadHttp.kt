package com.shifuf.prism.core

import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.URL

enum class DownloadBackend { SYSTEM, BUILTIN }

internal class DownloadHttp(
    private val lookupCookie: (String) -> String?,
    private val createConnection: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }
) {
    fun resolveBackend(url: String, pageUrl: String?, preferredBackend: DownloadBackend): DownloadBackend {
        if (preferredBackend != DownloadBackend.SYSTEM) return preferredBackend
        // The initial URL may be public and redirect to a path covered by the page's cookies.
        // Only the in-app downloader can look up cookies again when it reaches that path.
        val needsCookieJar = cookieFor(url) != null || (!pageUrl.isNullOrBlank() && cookieFor(pageUrl) != null)
        return if (needsCookieJar) DownloadBackend.BUILTIN else DownloadBackend.SYSTEM
    }

    fun open(
        url: String,
        userAgent: String?,
        pageUrl: String?,
        method: String = "GET",
        range: String? = null,
        connectTimeoutMillis: Int = 12_000,
        readTimeoutMillis: Int = 12_000
    ): HttpURLConnection {
        val target = URL(url)
        require(target.protocol == "http" || target.protocol == "https") { "仅支持 HTTP(S) 下载" }
        return createConnection(target).apply {
            instanceFollowRedirects = false
            requestMethod = method
            connectTimeout = connectTimeoutMillis
            readTimeout = readTimeoutMillis
            setRequestProperty("User-Agent", userAgent?.takeIf { it.isNotBlank() } ?: DEFAULT_USER_AGENT)
            if (!pageUrl.isNullOrBlank()) setRequestProperty("Referer", pageUrl)
            if (range != null) setRequestProperty("Range", range)
            // Look up the request URL only. Referer is independent of cookie scope.
            cookieFor(url)?.let { setRequestProperty("Cookie", it) }
        }
    }

    data class OpenedDownload(val connection: HttpURLConnection, val appendOffset: Long)

    fun openDownload(
        url: String,
        userAgent: String?,
        pageUrl: String?,
        existingBytes: Long = 0,
        restartOnResume: Boolean = false
    ): OpenedDownload {
        val offset = if (restartOnResume) 0L else existingBytes
        val range = if (offset > 0) "bytes=$offset-" else null
        var current = url
        var redirects = 0
        while (true) {
            val connection = open(current, userAgent, pageUrl, range = range,
                connectTimeoutMillis = 20_000, readTimeoutMillis = 60_000)
            try {
                val code = connection.responseCode
                if (code == HttpURLConnection.HTTP_PARTIAL && restartOnResume) {
                    throw ProtocolException("未请求分段下载，但服务器返回了部分内容")
                }
                if (code !in REDIRECT_CODES) {
                    val appendOffset = if (code == HttpURLConnection.HTTP_PARTIAL) offset else 0L
                    return OpenedDownload(connection, appendOffset)
                }
                val next = resolveRedirect(connection.url, connection.getHeaderField("Location"))
                    ?: return OpenedDownload(connection, 0L)
                if (++redirects > MAX_REDIRECTS) throw ProtocolException("下载链接跳转次数过多")
                current = next
            } catch (e: Exception) {
                connection.disconnect()
                throw e
            }
            connection.disconnect()
        }
    }

    fun resolveRedirect(base: URL, location: String?): String? {
        if (location.isNullOrBlank()) return null
        val next = runCatching { URL(base, location) }.getOrNull() ?: return null
        return next.takeIf { it.protocol == "https" || (it.protocol == "http" && base.protocol == "http") }
            ?.toExternalForm()
    }

    private fun cookieFor(url: String): String? = runCatching {
        lookupCookie(url)?.takeIf { it.isNotBlank() }
    }.getOrNull()

    private companion object {
        const val DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36"
        const val MAX_REDIRECTS = 20
        val REDIRECT_CODES = setOf(300, 301, 302, 303, 307, 308)
    }
}
