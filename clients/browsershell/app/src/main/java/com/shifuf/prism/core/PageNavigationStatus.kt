package com.shifuf.prism.core

/** Tracks the top-level navigation and the document it may replace in a single WebView. */
internal class PageNavigationStatus {
    enum class Finish { IGNORED, DOCUMENT, FAILURE, RESTORED }
    enum class HistoryUpdate { IGNORED, NEW_DOCUMENT, SAME_DOCUMENT }

    private data class Document(val url: String, val indicator: PageLoadIndicator)
    private enum class Phase { EXPECTED, STARTED, COMMITTED, SETTLED }

    @Volatile
    var url: String = "about:blank"
        private set

    var indicator = PageLoadIndicator()
        private set

    private var displayed = Document(url, indicator)
    private var phase = Phase.SETTLED
    private var committedUrl: String? = null
    private var traversingHistory = false
    private var supersededUrls = emptyList<String>()
    private var earlyError: Document? = null
    private var possibleCertificateError: Document? = null
    private var waitingForIdle: String? = null

    fun expect(target: String, visibleUrl: String?, historyTraversal: Boolean = false) {
        rememberSuperseded(listOfNotNull(url, visibleUrl), target)
        url = homeAlias(target)
        indicator = if (PageLoadStatusClassifier.isWebPage(url)) PageLoadIndicator(PageLoadState.LOADING)
        else PageLoadIndicator()
        phase = Phase.EXPECTED
        committedUrl = null
        traversingHistory = historyTraversal
        earlyError = null
        possibleCertificateError = null
        waitingForIdle = null
    }

    fun expectWebRequest(target: String, visibleUrl: String?): Boolean {
        if (!PageLoadStatusClassifier.isWebPage(target) || sameDocument(url, target)) return false
        expect(target, visibleUrl)
        return true
    }

    fun start(target: String, visibleUrl: String? = null): Boolean {
        if (target.isBlank()) return false
        val current = sameDocument(url, target)
        // Explicit requests remove their target from this list. A later unannounced
        // navigation can also revisit it once WebView reports it as visible.
        if (!current && wasSuperseded(target) &&
            !(phase == Phase.SETTLED && sameDocument(visibleUrl, target))) return false
        if (!current || phase == Phase.SETTLED) {
            val precedingError = earlyError?.takeIf { sameDocument(it.url, target) }
            expect(target, null)
            if (precedingError != null) indicator = precedingError.indicator
        }
        url = homeAlias(target)
        if (phase != Phase.COMMITTED) phase = Phase.STARTED
        waitingForIdle = null
        return true
    }

    /** WebView reports committed addresses here, including in-page history changes without page-start. */
    fun updateHistory(target: String, visibleUrl: String?): HistoryUpdate {
        if (target.isBlank()) return HistoryUpdate.IGNORED
        val canonicalTarget = homeAlias(target)
        val inDisplayedOrigin = PageLoadStatusClassifier.isSameWebOrigin(displayed.url, target)
        if (sameDocument(visibleUrl, target) && inDisplayedOrigin && (
                phase == Phase.SETTLED && sameDocument(displayed.url, url) ||
                    phase == Phase.EXPECTED && traversingHistory && sameDocument(url, target) ||
                    phase == Phase.COMMITTED
                )) {
            // Fragment and pushState traversals keep the outcome of the existing document.
            val changed = url != canonicalTarget || phase != Phase.COMMITTED && indicator != displayed.indicator
            url = canonicalTarget
            if (phase != Phase.COMMITTED) {
                indicator = displayed.indicator
                phase = Phase.SETTLED
                waitingForIdle = null
            }
            displayed = displayed.copy(url = canonicalTarget)
            return if (changed) HistoryUpdate.SAME_DOCUMENT else HistoryUpdate.IGNORED
        }
        if (phase == Phase.SETTLED || phase == Phase.COMMITTED || !sameDocument(url, target)) {
            return HistoryUpdate.IGNORED
        }
        phase = Phase.COMMITTED
        url = canonicalTarget
        committedUrl = canonicalTarget
        possibleCertificateError = null
        waitingForIdle = null
        displayed = Document(canonicalTarget, settledIndicator(canonicalTarget))
        return HistoryUpdate.NEW_DOCUMENT
    }

