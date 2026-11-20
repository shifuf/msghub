package com.shifuf.prism.core

import java.net.URI
import java.net.URL

enum class PageLoadState {
    IDLE,
    LOADING,
    SECURE,
    INSECURE,
    NETWORK_ERROR,
    CERTIFICATE_ERROR,
    HTTP_CLIENT_ERROR,
    HTTP_SERVER_ERROR
}

data class PageLoadIndicator(
    val state: PageLoadState = PageLoadState.IDLE,
    val httpStatusCode: Int? = null,
    val errorCode: Int? = null
) {
    internal val isConnectionFailure: Boolean
        get() = state == PageLoadState.NETWORK_ERROR || state == PageLoadState.CERTIFICATE_ERROR

    val isError: Boolean
        get() = state in setOf(
            PageLoadState.NETWORK_ERROR,
            PageLoadState.CERTIFICATE_ERROR,
            PageLoadState.HTTP_CLIENT_ERROR,
            PageLoadState.HTTP_SERVER_ERROR
        )
}

/** Maps top-level navigation outcomes without Android framework dependencies. */
object PageLoadStatusClassifier {
    fun onPageFinished(
        url: String,
        issueUrl: String? = null,
        existingIssue: PageLoadIndicator? = null
    ): PageLoadIndicator {
        if (existingIssue?.isError == true && issueUrl?.let { isCurrentMainFrameUrl(url, it) } == true) {
            return existingIssue
        }
        return when {
            InternalPage.isHome(url) -> PageLoadIndicator()
            parseHttpUrl(url)?.protocol == "https" ->
                PageLoadIndicator(state = PageLoadState.SECURE)
            parseHttpUrl(url)?.protocol == "http" ->
                PageLoadIndicator(state = PageLoadState.INSECURE)
            else -> PageLoadIndicator()
        }
    }

    fun fromHttpResponse(statusCode: Int): PageLoadIndicator? {
        if (statusCode !in 400..599) return null
        return PageLoadIndicator(
            state = if (statusCode < 500) PageLoadState.HTTP_CLIENT_ERROR else PageLoadState.HTTP_SERVER_ERROR,
            httpStatusCode = statusCode
        )
    }

    fun networkError(errorCode: Int): PageLoadIndicator = PageLoadIndicator(
        state = PageLoadState.NETWORK_ERROR,
        errorCode = errorCode
    )

    fun certificateError(primaryError: Int): PageLoadIndicator = PageLoadIndicator(
        state = PageLoadState.CERTIFICATE_ERROR,
        errorCode = primaryError
    )

    // Android maps several Chromium errors to ERROR_UNKNOWN. Only the explicit
    // Chromium reason identifies an abort; the text may be missing or localized.
    fun isNavigationCancelled(errorCode: Int, description: String): Boolean = errorCode == -1 &&
        description.trim().removePrefix("net::").equals("ERR_ABORTED", ignoreCase = true)

    fun isWebPage(url: String): Boolean = !InternalPage.isHome(url) && parseHttpUrl(url) != null

