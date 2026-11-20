package com.shifuf.prism.core

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Build
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.script.GmBridge
import com.shifuf.prism.script.UserscriptInjector
import java.io.ByteArrayInputStream
import java.io.File
import kotlinx.coroutines.launch

class BrowserController(
    private val webView: WebView,
    private val callbacks: Callbacks
) {
    interface Callbacks {
        fun onUrlChanged(url: String)
        fun onTitleChanged(title: String)
        fun onProgress(progress: Int)
        fun onStatus(text: String)
        fun onIconChanged(icon: android.graphics.Bitmap?) {}
        fun onHomeAction(uri: String) {}
        /** Long-press on a link/image-link. */
        fun onLinkLongPress(url: String, isImage: Boolean) {}
        /** WebView vertical scroll position changed (for pull-to-refresh gating). */
        fun onScrollChanged(scrollY: Int) {}
    }

    private val app get() = BrowserApp.instance
    private val injector = UserscriptInjector(webView)
    private var currentPageUrl: String = "about:blank"
    private var currentTitle: String = ""
    private var navigationVersion = 0L
    private var pendingHomeAppearance: Pair<Long, String>? = null

    fun evaluateJs(script: String) {
        runCatching { webView.evaluateJavascript(script, null) }
    }

    init {
        setupWebView()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        WebView.setWebContentsDebuggingEnabled(com.shifuf.prism.BuildConfig.DEBUG || app.prefs.debugServerEnabled)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            loadsImagesAutomatically = true
            blockNetworkImage = false
            allowFileAccess = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }
            @Suppress("DEPRECATION")
            layoutAlgorithm = WebSettings.LayoutAlgorithm.NORMAL
            textZoom = 100
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            // Reduce overdraw / offscreen work
            offscreenPreRaster = false
        }
        // Set UA once at init. NEVER change userAgentString mid-load — that reloads the page.
        applyUserAgentSettingsOnly()
        webView.setInitialScale(0)
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.overScrollMode = android.view.View.OVER_SCROLL_IF_CONTENT_SCROLLS
        webView.isNestedScrollingEnabled = true
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)
        // Smoother fling feel on many OEM WebViews
        webView.settings.setSupportZoom(true)
        webView.isScrollbarFadingEnabled = true
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            webView.post {
                confirmDownload(url, userAgent, contentDisposition, mimeType)
            }
        }
        // Long-press links / images → native action sheet
        webView.setOnLongClickListener {
            handleLinkLongClick()
        }
        // Track scroll so pull-to-refresh only arms at absolute top
        webView.setOnScrollChangeListener { _, _, scrollY, _, _ ->
            callbacks.onScrollChanged(scrollY)
        }
        webView.addJavascriptInterface(GmBridge(webView), GmBridge.INTERFACE_NAME)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val u = request?.url?.toString().orEmpty()
                if (u.isBlank()) return false
                // Custom in-app search protocol
                if (u.startsWith("bssearch://")) {
                    val q = android.net.Uri.decode(u.removePrefix("bssearch://"))
                    view?.post { load(app.prefs.searchEngine.search(q)) }
                    return true
                }
                if (u.startsWith("bshome://")) {
                    // Only our top-level home document may request local history/actions.
                    if (request?.isForMainFrame != true || !InternalPage.isHome(view?.url.orEmpty()) ||
                        currentPageUrl != PreferenceStore.HOME_URL) return true
                    val action = android.net.Uri.parse(u)
                    if (action.host == "navigate") {
                        val input = action.getQueryParameter("q").orEmpty()
                        if (input.isNotBlank()) {
                            evaluateJs("window.dismissHomeSearch && window.dismissHomeSearch()")
                            (webView.context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)
                                ?.hideSoftInputFromWindow(webView.windowToken, 0)
                            load(input)
                        }
                    } else if (action.host == "suggest") {
                        val query = action.getQueryParameter("q").orEmpty().take(2048)
                        val token = action.getQueryParameter("token")?.toLongOrNull() ?: return true
                        val items = org.json.JSONArray()
                        SearchSuggestions.suggest(query).forEach { item ->
                            items.put(org.json.JSONObject().put("title", item.title).put("subtitle", item.subtitle)
                                .put("url", item.url).put("kind", item.kind.name))
                        }
                        evaluateJs("window.showHomeSuggestions && window.showHomeSuggestions($token,${org.json.JSONObject.quote(query)},$items)")
                    } else {
                        callbacks.onHomeAction(u)
                    }
                    return true
                }
                if (u == PreferenceStore.HOME_URL || u.startsWith("about:home")) {
                    view?.post { loadHome() }
                    return true
                }
                // CRITICAL: allow normal page scripts / anchors / blobs.
                // Blocking javascript: breaks "back to top", SPA routers, and many widgets.
                if (u.startsWith("javascript:") ||
                    u.startsWith("about:blank") ||
                    u.startsWith("blob:") ||
                    u.startsWith("data:") ||
                    u.startsWith("http://") ||
                    u.startsWith("https://") ||
                    u.startsWith("file:") ||
                    u.startsWith("#") ||
                    u.startsWith("about:")
                ) {
                    // Keep in-app home URL from leaking into chrome
                    if (InternalPage.isHome(u)) {
                        view?.post { loadHome() }
                        return true
                    }
                    return false
                }
                // tel/mailto/intent etc. leave to system if possible, else ignore
                return runCatching {
                    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(u))
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    webView.context.startActivity(intent)
                    true
                }.getOrDefault(true)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                val real = when {
                    url.isNullOrBlank() -> currentPageUrl
                    InternalPage.isHome(url) -> PreferenceStore.HOME_URL
                    else -> url
                }
                if (real != PreferenceStore.HOME_URL) navigationVersion++
                currentPageUrl = real
                currentTitle = if (real == PreferenceStore.HOME_URL) "主页" else ""
                app.sniffer.setPage(if (real == PreferenceStore.HOME_URL) "" else real)
                callbacks.onUrlChanged(currentPageUrl)
                callbacks.onStatus("加载中…")
                injectUaSpoof()
                if (real == PreferenceStore.HOME_URL) {
                    callbacks.onTitleChanged("主页")
                } else {
                    val host = runCatching { android.net.Uri.parse(currentPageUrl).host }.getOrNull()
                    if (!host.isNullOrBlank()) callbacks.onTitleChanged(host)
                    injector.injectForUrl(url, "start")
                }
                if (app.prefs.debugServerEnabled) {
                    app.debugServer.broadcastEvent(
                        "page.started",
                        mapOf("url" to currentPageUrl)
                    )
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                val finished = when {
                    url.isNullOrBlank() -> currentPageUrl
                    InternalPage.isHome(url) -> PreferenceStore.HOME_URL
                    else -> url
                }
                currentPageUrl = finished
                val pageTitle = view?.title?.trim().orEmpty()
                if (finished == PreferenceStore.HOME_URL) {
                    applyPendingHomeAppearance()
                    currentTitle = "主页"
                    callbacks.onTitleChanged("主页")
                } else if (pageTitle.isNotBlank() &&
                    !pageTitle.equals("about:blank", true) &&
                    pageTitle != currentPageUrl &&
                    !pageTitle.startsWith("data:")
                ) {
                    currentTitle = pageTitle
                    callbacks.onTitleChanged(currentTitle)
                }
                callbacks.onUrlChanged(currentPageUrl)
                callbacks.onStatus("完成")
                if (currentPageUrl != PreferenceStore.HOME_URL && !currentPageUrl.startsWith("data:")) {
                    injectUaSpoof()
                    injector.injectForUrl(if (finished == PreferenceStore.HOME_URL) url else finished, "end")
                    injectElementHidingSafe()
                    injectVideoProbe()
                    if (!app.prefs.privateMode && currentTitle.isNotBlank()) {
                        app.historyStore.add(currentTitle, currentPageUrl)
                    }
                }
                if (!app.prefs.privateMode) {
                    app.prefs.lastUrl = currentPageUrl
                }
                if (app.prefs.debugServerEnabled) {
                    app.debugServer.broadcastEvent(
                        "page.finished",
                        mapOf("url" to currentPageUrl, "title" to currentTitle)
                    )
                }
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url?.toString() ?: return null
                val isMainFrame = request.isForMainFrame
                val typeHint = request.requestHeaders["Accept"]
                    ?: request.requestHeaders["accept"]
                val looksVideo = ResourceSniffer.isVideo(url, typeHint.orEmpty())
                // Fast path: skip adblock + logging when disabled and not interesting
                val adOn = app.prefs.adBlockEnabled
                val blocked = !isMainFrame &&
                    !looksVideo &&
                    adOn &&
                    app.adBlock.shouldBlock(url, pageUrl = currentPageUrl)
                if (blocked) {
                    if (app.prefs.debugServerEnabled) {
                        runCatching {
                            app.networkLog.add(url, request.method ?: "GET", typeHint ?: "other", currentPageUrl, true)
                        }
                    } else {
                        runCatching {
                            app.networkLog.add(url, request.method ?: "GET", "blocked", currentPageUrl, true)
                        }
                    }
                    return emptyResponse()
                }
                if (looksVideo) {
                    app.sniffer.onRequest(url, typeHint ?: "video", currentPageUrl)
                    runCatching {
                        app.networkLog.add(url, request.method ?: "GET", typeHint ?: "video", currentPageUrl, false)
                    }
                } else if (isMainFrame) {
                    runCatching {
                        app.networkLog.add(url, request.method ?: "GET", "document", currentPageUrl, false)
                    }
                }
                return null
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                callbacks.onProgress(newProgress)
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                val t = title?.trim().orEmpty()
                if (t.isBlank() || t.equals("about:blank", true)) return
                // Ignore raw URL titles
                if (t.startsWith("http://") || t.startsWith("https://")) return
                currentTitle = t
                callbacks.onTitleChanged(currentTitle)
            }

            override fun onReceivedIcon(view: WebView?, icon: android.graphics.Bitmap?) {
                if (icon != null && !icon.isRecycled) {
                    callbacks.onIconChanged(icon)
                }
            }

            // Fullscreen video support
            private var customView: android.view.View? = null
            private var customCallback: CustomViewCallback? = null

            override fun onShowCustomView(view: android.view.View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customCallback = callback
                (webView.parent as? android.view.ViewGroup)?.let { parent ->
                    parent.addView(
                        view,
                        android.view.ViewGroup.LayoutParams(
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                }
            }

            override fun onHideCustomView() {
                (customView?.parent as? android.view.ViewGroup)?.removeView(customView)
                customView = null
                customCallback?.onCustomViewHidden()
                customCallback = null
            }
        }
    }

    private fun injectVideoProbe() {
        val js = """
            (function(){
              try {
                const urls = new Set();
                document.querySelectorAll('video,video source,source[type*="video"],source[src*=".m3u8"],source[src*=".mp4"]').forEach(el=>{
                  const s = el.currentSrc || el.src || el.getAttribute('src');
                  if (s && s.indexOf('http')===0) urls.add(s);
                });
                // common players store urls on attributes
                document.querySelectorAll('[data-src],[data-url],[data-video]').forEach(el=>{
                  ['data-src','data-url','data-video'].forEach(k=>{
                    const s = el.getAttribute(k);
                    if (s && /https?:/.test(s) && /\.(mp4|m3u8|mpd|flv|webm)/i.test(s)) urls.add(s);
                  });
                });
                return Array.from(urls).slice(0,30).join('\n');
              } catch(e){ return ''; }
            })();
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(js) { result ->
                val raw = result?.trim()?.trim('"')?.replace("\\n", "\n")?.replace("\\\"", "\"")
                    ?.replace("\\\\", "\\").orEmpty()
                if (raw.isBlank() || raw == "null") return@evaluateJavascript
                raw.lineSequence()
                    .map { it.trim() }
                    .filter { it.startsWith("http") }
                    .forEach { u -> app.sniffer.onRequest(u, "video-probe", currentPageUrl) }
            }
        }
    }

    fun load(raw: String) {
        navigationVersion++
        val t = raw.trim()
        if (t.isEmpty() || t == PreferenceStore.HOME_URL || t == "about:home" || t == "about:blank") {
            loadHome()
            return
        }
        val url = normalizeUrl(t)
        app.sniffer.setPage(url)
        val headers = mapOf(
            "Accept-Language" to "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7"
        )
        webView.loadUrl(url, headers)
    }

    fun loadHome() {
        val version = ++navigationVersion
        currentPageUrl = PreferenceStore.HOME_URL
        currentTitle = "主页"
        app.sniffer.setPage("")
        callbacks.onUrlChanged(PreferenceStore.HOME_URL)
        callbacks.onTitleChanged("主页")

        // Serve cached HTML immediately when available (avoids multi-second freezes)
        val cacheKey = homeCacheKey()
        val cached = homeHtmlCache[cacheKey]
        if (cached != null) {
            webView.settings.allowFileAccess = true
            webView.settings.allowContentAccess = true
            webView.loadDataWithBaseURL(
                "https://home.local/",
                cached,
                "text/html",
                "utf-8",
                PreferenceStore.HOME_URL
            )
            return
        }

        // Build HTML off the UI thread (wallpaper base64 is expensive)
        val wallPath = app.prefs.homeWallpaperFile().takeIf {
            app.prefs.homeWallpaperPath.isNotBlank() && it.exists() && it.length() > 32
        }?.absolutePath
        val bg = app.prefs.effectiveHomeBgColor()
        val logo = app.prefs.homeLogoText
        val engine = app.prefs.searchEngine.displayName
        val shortcuts = app.homeShortcuts.all()
        val density = webView.resources.displayMetrics.density
        val statusPx = runCatching {
            val resId = webView.resources.getIdentifier("status_bar_height", "dimen", "android")
            if (resId > 0) webView.resources.getDimensionPixelSize(resId) else (24 * density).toInt()
        }.getOrDefault((24 * density).toInt())
        val topInsetDp = ((statusPx + 56 * density) / density).toInt().coerceIn(56, 120)
        val bottomInsetDp = ((52 * density + 12 * density) / density).toInt().coerceIn(52, 100)

        // Lightweight shell first so UI stays responsive
        val shell = HomePage.html(
            bgColor = bg,
            logoText = logo,
            engineName = engine,
            wallpaperFile = null,
            shortcuts = shortcuts,
            iconDataUrls = emptyMap(),
            topInsetDp = topInsetDp,
            bottomInsetDp = bottomInsetDp
        )
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        webView.loadDataWithBaseURL(
            "https://home.local/",
            shell,
            "text/html",
            "utf-8",
            PreferenceStore.HOME_URL
        )

        app.appScope.launch {
            val wallFile = wallPath?.let { java.io.File(it) }?.takeIf { it.exists() }
            val iconData = HashMap<String, String>()
            shortcuts.forEach { s ->
                app.favicons.dataUrlFor(s.url)?.let { iconData[s.id] = it }
            }
            // Prefetch missing favicons without blocking
            app.favicons.prefetch(shortcuts.map { it.url })
            val html = HomePage.html(
                bgColor = bg,
                logoText = logo,
                engineName = engine,
                wallpaperFile = wallFile,
                shortcuts = shortcuts,
                iconDataUrls = iconData,
                topInsetDp = topInsetDp,
                bottomInsetDp = bottomInsetDp
            )
            homeHtmlCache[cacheKey] = html
            // Cap cache size
            if (homeHtmlCache.size > 3) {
                val first = homeHtmlCache.keys.firstOrNull()
                if (first != null) homeHtmlCache.remove(first)
            }
            val css = html.substringAfter("<style id=\"home-style\">").substringBefore("</style>")
            val icons = org.json.JSONObject(iconData as Map<*, *>)
            val patch = """(function(){
                var style=document.getElementById('home-style');if(!style)return;
                style.textContent=${org.json.JSONObject.quote(css)};
                var icons=$icons;
                document.querySelectorAll('a.tile[data-id]').forEach(function(tile){
                    var src=icons[tile.getAttribute('data-id')], img=tile.querySelector('img.icon');
                    if(src && img){img.src=src;img.style.display='';var fallback=tile.querySelector('.icon-fallback');if(fallback)fallback.style.display='none';}
                });
            })();""".trimIndent()
            webView.post {
                if (navigationVersion == version && currentPageUrl == PreferenceStore.HOME_URL) {
                    pendingHomeAppearance = version to patch
                    applyPendingHomeAppearance()
                }
            }
        }
    }

    private fun applyPendingHomeAppearance() {
        val (version, patch) = pendingHomeAppearance ?: return
        if (navigationVersion == version && currentPageUrl == PreferenceStore.HOME_URL) evaluateJs(patch)
    }

    private fun homeCacheKey(): String {
        return listOf(
            app.prefs.effectiveHomeBgColor(),
            app.prefs.homeLogoText,
            app.prefs.searchEngine.displayName,
            app.prefs.homeWallpaperPath,
            app.prefs.homeWallpaperFile().let { "${it.lastModified()}:${it.length()}" },
            app.homeShortcuts.all().joinToString("|") { "${it.id}:${it.title}:${it.url}" }
        ).joinToString("::")
    }

    fun reload() { if (InternalPage.isHome(currentPageUrl)) loadHome() else webView.reload() }
    fun goBack(): Boolean = if (webView.canGoBack()) {
        webView.goBack(); true
    } else false

    fun goForward(): Boolean = if (webView.canGoForward()) {
        webView.goForward(); true
    } else false

    fun setDesktopMode(enabled: Boolean, reload: Boolean = true) {
        applyUserAgent(reload = reload)
    }

    fun applyUserAgent(reload: Boolean = false) {
        applyUserAgentSettingsOnly()
        if (reload) {
            val url = currentUrl()
            webView.stopLoading()
            if (InternalPage.isHome(url)) {
                loadHome()
            } else if (url.startsWith("http")) {
                // Soft reload with correct UA already applied — no cache wipe needed.
                webView.loadUrl(
                    url,
                    mapOf("Accept-Language" to "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
                )
            } else {
                webView.reload()
            }
        } else {
            injectUaSpoof()
        }
    }

    private fun applyUserAgentSettingsOnly() {
        val profile = app.prefs.uaProfile
        val desktopMode = app.prefs.desktopMode
        val ua = UserAgentHelper.resolve(webView, profile, desktopMode)
        // Only write settings when value actually changes — mid-load writes cause reload loops.
        if (webView.settings.userAgentString != ua) {
            webView.settings.userAgentString = ua
        }
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true
    }

    private fun injectUaSpoof() {
        val ua = UserAgentHelper.resolve(webView, app.prefs.uaProfile, app.prefs.desktopMode)
        val desktop = UserAgentHelper.isDesktop(app.prefs.uaProfile, app.prefs.desktopMode)
        val js = UserAgentHelper.spoofScript(ua, desktop)
        webView.post { runCatching { webView.evaluateJavascript(js, null) } }
    }

    private fun confirmDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?
    ) {
        val ctx = webView.context
        val engine = if (app.prefs.downloadUseSystem) "系统下载" else "内置下载"
        val activity = (ctx as? android.app.Activity) ?: ctx
        // 短链 / 无扩展名路径：先探测真实文件名，再弹确认框
        DownloadHelper.resolveFileName(
            url = url,
            userAgent = userAgent,
            contentDisposition = contentDisposition,
            mimeType = mimeType,
            pageUrl = currentPageUrl,
        ) { name ->
            webView.post {
                com.shifuf.prism.ui.DialogUi.showDownloadConfirm(
                    context = activity,
                    fileName = name,
                    url = url,
                    engineLabel = engine,
                    onConfirm = { chosen ->
                        runCatching {
                            DownloadHelper.enqueue(
                                context = ctx,
                                url = url,
                                userAgent = userAgent,
                                contentDisposition = contentDisposition,
                                mimeType = mimeType,
                                pageUrl = currentPageUrl,
                                preferredName = chosen
                            )
                        }
                    }
                )
            }
        }
    }

    fun applyNightMode(enabled: Boolean) {
        // Real app night mode is handled by AppCompatDelegate.
        // Do NOT invert webpage colors.
    }

    fun currentUrl(): String {
        val u = webView.url ?: currentPageUrl
        return when {
            InternalPage.isHome(u) -> PreferenceStore.HOME_URL
            currentPageUrl == PreferenceStore.HOME_URL -> PreferenceStore.HOME_URL
            else -> u
        }
    }

    fun currentTitle(): String = currentTitle.ifBlank { webView.title.orEmpty() }

    private fun injectElementHidingSafe() {
        if (!app.prefs.adBlockEnabled) return
        val css = app.adBlock.elementHidingCssSafe()
        if (css.isBlank()) return
        val b64 = android.util.Base64.encodeToString(css.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
        val js = """
            (function(){
              try {
                if (document.getElementById('__bs_eh')) return;
                const css = decodeURIComponent(escape(atob('$b64')));
                const s = document.createElement('style');
                s.id = '__bs_eh';
                s.textContent = css;
                (document.documentElement || document.head).appendChild(s);
              } catch(e) {}
            })();
        """.trimIndent()
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun handleLinkLongClick(): Boolean {
        val result = webView.hitTestResult
        val type = result.type
        val extra = result.extra.orEmpty()
        when (type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE -> {
                if (isOpenableUrl(extra)) {
                    callbacks.onLinkLongPress(extra, false)
                    return true
                }
            }
            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                // Prefer surrounding <a href>; fall back to image URL.
                val imageUrl = extra
                val handler = object : android.os.Handler(android.os.Looper.getMainLooper()) {
                    override fun handleMessage(msg: android.os.Message) {
                        val href = msg.data?.getString("url").orEmpty()
                        val target = when {
                            isOpenableUrl(href) -> href
                            isOpenableUrl(imageUrl) -> imageUrl
                            else -> ""
                        }
                        if (target.isNotBlank()) callbacks.onLinkLongPress(target, true)
                    }
                }
                webView.requestFocusNodeHref(handler.obtainMessage())
                return true
            }
            WebView.HitTestResult.IMAGE_TYPE -> {
                if (isOpenableUrl(extra)) {
                    callbacks.onLinkLongPress(extra, true)
                    return true
                }
            }
        }
        return false
    }

    private fun isOpenableUrl(u: String): Boolean {
        return u.startsWith("http://") || u.startsWith("https://") ||
            u.startsWith("file:") || u.startsWith("about:")
    }

    private fun normalizeUrl(raw: String): String = NavigationInput.resolve(raw, app.prefs.searchEngine::search)

    private fun guessType(url: String): String {
        val u = url.lowercase()
        return when {
            ResourceSniffer.isVideo(u) -> "video"
            u.contains(".mp3") || u.contains(".m4a") -> "audio"
            u.contains(".jpg") || u.contains(".png") || u.contains(".gif") || u.contains(".webp") -> "image"
            u.contains(".js") -> "script"
            u.contains(".css") -> "stylesheet"
            else -> "other"
        }
    }

    private fun emptyResponse(): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "utf-8",
            200,
            "OK",
            mapOf("Access-Control-Allow-Origin" to "*"),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    companion object {
        private val homeHtmlCache = LinkedHashMap<String, String>(4, 0.75f, true)
    }
}