    fun finish(target: String, visibleUrl: String?, stillLoading: Boolean = false): Finish {
        val matchesCurrent = sameDocument(url, target) || sameDocument(committedUrl, target)
        val unannouncedCertificateFailure = !matchesCurrent && mayBeUnannounced(target) &&
            certificateErrorFor(target) != null && sameDocument(visibleUrl, displayed.url)
        if (!unannouncedCertificateFailure && (phase == Phase.SETTLED || !matchesCurrent)) {
            return Finish.IGNORED
        }
        val committed = phase == Phase.COMMITTED
        val visible = sameDocument(visibleUrl, url)
        val withoutCommit = unannouncedCertificateFailure ||
            !committed && !indicator.isError && PageLoadStatusClassifier.isWebPage(url)
        if (stillLoading && (committed || withoutCommit)) {
            // WebView synthesizes finishes for fragments and duplicates before the load is idle.
            // Use the original commit URL as the anchor even if pushState changes the visible URL.
            waitingForIdle = if (committed) committedUrl ?: target else target
            return Finish.IGNORED
        }
        if (withoutCommit) return finishWithoutCommit(target)
        waitingForIdle = null
        phase = Phase.SETTLED
        if (visible && (committed || !PageLoadStatusClassifier.isWebPage(url))) {
            indicator = settledIndicator(url)
            displayed = Document(url, indicator)
            return if (indicator.isConnectionFailure) Finish.FAILURE else Finish.DOCUMENT
        }
        return if (indicator.isError) Finish.FAILURE else restoreDisplayed()
    }

    fun loadingStopped(visibleUrl: String?): Finish =
        waitingForIdle?.let { finish(it, visibleUrl) } ?: Finish.IGNORED

    fun cancelPending(): Finish = if (phase == Phase.EXPECTED) restoreDisplayed() else Finish.IGNORED

    /** A download may end the matching request without committing or sending a page-finished callback. */
    fun cancelPending(target: String): Finish =
        if ((phase == Phase.EXPECTED || phase == Phase.STARTED) && sameDocument(url, target)) {
            restoreDisplayed()
        } else Finish.IGNORED

    /** A rejected connection can leave the old page visible without creating a history entry. */
    fun canRestoreAfterConnectionFailure(visibleUrl: String?): Boolean = indicator.isConnectionFailure &&
        !sameDocument(url, displayed.url) && sameDocument(visibleUrl, displayed.url)

    fun restoreAfterConnectionFailure(visibleUrl: String?): Finish =
        if (canRestoreAfterConnectionFailure(visibleUrl)) restoreDisplayed() else Finish.IGNORED

    fun networkError(target: String, mainFrame: Boolean, code: Int, description: String): Boolean {
        if (!mainFrame || !PageLoadStatusClassifier.isWebPage(target)) return false
        if (PageLoadStatusClassifier.isNavigationCancelled(code, description)) {
            if (!isCurrentWebPage(target) || indicator.isError || phase == Phase.SETTLED) return false
            finishWithoutCommit(target)
            return true
        }
        val error = if (code == -11) certificateErrorFor(target) ?: PageLoadStatusClassifier.networkError(code)
        else PageLoadStatusClassifier.networkError(code)
        if (!isCurrentWebPage(target)) {
            rememberEarlyError(target, error)
            return false
        }
        if (indicator.state == PageLoadState.CERTIFICATE_ERROR) return false
        applyError(error)
        return true
    }

