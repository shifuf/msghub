package com.shifuf.prism.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageLoadStatusTest {
    @Test
    fun onlySecureHttpsCompletionReportsASecureConnection() {
        assertEquals(PageLoadState.SECURE, PageLoadStatusClassifier.onPageFinished("https://example.com/docs").state)
        assertEquals(PageLoadState.INSECURE, PageLoadStatusClassifier.onPageFinished("http://example.com/docs").state)
        assertEquals(PageLoadState.IDLE, PageLoadStatusClassifier.onPageFinished("https://home.local/").state)
        assertEquals(PageLoadState.IDLE, PageLoadStatusClassifier.onPageFinished("file:///data/start.html").state)
        assertEquals(
            PageLoadState.CERTIFICATE_ERROR,
            PageLoadStatusClassifier.onPageFinished(
                "https://example.com/",
                "https://example.com/",
                PageLoadStatusClassifier.certificateError(3)
            ).state
        )
        assertEquals(
            PageLoadState.SECURE,
            PageLoadStatusClassifier.onPageFinished(
                "https://example.com/other",
                "https://example.com/",
                PageLoadStatusClassifier.certificateError(3)
            ).state
        )
    }

    @Test
    fun mainFrameHttpResponsesRetainFailureStatusAfterPageFinish() {
        assertEquals(404, PageLoadStatusClassifier.fromHttpResponse(404)?.httpStatusCode)
        assertEquals(PageLoadState.HTTP_CLIENT_ERROR, PageLoadStatusClassifier.fromHttpResponse(404)?.state)
        assertEquals(PageLoadState.HTTP_CLIENT_ERROR, PageLoadStatusClassifier.fromHttpResponse(429)?.state)
        assertEquals(PageLoadState.HTTP_SERVER_ERROR, PageLoadStatusClassifier.fromHttpResponse(503)?.state)
        assertEquals(null, PageLoadStatusClassifier.fromHttpResponse(204))
    }

    @Test
    fun networkAndCertificateErrorsProduceDistinctRetryableStates() {
        assertEquals(PageLoadState.NETWORK_ERROR, PageLoadStatusClassifier.networkError(-2).state)
        assertEquals(PageLoadState.CERTIFICATE_ERROR, PageLoadStatusClassifier.certificateError(3).state)
        assertTrue(PageLoadStatusClassifier.networkError(-2).isError)
        assertTrue(PageLoadStatusClassifier.certificateError(3).isError)
        assertFalse(PageLoadStatusClassifier.onPageFinished("https://example.com").isError)
    }

    @Test
    fun onlyTheLiveMainFrameUrlMatchesNavigationEvents() {
        assertTrue(PageLoadStatusClassifier.isCurrentMainFrameUrl("https://Example.com/path#old", "https://example.com/path#new"))
        assertFalse(PageLoadStatusClassifier.isCurrentMainFrameUrl("https://example.com/old", "https://example.com/new"))
        assertTrue(PageLoadStatusClassifier.isCurrentMainFrameUrl("https://example.com:443/", "https://example.com/"))
        assertFalse(PageLoadStatusClassifier.isCurrentMainFrameUrl("http://example.com/", "https://example.com/"))
        assertFalse(PageLoadStatusClassifier.isCurrentMainFrameUrl("not a URL", "https://example.com/"))
    }

    @Test
    fun webViewPathsWithBracketsAndQueriesWithBracesStillHaveAConnectionStatus() {
        val url = "https://example.test/watch[1]?arg={foo}"

        assertTrue(PageLoadStatusClassifier.isWebPage(url))
        assertEquals(PageLoadState.SECURE, PageLoadStatusClassifier.onPageFinished(url).state)
        assertTrue(PageLoadStatusClassifier.isCurrentMainFrameUrl("$url#help", url))
        assertFalse(PageLoadStatusClassifier.isCurrentMainFrameUrl(url, "https://example.test/watch[1]?arg={bar}"))
        assertFalse(PageLoadStatusClassifier.isCurrentMainFrameUrl("https://example.test/a//b", "https://example.test/a/b"))
        assertFalse(PageLoadStatusClassifier.isWebPage("https://bad host.test/"))
    }

    @Test
    fun mainFrameMatchingResolvesWebViewDotSegmentsButKeepsEmptySegments() {
        val origin = "https://example.test"
        for ((typed, canonical) in listOf(
            "/a/../b" to "/b",
            "/a/%2E./b" to "/b",
            "/a//.%2e/b" to "/a/b",
            "/a//x/%2e%2E/./b" to "/a//b",
            "/a/%2E" to "/a/",
            "/%2e%2E" to "/"
        )) {
            assertTrue(typed, PageLoadStatusClassifier.isCurrentMainFrameUrl(origin + typed, origin + canonical))
        }
        assertFalse(PageLoadStatusClassifier.isCurrentMainFrameUrl("$origin/a//./b", "$origin/a/b"))
        assertFalse(PageLoadStatusClassifier.isCurrentMainFrameUrl("$origin/a/%252e%252e/b", "$origin/b"))
    }

    @Test
    fun cancelledNavigationDoesNotBecomeAPageError() {
        assertTrue(PageLoadStatusClassifier.isNavigationCancelled(-1, "net::ERR_ABORTED"))
        assertTrue(PageLoadStatusClassifier.isNavigationCancelled(-1, "ERR_ABORTED"))
        assertFalse(PageLoadStatusClassifier.isNavigationCancelled(-2, "net::ERR_ABORTED"))
        for (description in listOf("", "请求失败", "Server refused connection", "Request was not aborted by the client")) {
            assertFalse(description, PageLoadStatusClassifier.isNavigationCancelled(-1, description))
        }
    }

    @Test
    fun userFacingNetworkAndHttpMessagesExplainWhatHappenedAndRetainServerPages() {
        assertEquals(
            "找不到此网站，请检查网址或网络连接后重试。",
            PageLoadStatusClassifier.explanation(PageLoadStatusClassifier.networkError(-2))
        )
        assertEquals(
            "网站找不到此网页（HTTP 404）。网页仍保留供你查看。",
            PageLoadStatusClassifier.explanation(PageLoadStatusClassifier.fromHttpResponse(404)!!)
        )
        assertEquals("网站暂时无法处理请求（HTTP 429）。网页仍保留供你查看。", PageLoadStatusClassifier.explanation(PageLoadStatusClassifier.fromHttpResponse(429)!!))
        assertEquals(
            "此网站的证书未受信任，浏览器已中止连接。请勿绕过此检查。",
            PageLoadStatusClassifier.explanation(PageLoadStatusClassifier.certificateError(3))
        )
    }
}