    fun explanation(indicator: PageLoadIndicator): String = when (indicator.state) {
        PageLoadState.IDLE -> ""
        PageLoadState.LOADING -> "网页正在加载。"
        PageLoadState.SECURE -> "此页的主地址使用 HTTPS。网页仍可能含有未加密的资源，连接加密也不代表网页内容可信。"
        PageLoadState.INSECURE -> "此网页使用 HTTP，连接未加密。请勿在网页中输入密码、验证码或银行卡信息。"
        PageLoadState.NETWORK_ERROR -> when (indicator.errorCode) {
            -2 -> "找不到此网站，请检查网址或网络连接后重试。"
            -6, -7 -> "无法连接到此网站，请检查网络连接后重试。"
            -8 -> "连接超时，请检查网络后重试。"
            -11 -> "无法与网站建立安全连接，请检查网址或稍后重试。"
            -15 -> "网站暂时无法处理请求，请稍后重试。"
            else -> "无法连接到此网站。请检查网络连接后重试。"
        }
        PageLoadState.CERTIFICATE_ERROR -> when (indicator.errorCode) {
            0 -> "此网站的证书尚未生效，浏览器已中止连接。"
            1 -> "此网站的证书已过期，浏览器已中止连接。"
            2 -> "此网站的证书与网址不匹配，浏览器已中止连接。"
            3 -> "此网站的证书未受信任，浏览器已中止连接。请勿绕过此检查。"
            4 -> "此网站的证书有效日期不正确，浏览器已中止连接。"
            5 -> "此网站的安全证书无效，浏览器已中止连接。"
            else -> "此网站的安全证书无法通过验证，浏览器已中止连接。"
        }
        PageLoadState.HTTP_CLIENT_ERROR -> when (indicator.httpStatusCode) {
            400 -> "网站未接受此请求（HTTP 400）。网页仍保留供你查看。"
            401 -> "网站要求身份验证（HTTP 401）。网页仍保留供你查看。"
            403 -> "网站拒绝了此请求（HTTP 403）。网页仍保留供你查看。"
            404 -> "网站找不到此网页（HTTP 404）。网页仍保留供你查看。"
            429 -> "网站暂时无法处理请求（HTTP 429）。网页仍保留供你查看。"
            else -> "网站返回 HTTP ${indicator.httpStatusCode ?: 400}。网页仍保留供你查看。"
        }
        PageLoadState.HTTP_SERVER_ERROR -> when (indicator.httpStatusCode) {
            502, 503, 504 -> "网站暂时无法响应（HTTP ${indicator.httpStatusCode}）。网页仍保留供你查看，可稍后重试。"
            else -> "网站处理请求时发生错误（HTTP ${indicator.httpStatusCode ?: 500}）。网页仍保留供你查看。"
        }
    }

    /** A current page's location, excluding fragments that don't create a new network document. */
    fun isCurrentMainFrameUrl(pageUrl: String, eventUrl: String): Boolean {
        val page = parseHttpUrl(pageUrl) ?: return false
        val event = parseHttpUrl(eventUrl) ?: return false
        return isSameWebOrigin(page, event) && page.userInfo == event.userInfo &&
            canonicalPath(page) == canonicalPath(event) && page.query == event.query
    }

    internal fun isSameWebOrigin(pageUrl: String, eventUrl: String): Boolean {
        val page = parseHttpUrl(pageUrl) ?: return false
        val event = parseHttpUrl(eventUrl) ?: return false
        return isSameWebOrigin(page, event)
    }

    private fun isSameWebOrigin(page: URL, event: URL): Boolean {
        val sameScheme = page.protocol.equals(event.protocol, ignoreCase = true)
        val sameHost = page.host.equals(event.host, ignoreCase = true)
        val pagePort = if (page.port == -1) page.defaultPort else page.port
        val eventPort = if (event.port == -1) event.defaultPort else event.port
        return sameScheme && sameHost && pagePort == eventPort
    }

    private fun parseHttpUrl(value: String): URL? = runCatching {
        if (value.any { it.isISOControl() || it.isWhitespace() || it == '\\' }) return null
        URL(value).takeIf {
            // WebView URLs can keep brackets in paths and braces in queries. Check
            // authority syntax without forcing the path or query through java.net.URI.
            (it.protocol == "http" || it.protocol == "https") && it.host.isNotEmpty() &&
                it.port in -1..65535 && URI("${it.protocol}://${it.authority}").rawAuthority != null
        }
    }.getOrNull()

    private fun canonicalPath(url: URL): String {
        val path = url.path.ifEmpty { "/" }
        if ('.' !in path && '%' !in path) return path
        // WebView shortens literal and percent-encoded dot segments without
        // collapsing repeated slashes or decoding any other path characters.
        val segments = path.drop(1).split('/')
        val resolved = mutableListOf<String>()
        for ((index, segment) in segments.withIndex()) {
            when (segment.replace("%2e", ".", ignoreCase = true)) {
                "." -> if (index == segments.lastIndex) resolved.add("")
                ".." -> {
                    if (resolved.isNotEmpty()) resolved.removeAt(resolved.lastIndex)
                    if (index == segments.lastIndex) resolved.add("")
                }
                else -> resolved.add(segment)
            }
        }
        return resolved.joinToString("/", prefix = "/")
    }
}
