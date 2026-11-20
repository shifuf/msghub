package com.shifuf.prism.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.URL

class DownloadHttpTest {
    @Test
    fun filenameProbesDoNotBorrowCookiesFromTheReferrer() {
        val page = "https://account.test/settings"
        val target = "https://files.test/download"
        val http = Connections().withCookies(page to "session=example")

        val head = http.open(target, "Example UA", page, method = "HEAD")
        val range = http.open(target, "Example UA", page, range = "bytes=0-0")

        assertNull(head.getRequestProperty("Cookie"))
        assertNull(range.getRequestProperty("Cookie"))
        assertEquals(page, head.getRequestProperty("Referer"))
        assertEquals(page, range.getRequestProperty("Referer"))
        assertEquals("HEAD", head.requestMethod)
        assertEquals("GET", range.requestMethod)
        assertEquals("bytes=0-0", range.getRequestProperty("Range"))
    }

    @Test
    fun filenameProbesUseTheRequestedSchemeAndPathForCookies() {
        val page = "https://files.test/account/"
        val target = "https://files.test/download/file.mp3"
        val http = Connections().withCookies(page to "page=example", target to "secure=example")

        assertEquals("secure=example", http.open(target, null, page).getRequestProperty("Cookie"))
        assertNull(http.open("https://files.test/public/file.mp3", null, page).getRequestProperty("Cookie"))
        assertNull(http.open("http://files.test/download/file.mp3", null, page).getRequestProperty("Cookie"))
    }

    @Test
    fun builtinDownloadUsesRedirectTargetsOwnCookieAndKeepsRefererAndRange() {
        val page = "https://account.test/library"
        val start = "https://files.test/download"
        val target = "https://cdn.test/audio.mp3"
        val transport = Connections(start to Reply(302, target), target to Reply(206))
        val http = transport.withCookies(page to "page=example", start to "files=example", target to "cdn=example")

        val download = http.openDownload(start, "Example UA", page, existingBytes = 120L)
        val result = download.connection

        assertEquals(listOf(start, target), transport.opened.map { it.url.toString() })
        assertSame(transport.opened[1], result)
        assertEquals(120L, download.appendOffset)
        assertEquals("files=example", transport.opened[0].getRequestProperty("Cookie"))
        assertEquals("cdn=example", result.getRequestProperty("Cookie"))
        for (connection in transport.opened) {
            assertFalse(connection.instanceFollowRedirects)
            assertEquals(page, connection.getRequestProperty("Referer"))
            assertEquals("bytes=120-", connection.getRequestProperty("Range"))
            assertEquals("Example UA", connection.getRequestProperty("User-Agent"))
        }
        assertTrue(transport.opened[0].disconnected)
        assertFalse(transport.opened[1].disconnected)
    }

    @Test
    fun builtinDownloadDoesNotReplayCookiesWhenRedirectPathHasNone() {
        val start = "https://files.test/private/download"
        val target = "https://files.test/public/audio.mp3"
        val transport = Connections(start to Reply(307, "../public/audio.mp3"))
        val http = transport.withCookies(start to "private=example")

        val result = http.openDownload(start, null, start).connection

        assertEquals(target, result.url.toString())
        assertNull(result.getRequestProperty("Cookie"))
    }

    @Test
    fun builtinDownloadFollowsAnUpgradeWithOnlyTheDestinationCookie() {
        val start = "http://files.test/download"
        val target = "https://files.test/private/audio.mp3"
        val transport = Connections(start to Reply(302, target))
        val http = transport.withCookies(start to "start=example", target to "secure=example")

        val result = http.openDownload(start, null, null).connection

        assertEquals(listOf(start, target), transport.opened.map { it.url.toString() })
        assertEquals("start=example", transport.opened[0].getRequestProperty("Cookie"))
        assertEquals("secure=example", result.getRequestProperty("Cookie"))
        assertTrue(transport.opened[0].disconnected)
    }

