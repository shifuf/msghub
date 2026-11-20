package com.shifuf.prism.core

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import com.shifuf.prism.BrowserApp
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class TabInfo(
    val id: String,
    var title: String,
    var url: String,
    var isActive: Boolean,
    var loadStatus: PageLoadIndicator = PageLoadIndicator()
)

/**
 * Hosts multiple WebViews in a FrameLayout; only the active one is visible.
 * Session is persisted via [SessionStore] on every structural change.
 */
class TabManager(
    private val context: Context,
    private val container: FrameLayout,
    private val callbacks: BrowserController.Callbacks,
    private val sessionStore: SessionStore,
    private val onTabsChanged: () -> Unit
) {
    private data class Tab(
        val id: String,
        val webView: WebView,
        val controller: BrowserController,
        var title: String = "新标签页",
        var url: String = "about:blank",
        var favicon: Bitmap? = null,
        var loadStatus: PageLoadIndicator = PageLoadIndicator()
    )

    private val tabs = linkedMapOf<String, Tab>()
    private var activeId: String? = null
    private var suppressPersist = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val persistRunnable = Runnable { persistSessionNow() }
    private val chromeRunnable = Runnable { onTabsChanged() }
    private val thumbnails = ConcurrentHashMap<String, Bitmap>()
    private val sniffer get() = BrowserApp.instance.sniffer

    val activeController: BrowserController?
        get() = activeId?.let { tabs[it]?.controller }

    val activeTabId: String?
        get() = activeId

    fun tabCount(): Int = tabs.size

    fun snapshot(): List<TabInfo> = tabs.values.map {
        TabInfo(it.id, it.title, it.url, it.id == activeId, it.loadStatus)
    }

    fun faviconOf(id: String): Bitmap? = tabs[id]?.favicon

    fun thumbnailOf(id: String): Bitmap? = thumbnails[id]

    fun captureActiveThumbnail() {
        val id = activeId ?: return
        val tab = tabs[id] ?: return
        val wv = tab.webView
        if (wv.width <= 0 || wv.height <= 0) return
        runCatching {
            val full = Bitmap.createBitmap(wv.width, wv.height, Bitmap.Config.RGB_565)
            val canvas = Canvas(full)
            wv.draw(canvas)
            val targetW = 360
            val scale = targetW.toFloat() / full.width.coerceAtLeast(1)
            val targetH = (full.height * scale).toInt().coerceIn(120, 640)
            val scaled = Bitmap.createScaledBitmap(full, targetW, targetH, true)
            if (scaled !== full) full.recycle()
            thumbnails.put(id, scaled)?.takeIf { !it.isRecycled }?.recycle()
        }
    }

    fun restoreSession(): Boolean {
        val session = sessionStore.load() ?: return false
        suppressPersist = true
        try {
            session.tabs.forEach { saved ->
                open(
                    url = saved.url,
                    switchTo = false,
                    initialTitle = saved.title
                )
            }
            val ids = tabs.keys.toList()
            if (ids.isNotEmpty()) {
                val idx = session.activeIndex.coerceIn(0, ids.lastIndex)
                switchTo(ids[idx])
            }
        } finally {
            suppressPersist = false
        }
        persistSessionNow()
        notifyChrome()
        return tabs.isNotEmpty()
    }

    fun open(
        url: String = "about:blank",
        switchTo: Boolean = true,
        initialTitle: String = "新标签页"
    ): String {
        val id = UUID.randomUUID().toString()
        val webView = createWebView()
        val tabCallbacks = object : BrowserController.Callbacks {
            override fun onUrlChanged(url: String) {
                tabs[id]?.url = url
                if (id == activeId) callbacks.onUrlChanged(url)
                schedulePersist()
                scheduleChrome()
            }

            override fun onTitleChanged(title: String) {
                tabs[id]?.title = title.ifBlank { tabs[id]?.url ?: "新标签页" }
                if (id == activeId) callbacks.onTitleChanged(title)
                schedulePersist()
                scheduleChrome()
            }

            override fun onProgress(progress: Int) {
                if (id == activeId) callbacks.onProgress(progress)
                // Thumbnail capture is expensive — only when tab switcher is likely needed later
                // and not on every page finish
            }

            override fun onStatus(text: String) {
                if (id == activeId) callbacks.onStatus(text)
            }

            override fun onPageStatusChanged(status: PageLoadIndicator) {
                tabs[id]?.loadStatus = status
                if (id == activeId) callbacks.onPageStatusChanged(status)
                scheduleChrome()
            }

            override fun onIconChanged(icon: Bitmap?) {
                if (icon == null || icon.isRecycled) return
                val scaled = runCatching {
                    Bitmap.createScaledBitmap(icon, 64, 64, true)
                }.getOrDefault(icon)
                tabs[id]?.favicon?.takeIf { it !== scaled && !it.isRecycled }?.recycle()
                tabs[id]?.favicon = scaled
                scheduleChrome()
            }

            override fun onHomeAction(uri: String) {
                if (id == activeId) callbacks.onHomeAction(uri)
            }

            override fun onLinkLongPress(url: String, isImage: Boolean) {
                if (id == activeId) callbacks.onLinkLongPress(url, isImage)
            }

            override fun onScrollChanged(scrollY: Int) {
                if (id == activeId) callbacks.onScrollChanged(scrollY)
            }
        }
        val controller = BrowserController(webView, tabCallbacks, id)
        val tab = Tab(id, webView, controller, title = initialTitle.ifBlank { "新标签页" })
        tabs[id] = tab
        container.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        if (switchTo || activeId == null) {
            switchTo(id)
        } else {
            webView.visibility = View.GONE
            webView.onPause()
        }
        if (url.isNotBlank() && url != "about:blank") {
            controller.load(url)
            tab.url = url
        }
        schedulePersist()
        notifyChrome()
        return id
    }

    fun switchTo(id: String) {
        if (!tabs.containsKey(id)) return
        if (activeId != null && activeId != id) captureActiveThumbnail()
        activeId = id
        sniffer.activate(id)
        tabs.values.forEach { t ->
            val active = t.id == id
            t.webView.visibility = if (active) View.VISIBLE else View.GONE
            if (active) t.webView.onResume() else t.webView.onPause()
        }
        val active = tabs[id] ?: return
        callbacks.onUrlChanged(active.controller.currentUrl().ifBlank { active.url })
        callbacks.onTitleChanged(active.title)
        callbacks.onProgress(active.webView.progress)
        callbacks.onScrollChanged(active.webView.scrollY)
        callbacks.onPageStatusChanged(active.loadStatus)
        runCatching {
            val night = com.shifuf.prism.BrowserApp.instance.prefs.nightMode
            active.controller.applyNightMode(night)
        }
        schedulePersist()
        notifyChrome()
        mainHandler.postDelayed({ captureActiveThumbnail() }, 200)
    }

    fun activeWebView(): WebView? = activeId?.let { tabs[it]?.webView }

    fun isActiveAtTop(): Boolean {
        val wv = activeWebView() ?: return true
        // scrollY is the primary signal; some pages report flaky canScrollVertically
        if (wv.scrollY > 1) return false
        // true = content above exists → not at top
        if (wv.canScrollVertically(-1)) return false
        return true
    }

    fun close(id: String) {
        val tab = tabs.remove(id) ?: return
        container.removeView(tab.webView)
        thumbnails.remove(id)?.takeIf { !it.isRecycled }?.recycle()
        tab.favicon?.takeIf { !it.isRecycled }?.recycle()
        runCatching {
            tab.webView.stopLoading()
            tab.webView.onPause()
            tab.webView.destroy()
        }
        sniffer.forget(id)
        if (tabs.isEmpty()) {
            activeId = null
            open(PreferenceStore.HOME_URL, switchTo = true)
            return
        }
        if (activeId == id) {
            switchTo(tabs.keys.last())
        } else {
            schedulePersist()
            notifyChrome()
        }
    }

    fun closeActive() {
        activeId?.let { close(it) }
    }

    fun loadInActive(url: String) {
        val c = activeController ?: return
        c.load(url)
    }

    fun applyDesktopMode(enabled: Boolean) {
        tabs.values.forEach { it.controller.setDesktopMode(enabled, reload = it.id == activeId) }
    }

    fun applyUserAgentToAll(reloadActive: Boolean = true) {
        tabs.values.forEach { tab ->
            tab.controller.applyUserAgent(reload = false)
        }
        if (reloadActive) {
            activeController?.applyUserAgent(reload = true)
        }
    }

    fun applyNightMode(enabled: Boolean) {
        tabs.values.forEach { it.controller.applyNightMode(enabled) }
    }

    fun persistSession() {
        mainHandler.removeCallbacks(persistRunnable)
        persistSessionNow()
    }

    private fun schedulePersist() {
        if (suppressPersist) return
        mainHandler.removeCallbacks(persistRunnable)
        mainHandler.postDelayed(persistRunnable, 450)
    }

    private fun scheduleChrome() {
        mainHandler.removeCallbacks(chromeRunnable)
        mainHandler.postDelayed(chromeRunnable, 200)
    }

    private fun notifyChrome() {
        mainHandler.removeCallbacks(chromeRunnable)
        onTabsChanged()
    }

    private fun persistSessionNow() {
        if (suppressPersist) return
        val saved = tabs.values.map { t ->
            var url = t.controller.currentUrl().ifBlank { t.url }
            if (url.startsWith("data:")) url = PreferenceStore.HOME_URL
            val title = if (url == PreferenceStore.HOME_URL) "主页"
            else t.title.ifBlank { url }.let { if (it.startsWith("data:")) "主页" else it }
            t.id to SavedTab(title = title, url = url)
        }.filter { it.second.url.isNotBlank() && it.second.url != "about:blank" && !it.second.url.startsWith("data:") }
        val activeIndex = saved.indexOfFirst { it.first == activeId }.coerceAtLeast(0)
        sessionStore.save(saved.map { it.second }, activeIndex)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        return WebView(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
    }

    fun destroyAll() {
        mainHandler.removeCallbacks(persistRunnable)
        mainHandler.removeCallbacks(chromeRunnable)
        persistSessionNow()
        tabs.keys.toList().forEach { id ->
            val tab = tabs.remove(id) ?: return@forEach
            container.removeView(tab.webView)
            runCatching {
                tab.webView.onPause()
                tab.webView.destroy()
            }
            sniffer.forget(id)
        }
        thumbnails.values.forEach { if (!it.isRecycled) it.recycle() }
        thumbnails.clear()
        activeId = null
    }
}
