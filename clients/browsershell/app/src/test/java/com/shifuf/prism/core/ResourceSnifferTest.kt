package com.shifuf.prism.core

import org.junit.Assert.assertEquals
import org.junit.Test

class ResourceSnifferTest {
    private val page = "https://example.test/player"

    @Test fun collectsDirectAudioFormatsFromTheUrlPath() {
        val sniffer = ResourceSniffer()
        val formats = mapOf(
            "track.MP3?token=abc" to ("audio/mpeg" to "mp3"),
            "track.m4a" to ("audio/mp4" to "m4a"),
            "track.aac" to ("audio/aac" to "aac"),
            "track.wav" to ("audio/wav" to "wav"),
            "track.flac" to ("audio/flac" to "flac"),
            "track.ogg" to ("audio/ogg" to "ogg"),
        )

        formats.keys.forEach { sniffer.onRequest("https://media.example.test/$it#t=10", "*/*", page) }

        assertEquals(
            formats.mapKeys { "https://media.example.test/${it.key}" },
            sniffer.snapshot(page).associate { it.url to (it.mimeHint to it.typeLabel) },
        )
    }

    @Test fun usesAConcreteAudioTypeOnAnExtensionlessLink() {
        val sniffer = ResourceSniffer()
        val url = "https://media.example.test/stream?id=12"

        sniffer.onRequest(url, " Audio/X-M4A ; codecs=mp4a.40.2 ", page)

        val resource = sniffer.snapshot(page).single()
        assertEquals(url, resource.url)
        assertEquals("audio/mp4", resource.mimeHint)
        assertEquals("m4a", resource.typeLabel)
    }

    @Test fun ignoresLocalAudioUrlsAndUnreliableHints() {
        val sniffer = ResourceSniffer()

        listOf(
            "file:///track.mp3" to "audio/mpeg",
            "data:audio/mpeg,track.mp3" to "audio/mpeg",
            "blob:https://media.example.test/track.mp3" to "audio/mpeg",
            "https:///track.mp3" to "audio/mpeg",
            "https://track.mp3" to "*/*",
            "https://media.example.test/player?name=track.mp3" to "text/html",
            "https://media.example.test/player#track.mp3" to "*/*",
            "https://media.example.test/track.mp3/cover.jpg" to "image/jpeg",
            "https://media.example.test/script.js" to "application/javascript",
            "https://media.example.test/stream" to "audio/*",
            "https://media.example.test/stream" to "audio/mpeg;q=0.8, text/html",
            "https://media.example.test/stream" to "audio/mpeg;q=0.000",
        ).forEach { (url, hint) -> sniffer.onRequest(url, hint, page) }

        assertEquals(emptyList<SniffedResource>(), sniffer.snapshot(page))
    }

    @Test fun aDirectAudioPathWinsOverAnAmbiguousAcceptList() {
        val sniffer = ResourceSniffer()
        val url = "https://media.example.test/track[1].mp3?token={id}"

        sniffer.onRequest(url, "video/mp4, audio/mpeg", page)

        assertEquals("audio/mpeg", sniffer.snapshot(page).single().mimeHint)
    }

    @Test fun aMediaTypeParameterCanContainAQuotedComma() {
        val sniffer = ResourceSniffer()

        sniffer.onRequest("https://media.example.test/asset", "audio/mp4; codecs=\"mp4a.40.2, opus\"", page)

        assertEquals("audio/mp4", sniffer.snapshot(page).single().mimeHint)
    }

    @Test fun aConcreteAudioHintCorrectsAnEarlierVideoGuessForTheSameUrl() {
        val sniffer = ResourceSniffer()
        val url = "https://media.example.test/asset.mp4"
        sniffer.onRequest(url, "*/*", page)
        sniffer.onRequest(url, "audio/mp4", page)

        assertEquals("audio/mp4", sniffer.snapshot(page).single().mimeHint)
    }

    @Test fun aLateRequestFromThePreviousPageCannotReplaceTheCurrentPageResults() {
        val sniffer = ResourceSniffer()
        val previous = "$page?episode=1"
        val current = "$page?episode=2"
        val currentMedia = "https://media.example.test/episode-2.mp3"
        sniffer.setPage(previous)
        sniffer.setPage(current)
        sniffer.onRequest(currentMedia, "", current)

        sniffer.onRequest("https://media.example.test/episode-1.mp3", "", previous)

        assertEquals(listOf(currentMedia), sniffer.snapshot(current).map { it.url })
    }

