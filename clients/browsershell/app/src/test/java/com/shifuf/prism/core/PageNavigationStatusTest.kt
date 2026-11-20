package com.shifuf.prism.core

import com.shifuf.prism.core.PageNavigationStatus.Finish.DOCUMENT
import com.shifuf.prism.core.PageNavigationStatus.Finish.FAILURE
import com.shifuf.prism.core.PageNavigationStatus.Finish.IGNORED
import com.shifuf.prism.core.PageNavigationStatus.Finish.RESTORED
import com.shifuf.prism.core.PageNavigationStatus.HistoryUpdate
import com.shifuf.prism.core.PageNavigationStatus.HistoryUpdate.NEW_DOCUMENT
import com.shifuf.prism.core.PageNavigationStatus.HistoryUpdate.SAME_DOCUMENT
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageNavigationStatusTest {
    @Test
    fun oldDocumentCallbacksCannotReplaceARequestedPage() {
        val old = "https://old.example/"
        val next = "https://new.example/"
        val navigation = loaded(old)
        navigation.expect(next, old)

        assertFalse(navigation.networkError(old, true, -2, ""))
        assertFalse(navigation.httpError(old, true, 503))
        assertFalse(navigation.certificateError(old, 3))
        assertFalse(navigation.start(old))
        assertEquals(IGNORED, navigation.finish(old, old))
        assertEquals(next, navigation.url)
        assertEquals(PageLoadState.LOADING, navigation.indicator.state)
        assertTrue(navigation.start(next))
        commitAndFinish(navigation, next)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun redirectResponseBeforePageStartBelongsToTheTarget() {
        val initial = "http://example.com/go"
        val target = "https://other.example/error"
        val navigation = PageNavigationStatus()
        navigation.expect(initial, null)
        assertTrue(navigation.expectWebRequest(target, initial))

        assertTrue(navigation.httpError(target, true, 404))
        assertTrue(navigation.start(target))
        assertEquals(IGNORED, navigation.finish(initial, initial))
        assertFalse(navigation.networkError(initial, true, -1, "net::ERR_ABORTED"))
        commitAndFinish(navigation, target)
        assertEquals(target, navigation.url)
        assertEquals(PageLoadIndicator(PageLoadState.HTTP_CLIENT_ERROR, httpStatusCode = 404), navigation.indicator)
    }

    @Test
    fun startAcceptsTheFinalRedirectUrlWithoutASeparateRequestCallback() {
        val initial = "http://example.com/go"
        val target = "https://other.example/final"
        val navigation = loaded("https://previous.example/")
        navigation.expect(initial, "https://previous.example/")

        assertTrue(navigation.start(target))
        assertEquals(IGNORED, navigation.finish(initial, initial))
        commitAndFinish(navigation, target)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun certificateDetailsSurviveGenericErrorsAndPageFinish() {
        val url = "https://example.com/"
        val navigation = PageNavigationStatus()
        navigation.expect(url, null)
        navigation.start(url)

        assertFalse(navigation.certificateError(url, 3))
        assertTrue(navigation.networkError(url, true, -11, "net::ERR_SSL_PROTOCOL_ERROR"))
        assertFalse(navigation.networkError(url, true, -1, "net::ERR_ABORTED"))
        assertEquals(FAILURE, navigation.finish(url, "chrome-error://chromewebdata/"))
        assertEquals(PageLoadIndicator(PageLoadState.CERTIFICATE_ERROR, errorCode = 3), navigation.indicator)
    }

    @Test
    fun aCancelledCertificateCanBeReportedWithoutANetworkErrorCallback() {
        val url = "https://untrusted.example/"
        val shown = "https://shown.example/"
        val navigation = loaded(shown)
        navigation.expect(url, shown)

        assertFalse(navigation.certificateError(url, 3))
        assertEquals(FAILURE, navigation.finish(url, shown))
        assertEquals(url, navigation.url)
        assertEquals(PageLoadIndicator(PageLoadState.CERTIFICATE_ERROR, errorCode = 3), navigation.indicator)
    }

    @Test
    fun aCertificateFailureCanFinishAtWebViewsCanonicalPathWithoutStarting() {
        val requested = "https://untrusted.example/a/../b"
        val callback = "https://untrusted.example/b"
        val shown = "https://example.com/current"
        val navigation = loaded(shown)
        navigation.expect(requested, shown)

        assertFalse(navigation.certificateError(callback, 3))
        assertEquals(FAILURE, navigation.finish(callback, shown))
        assertEquals(PageLoadIndicator(PageLoadState.CERTIFICATE_ERROR, errorCode = 3), navigation.indicator)
        assertTrue(navigation.canRestoreAfterConnectionFailure(shown))
    }

    @Test
    fun backCanRestoreTheVisiblePageAfterAnUncommittedConnectionFailure() {
        val shown = "https://example.com/current"
        val failed = "https://offline.example/"
        val navigation = loaded(shown)
        navigation.expect(failed, shown)
        assertTrue(navigation.networkError(failed, true, -2, ""))

        assertFalse(navigation.canRestoreAfterConnectionFailure(failed))
        assertTrue(navigation.canRestoreAfterConnectionFailure(shown))
        assertEquals(RESTORED, navigation.restoreAfterConnectionFailure(shown))
        assertEquals(shown, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
        assertEquals(IGNORED, navigation.finish(failed, shown))
    }

    @Test
    fun aCancelledCertificateForAnUnannouncedPostTargetIsReportedOnItsFinish() {
        val url = "https://untrusted.example/form-result"
        val shown = "https://example.com/form"
        val navigation = loaded(shown)

        assertFalse(navigation.certificateError(url, 1))
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
        assertEquals(shown, navigation.url)
        assertEquals(IGNORED, navigation.finish("https://other.example/", shown))
        assertEquals(FAILURE, navigation.finish(url, shown))
        assertEquals(url, navigation.url)
        assertEquals(PageLoadIndicator(PageLoadState.CERTIFICATE_ERROR, errorCode = 1), navigation.indicator)
    }

    @Test
    fun aLateCertificateAndFinishForASupersededRequestDoNotReplaceTheNextPage() {
        val shown = "https://example.com/form"
        val superseded = "https://untrusted.example/form-result"
        val next = "https://example.com/next"
        val navigation = loaded(shown)
        navigation.expect(superseded, shown)
        navigation.expect(next, shown)

        assertFalse(navigation.certificateError(superseded, 1))
        assertEquals(IGNORED, navigation.finish(superseded, shown))
        assertEquals(next, navigation.url)
        assertTrue(navigation.start(next))
        commitAndFinish(navigation, next)
    }

    @Test
    fun anUnannouncedCertificateFailureCanWaitForTheWebViewToStopLoading() {
        val url = "https://untrusted.example/form-result"
        val shown = "https://example.com/form"
        val navigation = loaded(shown)

        assertFalse(navigation.certificateError(url, 1))
        assertEquals(IGNORED, navigation.finish(url, shown, stillLoading = true))
        assertEquals(shown, navigation.url)
        assertFalse(navigation.certificateError("https://other.example/resource.png", 3))
        assertEquals(FAILURE, navigation.loadingStopped(shown))
        assertEquals(url, navigation.url)
        assertEquals(PageLoadIndicator(PageLoadState.CERTIFICATE_ERROR, errorCode = 1), navigation.indicator)
    }

    @Test
    fun anSslCallbackWithoutAMainFrameFailureCannotPoisonACommittedPage() {
        val url = "https://example.com/"
        val navigation = PageNavigationStatus()
        navigation.expect(url, null)
        navigation.start(url)

        assertFalse(navigation.certificateError(url, 3))
        commitAndFinish(navigation, url)
        assertFalse(navigation.certificateError(url, 3))
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun retryClearsAnHttpErrorAndALateHttpErrorCanStillBeShown() {
        val url = "https://example.com/"
        val navigation = loaded(url)
        assertTrue(navigation.httpError(url, true, 503))
        assertEquals(PageLoadState.HTTP_SERVER_ERROR, navigation.indicator.state)

        navigation.expect(url, url)
        assertEquals(PageLoadState.LOADING, navigation.indicator.state)
        assertTrue(navigation.start(url))
        commitAndFinish(navigation, url)
        assertEquals(PageLoadIndicator(PageLoadState.SECURE), navigation.indicator)
    }

    @Test
    fun fragmentNavigationRetainsTheCurrentHttpOutcome() {
        val url = "https://example.com/not-found"
        val navigation = loaded(url)
        assertTrue(navigation.httpError(url, true, 404))

        assertFalse(navigation.expectWebRequest("$url#help", url))
        assertEquals(SAME_DOCUMENT, navigation.updateHistory("$url#help", "$url#help"))
        assertEquals(IGNORED, navigation.finish("$url#help", "$url#help"))
        assertEquals(PageLoadIndicator(PageLoadState.HTTP_CLIENT_ERROR, httpStatusCode = 404), navigation.indicator)
    }

    @Test
    fun fragmentBackDoesNotTurnAnHttpErrorGreen() {
        val page = "https://example.com/not-found"
        val navigation = loaded("$page#help")
        navigation.httpError(page, true, 404)

        navigation.expect(page, "$page#help", historyTraversal = true)
        assertEquals(SAME_DOCUMENT, navigation.updateHistory(page, page))
        assertEquals(IGNORED, navigation.finish(page, page))

        assertEquals(page, navigation.url)
        assertEquals(PageLoadState.HTTP_CLIENT_ERROR, navigation.indicator.state)
    }

    @Test
    fun pushStateBackAndForwardSettleWithoutPageStartOrFinish() {
        val original = "https://example.com/shop"
        val route = "https://example.com/account?tab=1"
        val navigation = loaded(original)
        assertEquals(SAME_DOCUMENT, navigation.updateHistory(route, route))
        assertEquals(route, navigation.url)

        navigation.expect(original, route, historyTraversal = true)
        assertEquals(SAME_DOCUMENT, navigation.updateHistory(original, original))
        assertEquals(original, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)

        navigation.expect(route, original, historyTraversal = true)
        assertEquals(SAME_DOCUMENT, navigation.updateHistory(route, route))
        assertEquals(route, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun backToADifferentDocumentOfTheSameOriginUsesItsOwnResponse() {
        val original = "https://example.com/shop"
        val failed = "https://example.com/failing-page"
        val navigation = loaded(failed)
        navigation.httpError(failed, true, 503)

        navigation.expect(original, failed, historyTraversal = true)
        assertTrue(navigation.start(original))
        commitAndFinish(navigation, original)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun initialCommitAndSubsequentFragmentReportDifferentHistoryUpdates() {
        val page = "https://example.com/page"
        val fragment = "$page#help"
        val navigation = PageNavigationStatus()
        navigation.expect(page, null)
        assertTrue(navigation.start(page))

        assertEquals(NEW_DOCUMENT, navigation.updateHistory(page, page))
        assertEquals(SAME_DOCUMENT, navigation.updateHistory(fragment, fragment))
        assertEquals(HistoryUpdate.IGNORED, navigation.updateHistory(fragment, fragment))
        assertEquals(fragment, navigation.url)
        assertEquals(PageLoadState.LOADING, navigation.indicator.state)
        assertEquals(DOCUMENT, navigation.finish(page, fragment))
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun aSyntheticFragmentFinishWaitsForTheCommittedDocumentToStopLoading() {
        val page = "https://example.com/page"
        val fragment = "$page#help"
        val navigation = PageNavigationStatus()
        navigation.expect(page, null)
        assertTrue(navigation.start(page))
        assertEquals(NEW_DOCUMENT, navigation.updateHistory(page, page))
        assertEquals(SAME_DOCUMENT, navigation.updateHistory(fragment, fragment))

        assertEquals(IGNORED, navigation.finish(fragment, fragment, stillLoading = true))
        assertEquals(PageLoadState.LOADING, navigation.indicator.state)
        assertEquals(DOCUMENT, navigation.loadingStopped(fragment))
        assertEquals(fragment, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
        assertEquals(IGNORED, navigation.finish(page, fragment))
        assertEquals(IGNORED, navigation.loadingStopped(fragment))
    }

    @Test
    fun aDeferredFragmentFinishFollowsSubsequentSpaRouteChanges() {
        val page = "https://example.com/page"
        val route = "https://example.com/account#help"
        val nextRoute = "https://example.com/account/preferences"
        val navigation = PageNavigationStatus()
        navigation.expect(page, null)
        assertTrue(navigation.start(page))
        assertEquals(NEW_DOCUMENT, navigation.updateHistory(page, page))
        assertEquals(SAME_DOCUMENT, navigation.updateHistory(route, route))
        assertEquals(IGNORED, navigation.finish(route, route, stillLoading = true))

        assertEquals(SAME_DOCUMENT, navigation.updateHistory(nextRoute, nextRoute))
        assertEquals(PageLoadState.LOADING, navigation.indicator.state)
        assertEquals(DOCUMENT, navigation.loadingStopped(nextRoute))
        assertEquals(nextRoute, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
        assertEquals(IGNORED, navigation.finish(nextRoute, nextRoute))
    }

    @Test
    fun aSameUrlRetryWithoutACommitKeepsTheVisibleError() {
        val url = "https://example.com/temporarily-unavailable"
        val navigation = loaded(url)
        navigation.httpError(url, true, 503)
        navigation.expect(url, url)

        assertEquals(RESTORED, navigation.finish(url, url))

        assertEquals(PageLoadIndicator(PageLoadState.HTTP_SERVER_ERROR, httpStatusCode = 503), navigation.indicator)
    }

    @Test
    fun aNoContentNavigationRestoresTheDisplayedPageWithoutClaimingSuccess() {
        val old = "http://example.com/"
        val next = "https://unreached.example/"
        val navigation = loaded(old)
        navigation.expect(next, old)

        assertEquals(RESTORED, navigation.finish(next, old))
        assertEquals(old, navigation.url)
        assertEquals(PageLoadState.INSECURE, navigation.indicator.state)
        assertEquals(IGNORED, navigation.finish(next, next))
    }

    @Test
    fun syntheticFinishForAnUncommittedSameUrlReloadDoesNotShowSuccess() {
        val url = "https://example.com/"
        val navigation = loaded(url)
        navigation.expect(url, url)

        assertEquals(IGNORED, navigation.finish(url, url, stillLoading = true))
        assertEquals(PageLoadState.LOADING, navigation.indicator.state)
        assertTrue(navigation.start(url))
        commitAndFinish(navigation, url)
    }

    @Test
    fun aDeferredUncommittedFinishRestoresTheDisplayedPageWhenLoadingStops() {
        val url = "https://example.com/status"
        val navigation = loaded(url)
        navigation.httpError(url, true, 503)
        navigation.expect(url, url)

        assertEquals(IGNORED, navigation.finish(url, url, stillLoading = true))
        assertEquals(RESTORED, navigation.loadingStopped(url))
        assertEquals(PageLoadState.HTTP_SERVER_ERROR, navigation.indicator.state)
    }

    @Test
    fun decliningFormResubmissionRestoresTheResultAlreadyOnScreen() {
        val url = "https://example.com/result"
        val navigation = loaded(url)
        navigation.httpError(url, true, 503)
        navigation.expect(url, url)

        assertEquals(RESTORED, navigation.cancelPending())
        assertEquals(url, navigation.url)
        assertEquals(PageLoadState.HTTP_SERVER_ERROR, navigation.indicator.state)
    }

    @Test
    fun aMatchingAttachmentDownloadRestoresTheDisplayedDocument() {
        val shown = "https://example.com/page"
        val attachment = "https://example.com/attachment.zip"
        val navigation = loaded(shown)
        navigation.httpError(shown, true, 503)
        assertTrue(navigation.expectWebRequest(attachment, shown))

        assertEquals(IGNORED, navigation.cancelPending("https://example.com/older-download.zip"))
        assertEquals(attachment, navigation.url)
        assertEquals(RESTORED, navigation.cancelPending(attachment))
        assertEquals(shown, navigation.url)
        assertEquals(PageLoadState.HTTP_SERVER_ERROR, navigation.indicator.state)
    }

    @Test
    fun aDelayedDownloadCallbackCannotCancelAnAlreadyCommittedDocument() {
        val shown = "https://example.com/page"
        val target = "https://example.com/attachment.zip"
        val navigation = loaded(shown)
        navigation.expect(target, shown)
        assertTrue(navigation.start(target))
        assertEquals(NEW_DOCUMENT, navigation.updateHistory(target, target))

        assertEquals(IGNORED, navigation.cancelPending(target))
        assertEquals(DOCUMENT, navigation.finish(target, target))
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun unannouncedHttpErrorIsScopedUntilTheFailingDocumentStarts() {
        val old = "https://example.com/form"
        val failed = "https://other.example/post-target"
        val navigation = loaded(old)

        assertFalse(navigation.httpError(failed, true, 503))
        assertEquals(old, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
        assertTrue(navigation.start(failed))
        commitAndFinish(navigation, failed)
        assertEquals(PageLoadIndicator(PageLoadState.HTTP_SERVER_ERROR, httpStatusCode = 503), navigation.indicator)
    }

    @Test
    fun earlyHttpErrorForASameUrlPostSurvivesTheStartCallback() {
        val url = "https://example.com/form"
        val navigation = loaded(url)

        assertFalse(navigation.httpError(url, true, 503, method = "POST"))
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
        assertTrue(navigation.start(url))
        commitAndFinish(navigation, url)
        assertEquals(PageLoadIndicator(PageLoadState.HTTP_SERVER_ERROR, httpStatusCode = 503), navigation.indicator)
    }

    @Test
    fun earlyPostErrorForAPreviouslyVisitedUrlSurvivesItsVisibleStart() {
        val result = "https://example.com/result"
        val form = "https://example.com/form"
        val navigation = loaded(result)
        navigation.expect(form, result)
        assertTrue(navigation.start(form))
        commitAndFinish(navigation, form)

        assertFalse(navigation.httpError(result, true, 503, method = "POST"))
        assertFalse(navigation.start(result, form))
        assertEquals(form, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
        assertTrue(navigation.start(result, result))
        commitAndFinish(navigation, result)
        assertEquals(PageLoadIndicator(PageLoadState.HTTP_SERVER_ERROR, httpStatusCode = 503), navigation.indicator)
    }

    @Test
    fun aStalePageStartAfterAnotherNavigationFinishesIsIgnored() {
        val old = "https://old.example/"
        val next = "https://new.example/"
        val navigation = loaded(old)
        navigation.expect(next, old)
        navigation.start(next)
        commitAndFinish(navigation, next)

        assertFalse(navigation.start(old))
        assertEquals(next, navigation.url)
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)

        navigation.expect(old, next, historyTraversal = true)
        assertTrue(navigation.start(old))
        commitAndFinish(navigation, old)
        assertEquals(old, navigation.url)
    }

    @Test
    fun anAnnouncedAbortDoesNotBecomeAnHttpsSuccess() {
        val url = "https://example.com/"
        val navigation = PageNavigationStatus()
        navigation.expect(url, null)

        assertTrue(navigation.networkError(url, true, -1, "net::ERR_ABORTED"))
        assertEquals(IGNORED, navigation.finish(url, url))
        assertEquals(PageLoadState.IDLE, navigation.indicator.state)
    }

    @Test
    fun evenASubresourceMatchingTheMainFrameUrlCannotSetItsStatus() {
        val url = "https://example.com/"
        val navigation = loaded(url)

        assertFalse(navigation.networkError(url, false, -2, ""))
        assertFalse(navigation.httpError(url, false, 503))
        assertEquals(PageLoadState.SECURE, navigation.indicator.state)
    }

    @Test
    fun anotherTabAndReturningHomeDoNotInheritAWebpageError() {
        val first = "https://one.example/"
        val second = "https://two.example/"
        val foreground = loaded(first)
        val background = loaded(second)
        assertTrue(background.networkError(second, true, -2, ""))
        assertEquals(PageLoadState.SECURE, foreground.indicator.state)
        assertEquals(PageLoadState.NETWORK_ERROR, background.indicator.state)

        background.expect("about:home", second)
        assertFalse(background.networkError(second, true, -2, ""))
        assertEquals(DOCUMENT, background.finish("https://home.local/", "https://home.local/"))
        assertEquals("about:home", background.url)
        assertEquals(PageLoadState.IDLE, background.indicator.state)
    }

    private fun loaded(url: String): PageNavigationStatus = PageNavigationStatus().apply {
        expect(url, null)
        assertTrue(start(url))
        commitAndFinish(this, url)
    }

    private fun commitAndFinish(navigation: PageNavigationStatus, url: String) {
        assertEquals(NEW_DOCUMENT, navigation.updateHistory(url, url))
        assertEquals(DOCUMENT, navigation.finish(url, url))
    }
}