    fun httpError(target: String, mainFrame: Boolean, code: Int, method: String? = null): Boolean {
        if (!mainFrame || !PageLoadStatusClassifier.isWebPage(target)) return false
        val error = PageLoadStatusClassifier.fromHttpResponse(code) ?: return false
        // WebView does not announce POST requests before the response. A form can
        // post back to a visited URL. Without a navigation ID, only a matching start
        // can distinguish a new response here from a callback for a settled document.
        if (phase == Phase.SETTLED && method.equals("POST", ignoreCase = true)) {
            earlyError = Document(target, error)
            return false
        }
        if (!isCurrentWebPage(target)) {
            rememberEarlyError(target, error)
            return false
        }
        if (indicator.isConnectionFailure) return false
        applyError(error)
        return true
    }

    fun certificateError(target: String, code: Int): Boolean {
        if (!PageLoadStatusClassifier.isWebPage(target)) return false
        val current = isCurrentWebPage(target)
        val error = PageLoadStatusClassifier.certificateError(code)
        if (current && indicator.state == PageLoadState.NETWORK_ERROR && indicator.errorCode == -11) {
            applyError(error)
            return true
        }
        // No main-frame bit is exposed here. Require an uncommitted main-frame
        // finish or handshake error for this URL before displaying this candidate.
        if (certificateErrorFor(waitingForIdle) != null && !sameDocument(waitingForIdle, target)) return false
        if (current && (phase == Phase.EXPECTED || phase == Phase.STARTED) ||
            !current && mayBeUnannounced(target) && certificateErrorFor(url) == null) {
            possibleCertificateError = Document(target, error)
        }
        return false
    }

    private fun certificateErrorFor(target: String?): PageLoadIndicator? =
        possibleCertificateError?.takeIf { sameDocument(target, it.url) }?.indicator

    private fun mayBeUnannounced(target: String): Boolean =
        (phase == Phase.SETTLED || phase == Phase.STARTED) && !wasSuperseded(target)

    private fun finishWithoutCommit(target: String): Finish {
        waitingForIdle = null
        val certificate = certificateErrorFor(target) ?: return restoreDisplayed()
        if (!sameDocument(url, target)) {
            rememberSuperseded(listOf(url), target)
            url = target
        }
        indicator = certificate
        phase = Phase.SETTLED
        committedUrl = null
        traversingHistory = false
        earlyError = null
        possibleCertificateError = null
        return Finish.FAILURE
    }

    private fun restoreDisplayed(): Finish {
        rememberSuperseded(listOf(url), displayed.url)
        url = displayed.url
        indicator = displayed.indicator
        phase = Phase.SETTLED
        committedUrl = null
        traversingHistory = false
        earlyError = null
        possibleCertificateError = null
        waitingForIdle = null
        return Finish.RESTORED
    }

    private fun applyError(error: PageLoadIndicator) {
        indicator = error
        if ((phase == Phase.COMMITTED || phase == Phase.SETTLED) && sameDocument(displayed.url, url)) {
            displayed = displayed.copy(indicator = error)
        }
    }

    private fun settledIndicator(target: String): PageLoadIndicator =
        if (indicator.isError) indicator else PageLoadStatusClassifier.onPageFinished(target)

    private fun rememberEarlyError(target: String, error: PageLoadIndicator) {
        if (!wasSuperseded(target)) earlyError = Document(target, error)
    }

    private fun rememberSuperseded(candidates: List<String>, target: String) {
        supersededUrls = (candidates + supersededUrls).distinct().filterNot { sameDocument(it, target) }.take(8)
    }

    private fun wasSuperseded(target: String): Boolean = supersededUrls.any { sameDocument(it, target) }

    private fun isCurrentWebPage(target: String): Boolean =
        PageLoadStatusClassifier.isWebPage(url) && sameDocument(url, target)

    private fun sameDocument(first: String?, second: String): Boolean = first != null &&
        (first == second || InternalPage.isHome(first) && InternalPage.isHome(second) ||
            PageLoadStatusClassifier.isCurrentMainFrameUrl(first, second))

    private fun homeAlias(target: String): String = if (InternalPage.isHome(target)) "about:home" else target
}