    @Test
    fun builtinDownloadDoesNotFollowADowngrade() {
        val start = "https://files.test/download"
        val transport = Connections(start to Reply(302, "http://files.test/audio.mp3"))

        val result = transport.withCookies(start to "secure=example").openDownload(start, null, null).connection

        assertEquals(start, result.url.toString())
        assertEquals(302, result.responseCode)
        assertEquals(1, transport.opened.size)
    }

    @Test
    fun loopingDownloadRedirectsStopAndDisconnectEveryAttempt() {
        val start = "https://files.test/download"
        val transport = Connections(start to Reply(308, "/download"))

        try {
            transport.withCookies().openDownload(start, null, null)
            throw AssertionError("Expected the redirect loop to fail")
        } catch (_: ProtocolException) {
            assertTrue(transport.opened.all { it.disconnected })
        }
    }

    @Test
    fun systemPreferenceUsesBuiltinWhenTheInitiatingPageHasCookies() {
        val page = "https://files.test/private/index.html"
        val start = "https://files.test/download"
        val target = "https://files.test/private/file.mp3"
        val transport = Connections(start to Reply(302, target))
        val http = transport.withCookies(page to "page=example", target to "file=example")

        assertEquals(DownloadBackend.BUILTIN, http.resolveBackend(start, page, DownloadBackend.SYSTEM))
        val result = http.openDownload(start, null, page).connection
        assertNull(transport.opened[0].getRequestProperty("Cookie"))
        assertEquals("file=example", result.getRequestProperty("Cookie"))
    }

    @Test
    fun systemPreferenceUsesBuiltinWhenTheDownloadUrlHasCookies() {
        val url = "https://files.test/private/file.mp3"
        val http = Connections().withCookies(url to "session=example")

        assertEquals(DownloadBackend.BUILTIN, http.resolveBackend(url, null, DownloadBackend.SYSTEM))
    }

    @Test
    fun systemPreferenceUsesSystemWhenNeitherUrlHasCookies() {
        val page = "https://files.test/index.html"
        val http = Connections().withCookies(page to "  ")

        assertEquals(
            DownloadBackend.SYSTEM,
            http.resolveBackend("https://files.test/public/file.mp3", page, DownloadBackend.SYSTEM)
        )
    }

    @Test
    fun retryOfAReroutedDownloadRequestsTheWholeFileAndWritesFromZero() {
        val start = "https://files.test/download"
        val target = "https://files.test/private/audio.mp3"
        val transport = Connections(start to Reply(302, target))
        val http = transport.withCookies(target to "session=example")

        val download = http.openDownload(start, null, null, existingBytes = 120L, restartOnResume = true)

        assertEquals(listOf(start, target), transport.opened.map { it.url.toString() })
        transport.opened.forEach { assertNull(it.getRequestProperty("Range")) }
        assertEquals(0L, download.appendOffset)
    }

    @Test
    fun retryOfAReroutedDownloadRejectsAnUnsolicitedPartialResponse() {
        val url = "https://files.test/private/file.mp3"
        val transport = Connections(url to Reply(206))

        assertThrows(ProtocolException::class.java) {
            transport.withCookies().openDownload(url, null, null, existingBytes = 120L, restartOnResume = true)
        }
        assertTrue(transport.opened.single().disconnected)
    }

    private data class Reply(val code: Int = 200, val location: String? = null)

    private class Connections(vararg replies: Pair<String, Reply>) {
        private val responses = replies.toMap()
        val opened = mutableListOf<RecordedConnection>()

        fun withCookies(vararg cookies: Pair<String, String>): DownloadHttp {
            val jar = cookies.toMap()
            return DownloadHttp(jar::get) { url ->
                RecordedConnection(url, responses[url.toString()] ?: Reply()).also(opened::add)
            }
        }
    }

    private class RecordedConnection(url: URL, private val reply: Reply) : HttpURLConnection(url) {
        var disconnected = false
            private set

        override fun connect() = Unit
        override fun disconnect() { disconnected = true }
        override fun usingProxy(): Boolean = false
        override fun getResponseCode(): Int = reply.code
        override fun getHeaderField(name: String?): String? = reply.location.takeIf { name == "Location" }
    }
}