    @Test fun twoTabsAtTheSameAddressKeepIndependentMediaLists() {
        val sniffer = ResourceSniffer()
        val firstAsset = "https://media.example.test/first.mp3"
        val secondAsset = "https://media.example.test/second.mp4"
        sniffer.setPage(page, "first")
        sniffer.setPage(page, "second")
        sniffer.activate("first")

        sniffer.onRequest(firstAsset, "audio/mpeg", page, "first")
        sniffer.onRequest(secondAsset, "video/mp4", page, "second")

        assertEquals(listOf(firstAsset), sniffer.snapshot(page).map { it.url })
        sniffer.activate("second")
        assertEquals(listOf(secondAsset), sniffer.snapshot(page).map { it.url })
        sniffer.clear("first", page)
        assertEquals(listOf(secondAsset), sniffer.snapshot(page).map { it.url })
        sniffer.forget("second")
        sniffer.onRequest(secondAsset, "video/mp4", page, "second")
        assertEquals(emptyList<SniffedResource>(), sniffer.snapshot(page, "second"))
    }

    @Test fun sameDocumentHistoryKeepsExistingMediaAndUsesTheNewAddress() {
        val sniffer = ResourceSniffer()
        val route = "https://example.test/shows/latest"
        val track = "https://media.example.test/theme.aac"
        sniffer.setPage(page, "tab")
        sniffer.onRequest(track, "", page, "tab")

        sniffer.setPage(route, "tab", sameDocument = true)

        assertEquals(listOf(track), sniffer.snapshot(route, "tab").map { it.url })
        assertEquals(emptyList<SniffedResource>(), sniffer.snapshot(page, "tab"))
    }

    @Test fun anUnavailablePageHidesItsMediaWithoutChangingOtherTabs() {
        val sniffer = ResourceSniffer()
        val original = "https://media.example.test/original.wav"
        val late = "https://media.example.test/late.wav"
        sniffer.setPage(page, "failed", version = 1)
        sniffer.setPage(page, "other", version = 1)
        sniffer.onRequest(original, "", page, "failed", version = 1)
        sniffer.onRequest(original, "", page, "other", version = 1)
        val resource = sniffer.snapshot(scopeId = "failed").single()

        sniffer.setPageAvailable("failed", available = false)
        sniffer.onRequest(late, "", page, "failed", version = 1)

        assertEquals("", sniffer.pageUrl("failed"))
        assertEquals(emptyList<SniffedResource>(), sniffer.snapshot(scopeId = "failed"))
        assertEquals(listOf(original), sniffer.snapshot(scopeId = "other").map { it.url })
        assertEquals(false, sniffer.isCurrent(resource, "failed"))

        sniffer.setPageAvailable("failed", available = true)
        assertEquals(page, sniffer.pageUrl("failed"))
        assertEquals(listOf(original), sniffer.snapshot(scopeId = "failed").map { it.url })
        assertEquals(true, sniffer.isCurrent(resource, "failed"))

        sniffer.setPage(page, "failed", version = 2)
        sniffer.onRequest(original, "", page, "failed", version = 2)
        assertEquals(false, sniffer.isCurrent(resource, "failed"))
    }

    @Test fun committingANewDocumentAtTheSameUrlClearsOldResults() {
        val sniffer = ResourceSniffer()
        sniffer.setPage(page, "tab")
        sniffer.onRequest("https://media.example.test/old.mp3", "", page, "tab")

        sniffer.setPage(page, "tab")

        assertEquals(emptyList<SniffedResource>(), sniffer.snapshot(page, "tab"))
    }

    @Test fun aWebViewAddressWithBracketsCanHaveItsOwnResults() {
        val sniffer = ResourceSniffer()
        val browserPage = "https://example.test/watch[1]?arg={foo}"
        val track = "https://media.example.test/theme.aac"
        sniffer.setPage(browserPage, "tab")
        sniffer.onRequest(track, "", browserPage, "tab")

        assertEquals(listOf(track), sniffer.snapshot(browserPage, "tab").map { it.url })
    }

    @Test fun deduplicatesFragmentsWhilePreservingDistinctQueryStrings() {
        val sniffer = ResourceSniffer()
        val url = "https://media.example.test/track.mp3"

        sniffer.onRequest("$url?token=1#t=3", "audio/mpeg", page)
        sniffer.onRequest("$url?token=1#t=30", "audio/mpeg", page)
        sniffer.onRequest("$url?token=2", "audio/mpeg", page)

        assertEquals(listOf("$url?token=2", "$url?token=1"), sniffer.snapshot(page).map { it.url })
    }

    @Test fun keepsVideoAndPlaylistResults() {
        val sniffer = ResourceSniffer()
        val inputs = mapOf(
            "video.mp4?token=123" to ("video/mp4" to "mp4"),
            "video.webm" to ("*/*" to "webm"),
            "playlist" to ("audio/x-mpegurl" to "m3u8"),
        )

        inputs.forEach { (path, format) -> sniffer.onRequest("https://media.example.test/$path", format.first, page) }

        assertEquals(
            inputs.mapKeys { "https://media.example.test/${it.key}" },
            sniffer.snapshot(page).associate { it.url to (it.mimeHint to it.typeLabel) },
        )
    }
}
