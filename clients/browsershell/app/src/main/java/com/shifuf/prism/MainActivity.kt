package com.shifuf.prism

import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.appcompat.app.AppCompatDelegate
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.shifuf.prism.core.BOOKMARK_ROOT_ID
import com.shifuf.prism.core.BrowserController
import com.shifuf.prism.core.PreferenceStore
import com.shifuf.prism.core.SearchEngine
import com.shifuf.prism.core.SearchSuggestions
import com.shifuf.prism.core.SessionStore
import com.shifuf.prism.core.TabManager
import com.shifuf.prism.core.UaProfile
import com.shifuf.prism.qr.QrScanActivity
import com.shifuf.prism.ui.BookmarksActivity
import com.shifuf.prism.ui.DialogUi
import com.shifuf.prism.ui.DownloadsActivity
import com.shifuf.prism.ui.FilterRulesActivity
import com.shifuf.prism.ui.HistoryActivity
import com.shifuf.prism.ui.MenuGridItem
import com.shifuf.prism.ui.MenuPagerAdapter
import com.shifuf.prism.ui.NetworkLogActivity
import com.shifuf.prism.ui.ScriptsActivity
import com.shifuf.prism.ui.SettingsActivity
import com.shifuf.prism.ui.SnifferActivity
import com.shifuf.prism.ui.TabListAdapter
import com.shifuf.prism.core.ReadingMode
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.io.FileOutputStream

class MainActivity : AppCompatActivity(), BrowserController.Callbacks {
    private lateinit var tabManager: TabManager
    private lateinit var sessionStore: SessionStore
    private lateinit var urlBar: EditText
    private lateinit var titleView: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var tabCountBadge: TextView
    private lateinit var tabSwitcher: FrameLayout
    private lateinit var tabList: RecyclerView
    private lateinit var menuOverlay: FrameLayout
    private lateinit var menuPager: ViewPager2
    private lateinit var menuDots: LinearLayout
    private lateinit var suggestPanel: LinearLayout
    private lateinit var suggestList: RecyclerView
    private lateinit var btnBack: ImageButton
    private lateinit var btnForward: ImageButton
    private lateinit var btnRefresh: ImageButton
    private lateinit var btnClearUrl: ImageButton
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var tabAdapter: TabListAdapter
    private lateinit var suggestAdapter: SuggestAdapter

    private var currentPageTitle: String = ""
    private var currentPageUrl: String = ""
    private var editingAddress: Boolean = false
    private var wallpaperRevision = com.shifuf.prism.core.WallpaperStore.revision.value
    private var menuPageCallback: ViewPager2.OnPageChangeCallback? = null

    private val app get() = BrowserApp.instance

    private val qrLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data?.getStringExtra(QrScanActivity.EXTRA_RESULT) ?: return@registerForActivityResult
        if (data.isNotBlank()) {
            enterEditMode(data)
            tabManager.loadInActive(data)
            exitEditMode()
        }
    }

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) openQr() else Toast.makeText(this, "需要相机权限才能扫码", Toast.LENGTH_SHORT).show()
    }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        com.shifuf.prism.push.DevicePlatformClient.updateHeartbeat(this)
        if (!com.shifuf.prism.push.PushNotifier.isMessageChannelEnabled(this)) {
            Toast.makeText(this, "通知未开启；可在设置的通知诊断中打开系统设置", Toast.LENGTH_LONG).show()
        }
    }

    private val wallpaperPicker = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { com.shifuf.prism.core.WallpaperStore.save(this@MainActivity, uri, app.prefs) }
            }.onSuccess {
                Toast.makeText(this@MainActivity, "主页壁纸已更新", Toast.LENGTH_SHORT).show()
            }.onFailure {
                Toast.makeText(this@MainActivity, "壁纸设置失败，请重新选择图片", Toast.LENGTH_LONG).show()
            }
        }
    }

    private val settingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data ?: return@registerForActivityResult
        if (data.getBooleanExtra(SettingsActivity.EXTRA_RELOAD_UA, false)) {
            tabManager.applyUserAgentToAll(reloadActive = true)
        }
        if (data.getBooleanExtra(SettingsActivity.EXTRA_HOME_APPEARANCE, false)) {
            val cur = tabManager.activeController?.currentUrl().orEmpty()
            if (isHomeUrl(cur)) {
                tabManager.loadInActive(PreferenceStore.HOME_URL)
            }
            applyImmersiveChrome(isHomeUrl(currentPageUrl.ifBlank { PreferenceStore.HOME_URL }))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        runCatching {
            val night = (application as BrowserApp).prefs.nightMode
            AppCompatDelegate.setDefaultNightMode(
                if (night) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
            )
        }
        super.onCreate(savedInstanceState)
        // Draw edge-to-edge so status bar can share home background color.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.isStatusBarContrastEnforced = false
        }
        setContentView(R.layout.activity_main)
        requestPostNotificationsIfNeeded()
        // Pad only chrome bars into system insets. Consume insets so WebView
        // does not get a second status-bar offset (white gap under address bar).
        val topBarView = findViewById<View>(R.id.topBar)
        val bottomBarView = findViewById<View>(R.id.bottomBar)
        val rootContent = findViewById<View>(android.R.id.content)
        val topPadding = topBarView.paddingTop
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(rootContent) { _, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())
            rootContent.setPadding(bars.left, if (topBarView.visibility == View.GONE) bars.top else 0, bars.right, ime.bottom)
            topBarView.setPadding(
                topBarView.paddingLeft,
                bars.top + topPadding,
                topBarView.paddingRight,
                topBarView.paddingBottom
            )
            bottomBarView.setPadding(
                bottomBarView.paddingLeft,
                bottomBarView.paddingTop,
                bottomBarView.paddingRight,
                if (ime.bottom > 0) 0 else bars.bottom
            )
            bottomBarView.layoutParams.height = (56 * resources.displayMetrics.density).toInt() +
                if (ime.bottom > 0) 0 else bars.bottom
            findViewById<View>(R.id.tabSheet)?.setPadding(0, 0, 0, bars.bottom)
            findViewById<View>(R.id.menuSheet)?.setPadding(0, 0, 0, bars.bottom)
            rootContent.post { if (::menuPager.isInitialized) resizeSheets() }
            androidx.core.view.WindowInsetsCompat.CONSUMED
        }

        urlBar = findViewById(R.id.urlBar)
        titleView = findViewById(R.id.titleView)
        progressBar = findViewById(R.id.progressBar)
        tabCountBadge = findViewById(R.id.tabCountBadge)
        tabSwitcher = findViewById(R.id.tabSwitcher)
        tabList = findViewById(R.id.tabList)
        menuOverlay = findViewById(R.id.menuOverlay)
        menuPager = findViewById(R.id.menuPager)
        menuDots = findViewById(R.id.menuDots)
        suggestPanel = findViewById(R.id.suggestPanel)
        suggestList = findViewById(R.id.suggestList)
        // Never leave a full-screen overlay intercepting clicks after process death restore
        tabSwitcher.visibility = View.GONE
        menuOverlay.visibility = View.GONE
        suggestPanel.visibility = View.GONE
        findViewById<View>(R.id.edgeHintLeft)?.visibility = View.GONE
        findViewById<View>(R.id.edgeHintRight)?.visibility = View.GONE
        btnBack = findViewById(R.id.btnBack)
        btnForward = findViewById(R.id.btnForward)
        btnRefresh = findViewById(R.id.btnRefresh)
        btnClearUrl = findViewById(R.id.btnClearUrl)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        val webContainer = findViewById<FrameLayout>(R.id.webContainer)

        swipeRefresh.setColorSchemeResources(R.color.via_accent)
        // Require a clearer pull so mid-page flings don't trip refresh
        val density = resources.displayMetrics.density
        swipeRefresh.setDistanceToTriggerSync((96 * density).toInt())
        swipeRefresh.setOnRefreshListener {
            // Re-check at trigger time: only refresh if still at absolute top
            if (!tabManager.isActiveAtTop()) {
                swipeRefresh.isRefreshing = false
                swipeRefresh.isEnabled = false
                return@setOnRefreshListener
            }
            if (isHomeUrl(currentPageUrl)) {
                tabManager.loadInActive(PreferenceStore.HOME_URL)
            } else {
                tabManager.activeController?.reload()
            }
            swipeRefresh.postDelayed({
                if (::swipeRefresh.isInitialized) swipeRefresh.isRefreshing = false
            }, 1200)
        }
        // Return true => child can still scroll up => SwipeRefresh must NOT take the gesture
        swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            if (!::tabManager.isInitialized) return@setOnChildScrollUpCallback true
            !tabManager.isActiveAtTop()
        }
        swipeRefresh.isEnabled = true
        updateSwipeRefreshEnabled(true)

        sessionStore = SessionStore(this)
        tabManager = TabManager(
            context = this,
            container = webContainer,
            callbacks = this,
            sessionStore = sessionStore,
            onTabsChanged = { runOnUiThread { renderChrome() } }
        )

        tabAdapter = TabListAdapter(
            onOpen = { id ->
                tabManager.switchTo(id)
                hideTabSwitcher()
            },
            onClose = { id -> tabManager.close(id) },
            faviconProvider = { id -> tabManager.faviconOf(id) }
        )
        tabList.layoutManager = LinearLayoutManager(this)
        tabList.adapter = tabAdapter
        tabList.itemAnimator = androidx.recyclerview.widget.DefaultItemAnimator().apply {
            addDuration = 160
            removeDuration = 140
            moveDuration = 160
            changeDuration = 120
        }

        setupMenuPager()

        // Outside tap already closes sheets via overlay click listeners.
        // Edge swipe handled in dispatchTouchEvent (WebView consumes child touches)

        suggestAdapter = SuggestAdapter { item ->
            hideSuggestions()
            tabManager.loadInActive(item.url)
            exitEditMode()
        }
        suggestList.layoutManager = LinearLayoutManager(this)
        suggestList.adapter = suggestAdapter

        app.debugServer.setNavigateHandler { url ->
            runOnUiThread { tabManager.loadInActive(url) }
        }
        app.debugServer.setStateProvider {
            val c = tabManager.activeController
            mapOf(
                "attached" to true,
                "url" to (c?.currentUrl() ?: ""),
                "title" to (c?.currentTitle() ?: ""),
                "tabs" to tabManager.tabCount(),
                "adblock" to app.prefs.adBlockEnabled,
                "desktop" to app.prefs.desktopMode,
                "debugPort" to app.debugServer.port
            )
        }

        btnBack.setOnClickListener { tabManager.activeController?.goBack() }
        btnForward.setOnClickListener { tabManager.activeController?.goForward() }
        findViewById<ImageButton>(R.id.btnHome).setOnClickListener {
            goHome()
        }
        findViewById<ImageButton>(R.id.btnTabs).setOnClickListener {
            exitEditMode()
            showTabSwitcher()
        }
        findViewById<ImageButton>(R.id.btnMenu).setOnClickListener {
            exitEditMode()
            showMenuPanel()
        }
        btnRefresh.setOnClickListener {
            if (editingAddress) {
                // in edit mode refresh acts as go
                navigateFromBar()
            } else {
                tabManager.activeController?.reload()
            }
        }
        btnClearUrl.setOnClickListener {
            urlBar.setText("")
            urlBar.requestFocus()
            updateClearButton()
            updateSuggestions("")
        }

        // Tap title area to start editing URL
        titleView.setOnClickListener {
            enterEditMode(currentPageUrl.ifBlank { tabManager.activeController?.currentUrl().orEmpty() })
        }
        findViewById<View>(R.id.urlBarContainer).setOnClickListener {
            if (!editingAddress) {
                enterEditMode(currentPageUrl.ifBlank { tabManager.activeController?.currentUrl().orEmpty() })
            }
        }

        urlBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                navigateFromBar(); true
            } else false
        }
        urlBar.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (editingAddress) {
                    updateClearButton()
                    updateSuggestions(s?.toString().orEmpty())
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        urlBar.setOnFocusChangeListener { _, hasFocus ->
            if (!hasFocus && editingAddress) {
                // delay so suggestion click can fire first
                urlBar.postDelayed({
                    if (!urlBar.hasFocus() && editingAddress) exitEditMode()
                }, 180)
            }
            updateClearButton()
        }

        findViewById<View>(R.id.btnNewTab).setOnClickListener {
            tabManager.open(PreferenceStore.HOME_URL, switchTo = true)
            hideTabSwitcher()
        }
        findViewById<ImageButton>(R.id.btnTopQr).setOnClickListener { ensureCameraAndScan() }
        findViewById<View>(R.id.btnCloseMenu).setOnClickListener { hideMenuPanel() }
        menuOverlay.setOnClickListener { hideMenuPanel() }
        findViewById<View>(R.id.menuSheet).setOnClickListener { /* consume */ }
        tabSwitcher.setOnClickListener { hideTabSwitcher() }
        findViewById<View>(R.id.tabSheet).setOnClickListener { /* consume */ }
        webContainer.setOnClickListener { exitEditMode() }

        if (app.prefs.debugServerEnabled) {
            runCatching { app.debugServer.start() }
        }
        app.adBlock.loadDefaults()

        val launchUrl = intent?.dataString ?: intent?.getStringExtra(EXTRA_OPEN_URL)
        if (!launchUrl.isNullOrBlank()) {
            tabManager.restoreSession()
            tabManager.open(launchUrl, switchTo = true)
            intent?.removeExtra(EXTRA_OPEN_URL)
            intent?.data = null
        } else {
            val restored = tabManager.restoreSession()
            if (!restored) {
                tabManager.open(PreferenceStore.HOME_URL, switchTo = true)
            }
        }
        lifecycleScope.launch {
            lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
                com.shifuf.prism.core.WallpaperStore.revision.collect { revision ->
                    if (wallpaperRevision != revision) {
                        wallpaperRevision = revision
                        if (isHomeUrl(tabManager.activeController?.currentUrl().orEmpty())) {
                            tabManager.loadInActive(PreferenceStore.HOME_URL)
                            applyImmersiveChrome(true)
                        }
                    }
                }
            }
        }
        // After chrome is ready, force immersive for home immediately
        showTitleMode()
        renderChrome()
        applyImmersiveChrome(true) // default first paint; corrected when tab URL known
        // Correct after session restore settles
        urlBar.post {
            val url = tabManager.activeController?.currentUrl().orEmpty()
            applyImmersiveChrome(isHomeUrl(url.ifBlank { PreferenceStore.HOME_URL }))
        }
    }

    private fun enterEditMode(url: String) {
        if (editingAddress) {
            urlBar.requestFocus()
            showKeyboard(urlBar)
            return
        }
        editingAddress = true
        findViewById<View>(R.id.urlBarContainer).isActivated = true
        titleView.visibility = View.GONE
        urlBar.visibility = View.VISIBLE
        val safe = when {
            isHomeUrl(url) || url.startsWith("data:") || url.startsWith("about:home") -> ""
            url.contains("browser.shell.home") || url.contains("home.html") -> ""
            else -> url
        }
        urlBar.setText(safe)
        urlBar.setSelection(urlBar.text?.length ?: 0)
        urlBar.requestFocus()
        showKeyboard(urlBar)
        updateClearButton()
        updateSuggestions(urlBar.text?.toString().orEmpty())
    }

    private fun dismissHomeSearch() {
        if (::tabManager.isInitialized && isHomeUrl(tabManager.activeController?.currentUrl().orEmpty())) {
            tabManager.activeController?.evaluateJs("window.dismissHomeSearch && window.dismissHomeSearch()")
        }
    }

    private fun exitEditMode() {
        dismissHomeSearch()
        editingAddress = false
        findViewById<View>(R.id.urlBarContainer).isActivated = false
        hideKeyboard(urlBar)
        urlBar.clearFocus()
        hideSuggestions()
        showTitleMode()
        updateClearButton()
    }

    private fun isHomeUrl(url: String): Boolean {
        return url.isBlank() || com.shifuf.prism.core.InternalPage.isHome(url)
    }

    /** Home button: if already on home, just scroll/focus — do NOT rebuild HTML (avoids icon jitter). */
    private fun goHome() {
        exitEditMode()
        val cur = tabManager.activeController?.currentUrl().orEmpty().ifBlank { currentPageUrl }
        if (isHomeUrl(cur)) {
            // Already home — stop loading spinner / soft scroll top via JS, no reload
            runCatching {
                tabManager.activeController?.evaluateJs(
                    "(function(){try{window.scrollTo(0,0);var q=document.getElementById('q');if(q)q.blur();}catch(e){}})();"
                )
            }
            applyImmersiveChrome(true)
            return
        }
        tabManager.loadInActive(PreferenceStore.HOME_URL)
    }

    private fun requestPostNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        val permissionPrefs = getSharedPreferences("jpush_prefs", MODE_PRIVATE)
        val hasRequested = permissionPrefs.getBoolean("notification_permission_requested", false)
        if (com.shifuf.prism.push.NotificationPermissionPolicy.shouldRequest(Build.VERSION.SDK_INT, granted, hasRequested)) {
            permissionPrefs.edit().putBoolean("notification_permission_requested", true).apply()
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun showTitleMode() {
        titleView.visibility = View.VISIBLE
        urlBar.visibility = View.GONE
        val title = currentPageTitle.trim()
        val isHome = isHomeUrl(currentPageUrl)
        titleView.text = when {
            isHome -> "搜索或输入网址"
            title.isNotBlank() && !title.startsWith("data:") -> title
            currentPageUrl.isNotBlank() && !currentPageUrl.startsWith("data:") -> prettyHost(currentPageUrl)
            else -> getString(R.string.url_hint)
        }
        findViewById<android.widget.ImageView>(R.id.addressIcon).setImageResource(if (isHome) R.drawable.ic_search else R.drawable.ic_globe)
        titleView.contentDescription = if (isHome) "搜索或输入网址" else "$title，${prettyHost(currentPageUrl)}，点按编辑网址"
        if (!isHome) {
            titleView.setTextColor(ContextCompat.getColor(this, R.color.via_text))
        }
    }

    private fun prettyHost(url: String): String {
        if (url == PreferenceStore.HOME_URL || url.startsWith("about:home") || url.startsWith("data:")) return "主页"
        return runCatching {
            val host = android.net.Uri.parse(url).host.orEmpty()
            host.removePrefix("www.").ifBlank { "主页" }
        }.getOrDefault("主页")
    }

    private fun updateClearButton() {
        // Only when editing AND has content
        val show = editingAddress && !urlBar.text.isNullOrEmpty()
        btnClearUrl.visibility = if (show) View.VISIBLE else View.GONE
    }

    private fun updateSuggestions(query: String) {
        if (!editingAddress) {
            hideSuggestions()
            return
        }
        val q = query.trim()
        if (q.startsWith("data:") || q.startsWith("about:")) {
            hideSuggestions()
            return
        }
        val items = SearchSuggestions.suggest(q).filter {
            !it.url.startsWith("data:") && !it.title.contains("data:")
        }
        if (items.isEmpty()) {
            hideSuggestions()
        } else {
            suggestAdapter.submit(items)
            suggestPanel.visibility = View.VISIBLE
        }
    }

    private fun hideSuggestions() {
        suggestPanel.visibility = View.GONE
    }

    private fun showKeyboard(view: View) {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun hideKeyboard(view: View) {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(view.windowToken, 0)
    }

    private fun buildMenuItems(): List<MenuGridItem> {
        val url = tabManager.activeController?.currentUrl().orEmpty()
        val bookmarked = url.startsWith("http") && app.bookmarks.isBookmarked(url)
        return listOf(
            MenuGridItem(3, "书签", R.drawable.ic_star),
            MenuGridItem(4, "历史记录", R.drawable.ic_history),
            MenuGridItem(15, "下载管理", R.drawable.ic_download),
            MenuGridItem(26, "消息中心", R.drawable.ic_message, app.pushHistory.unreadCount() > 0),
            MenuGridItem(2, if (bookmarked) "已收藏" else "收藏网页", R.drawable.ic_star, bookmarked),
            MenuGridItem(22, "分享网页", R.drawable.ic_share),
            MenuGridItem(6, "资源嗅探", R.drawable.ic_sniffer),
            MenuGridItem(25, "阅读模式", R.drawable.ic_reader),
            MenuGridItem(20, if (app.prefs.nightMode) "浅色外观" else "深色外观", R.drawable.ic_night, app.prefs.nightMode),
            MenuGridItem(21, "无痕浏览", R.drawable.ic_shield, app.prefs.privateMode),
            MenuGridItem(8, "扫描二维码", R.drawable.ic_qr),
            MenuGridItem(17, "设置", R.drawable.ic_settings),
            MenuGridItem(1, "新建标签", R.drawable.ic_add),
            MenuGridItem(13, "重新载入", R.drawable.ic_refresh),
            MenuGridItem(14, "下载当前页", R.drawable.ic_download),
            MenuGridItem(11, "电脑模式", R.drawable.ic_desktop, app.prefs.desktopMode || app.prefs.uaProfile == UaProfile.CHROME_DESKTOP),
            MenuGridItem(9, "广告拦截", R.drawable.ic_block, app.prefs.adBlockEnabled),
            MenuGridItem(5, "用户脚本", R.drawable.ic_code),
            MenuGridItem(18, "规则订阅", R.drawable.ic_block),
            MenuGridItem(7, "网络日志", R.drawable.ic_network),
            MenuGridItem(19, "主页外观", R.drawable.ic_home),
            MenuGridItem(16, "搜索引擎", R.drawable.ic_search),
            MenuGridItem(23, "浏览器标识", R.drawable.ic_desktop, app.prefs.uaProfile != UaProfile.DEFAULT && app.prefs.uaProfile != UaProfile.CHROME_ANDROID)
        )
    }

    private fun setupMenuPager() {
        val pages = buildMenuItems().chunked(12)
        menuPager.adapter = MenuPagerAdapter(pages) { item ->
            hideMenuPanel()
            handleMenuAction(item.id)
        }
        renderMenuDots(pages.size, 0)
        menuPageCallback?.let { menuPager.unregisterOnPageChangeCallback(it) }
        menuPageCallback = object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                renderMenuDots(pages.size, position)
            }
        }.also { menuPager.registerOnPageChangeCallback(it) }
        resizeSheets()
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        findViewById<View>(android.R.id.content).post { resizeSheets() }
    }

    private fun resizeSheets() {
        val density = resources.displayMetrics.density
        val root = findViewById<View>(android.R.id.content)
        val availableWidth = ((root.width - root.paddingLeft - root.paddingRight) / density).toInt()
            .takeIf { it > 0 } ?: resources.configuration.screenWidthDp
        val availableHeight = ((root.height - root.paddingTop - root.paddingBottom) / density).toInt()
            .takeIf { it > 0 } ?: resources.configuration.screenHeightDp
        val width = minOf(availableWidth, 600)
        val limit = com.shifuf.prism.ui.UiLayoutPolicy.sheetHeight(availableHeight)
        val columns = com.shifuf.prism.ui.UiLayoutPolicy.menuColumns(width, resources.configuration.fontScale)
        val rowHeight = (100 * resources.configuration.fontScale.coerceAtLeast(1f)).toInt()
        listOf(R.id.menuSheet, R.id.tabSheet).forEach { id ->
            val sheet = findViewById<View>(id)
            sheet.layoutParams = (sheet.layoutParams as FrameLayout.LayoutParams).apply {
                this.width = (width * density).toInt()
                gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
            }
        }
        fun fixedHeight(sheetId: Int, contentId: Int, fallback: Int): Int {
            val sheet = findViewById<ViewGroup>(sheetId)
            var height = sheet.paddingTop + sheet.paddingBottom
            var measured = true
            for (i in 0 until sheet.childCount) {
                val child = sheet.getChildAt(i)
                if (child.id == contentId || child.visibility == View.GONE) continue
                val margins = child.layoutParams as? ViewGroup.MarginLayoutParams
                height += child.measuredHeight + (margins?.topMargin ?: 0) + (margins?.bottomMargin ?: 0)
                if (child.measuredHeight == 0) measured = false
            }
            return if (measured) (height / density).toInt() else fallback + (sheet.paddingBottom / density).toInt()
        }
        menuPager.layoutParams.height = (minOf(((12 + columns - 1) / columns) * rowHeight,
            (limit - fixedHeight(R.id.menuSheet, R.id.menuPager, 180)).coerceAtLeast(48)) * density).toInt()
        if (::tabAdapter.isInitialized) {
            tabList.layoutParams.height = (minOf(tabAdapter.itemCount * (96 * resources.configuration.fontScale.coerceAtLeast(1f)).toInt(),
                (limit - fixedHeight(R.id.tabSheet, R.id.tabList, 144)).coerceAtLeast(48)) * density).toInt()
        }
        menuPager.requestLayout()
        tabList.requestLayout()
    }

    private fun renderMenuDots(count: Int, selected: Int) {
        menuDots.removeAllViews()
        val density = resources.displayMetrics.density
        listOf("常用工具", "更多功能").take(count).forEachIndexed { index, label ->
            menuDots.addView(TextView(this).apply {
                text = label
                textSize = 13f
                gravity = android.view.Gravity.CENTER
                minHeight = (48 * density).toInt()
                setPadding((18 * density).toInt(), 0, (18 * density).toInt(), 0)
                setTextColor(getColor(if (index == selected) R.color.via_accent else R.color.via_text_secondary))
                if (index == selected) background = DialogUi.roundedShape(this@MainActivity, getColor(R.color.via_accent_soft), 14f)
                isSelected = index == selected
                contentDescription = label + if (isSelected) "，已选择" else ""
                setOnClickListener { menuPager.setCurrentItem(index, android.animation.ValueAnimator.areAnimatorsEnabled()) }
            })
        }
    }

    private fun handleMenuAction(id: Int) {
        when (id) {
            1 -> tabManager.open(PreferenceStore.HOME_URL, switchTo = true)
            2 -> showAddBookmarkDialog()
            3 -> startActivity(Intent(this, BookmarksActivity::class.java))
            4 -> startActivity(Intent(this, HistoryActivity::class.java))
            5 -> startActivity(Intent(this, ScriptsActivity::class.java))
            6 -> {
                val page = tabManager.activeController?.currentUrl().orEmpty()
                startActivity(
                    Intent(this, SnifferActivity::class.java)
                        .putExtra(SnifferActivity.EXTRA_PAGE_URL, page)
                )
            }
            7 -> startActivity(Intent(this, NetworkLogActivity::class.java))
            8 -> ensureCameraAndScan()
            9 -> {
                app.prefs.adBlockEnabled = !app.prefs.adBlockEnabled
                Toast.makeText(
                    this,
                    if (app.prefs.adBlockEnabled)
                        "广告拦截：开（${app.adBlock.ruleCount()}条）"
                    else "广告拦截：关",
                    Toast.LENGTH_SHORT
                ).show()
            }
            26 -> startActivity(Intent(this, com.shifuf.prism.ui.PushHistoryActivity::class.java))
            11 -> {
                val enabled = !app.prefs.desktopMode
                app.prefs.desktopMode = enabled
                // Explicit profile so DEFAULT+desktopMode can't fight each other.
                app.prefs.uaProfileId = if (enabled) UaProfile.CHROME_DESKTOP.id else UaProfile.CHROME_ANDROID.id
                tabManager.applyUserAgentToAll(reloadActive = true)
                Toast.makeText(
                    this,
                    if (enabled) "电脑模式：开（Chrome 桌面 UA）" else "电脑模式：关（Chrome Android UA）",
                    Toast.LENGTH_SHORT
                ).show()
            }
            12 -> {
                val enable = !app.debugServer.isRunning
                app.prefs.debugServerEnabled = enable
                if (enable) {
                    runCatching { app.debugServer.start() }
                        .onSuccess {
                            Toast.makeText(
                                this,
                                getString(R.string.debug_on, app.debugServer.port),
                                Toast.LENGTH_LONG
                            ).show()
                        }
                        .onFailure {
                            app.prefs.debugServerEnabled = false
                            Toast.makeText(this, "联调启动失败: ${it.message}", Toast.LENGTH_LONG).show()
                        }
                } else {
                    app.debugServer.stop()
                    Toast.makeText(this, R.string.debug_off, Toast.LENGTH_SHORT).show()
                }
            }
            13 -> tabManager.activeController?.reload()
            14 -> {
                val url = tabManager.activeController?.currentUrl().orEmpty()
                if (url.startsWith("http")) {
                    val engine = if (app.prefs.downloadUseSystem) "系统" else "内置"
                    com.shifuf.prism.core.DownloadHelper.resolveFileName(
                        url = url,
                        pageUrl = url,
                    ) { name ->
                        runOnUiThread {
                            DialogUi.showDownloadConfirm(
                                context = this,
                                fileName = name,
                                url = url,
                                engineLabel = engine,
                                onConfirm = { chosen ->
                                    app.downloads.enqueue(url = url, pageUrl = url, preferredName = chosen)
                                }
                            )
                        }
                    }
                } else Toast.makeText(this, "当前页无法下载", Toast.LENGTH_SHORT).show()
            }
            15 -> startActivity(Intent(this, DownloadsActivity::class.java))
            16 -> showSearchEnginePicker()
            17 -> settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
            18 -> startActivity(Intent(this, FilterRulesActivity::class.java))
            19 -> showHomeAppearancePicker()
            20 -> toggleNightMode()
            21 -> togglePrivateMode()
            22 -> shareCurrent()
            23 -> showUaPicker()
            25 -> {
                val wv = findViewById<FrameLayout>(R.id.webContainer).let { container ->
                    (0 until container.childCount)
                        .mapNotNull { container.getChildAt(it) as? android.webkit.WebView }
                        .firstOrNull { it.visibility == View.VISIBLE }
                }
                if (wv == null) {
                    Toast.makeText(this, "当前页无法进入阅读模式", Toast.LENGTH_SHORT).show()
                } else {
                    ReadingMode.inject(wv)
                    Toast.makeText(this, "阅读模式：再点一次可退出", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun toggleNightMode() {
        val enabled = !app.prefs.nightMode
        app.prefs.nightMode = enabled
        AppCompatDelegate.setDefaultNightMode(
            if (enabled) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
        )
        Toast.makeText(this, if (enabled) "已开启夜间模式" else "已关闭夜间模式", Toast.LENGTH_SHORT).show()
        // Keep current home paint in sync before recreate
        if (isHomeUrl(currentPageUrl)) {
            tabManager.loadInActive(PreferenceStore.HOME_URL)
            applyImmersiveChrome(true)
        }
        recreate()
    }

    private fun togglePrivateMode() {
        dismissHomeSearch()
        app.prefs.privateMode = !app.prefs.privateMode
        if (app.prefs.privateMode) {
            sessionStore.clear()
            Toast.makeText(this, "无痕模式：不保存历史与标签会话", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "已退出无痕模式", Toast.LENGTH_SHORT).show()
        }
    }

    private fun shareCurrent() {
        val url = tabManager.activeController?.currentUrl().orEmpty()
        if (url.startsWith("http")) {
            startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, url)
                    },
                    "分享"
                )
            )
        } else Toast.makeText(this, "当前页无法分享", Toast.LENGTH_SHORT).show()
    }

    private fun showUaPicker() {
        val profiles = UaProfile.entries
        val labels = profiles.map { it.label }.toTypedArray()
        val checked = profiles.indexOf(app.prefs.uaProfile).coerceAtLeast(0)
        DialogUi.material(this)
            .setTitle("浏览器标识（UA）")
            .setSingleChoiceItems(labels, checked) { dialog, which ->
                val selected = profiles[which]
                app.prefs.uaProfileId = selected.id
                // Keep desktopMode in sync ONLY with desktop profile; other profiles clear it.
                app.prefs.desktopMode = selected == UaProfile.CHROME_DESKTOP
                tabManager.applyUserAgentToAll(reloadActive = true)
                Toast.makeText(this, "已切换：${selected.label}", Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showSearchEnginePicker() {
        val engines = SearchEngine.entries
        val labels = engines.map { it.displayName }.toTypedArray()
        val checked = engines.indexOf(app.prefs.searchEngine).coerceAtLeast(0)
        DialogUi.material(this)
            .setTitle("默认搜索引擎")
            .setSingleChoiceItems(labels, checked) { dialog, which ->
                app.prefs.searchEngineId = engines[which].id
                Toast.makeText(this, "已切换为 ${engines[which].displayName}", Toast.LENGTH_SHORT).show()
                // refresh home if showing
                val cur = tabManager.activeController?.currentUrl().orEmpty()
                if (cur == PreferenceStore.HOME_URL || cur.startsWith("data:text/html")) {
                    tabManager.loadInActive(PreferenceStore.HOME_URL)
                }
                dialog.dismiss()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showHomeAppearancePicker() {
        val options = arrayOf(
            "纯色背景",
            "从相册选择壁纸",
            "清除壁纸（仅保留颜色）"
        )
        DialogUi.material(this)
            .setTitle("主页外观")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> showHomeColorPicker()
                    1 -> wallpaperPicker.launch("image/*")
                    2 -> {
                        app.prefs.homeWallpaperPath = ""
                        runCatching { app.prefs.homeWallpaperFile().delete() }
                        tabManager.loadInActive(PreferenceStore.HOME_URL)
                        applyImmersiveChrome(true)
                        Toast.makeText(this, "已清除壁纸", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .show()
    }

    private fun showHomeColorPicker() {
        val colors = listOf(
            "#1A1A1A" to "黑色",
            "#2C333A" to "深灰",
            "#6B7280" to "灰色",
            "#F3F4F6" to "浅灰",
            "#FFFFFF" to "白色",
            "picker" to "自定义颜色…"
        )
        DialogUi.material(this)
            .setTitle("主页背景色")
            .setItems(colors.map { it.second }.toTypedArray()) { _, which ->
                val key = colors[which].first
                if (key == "picker") {
                    showVisualColorPicker()
                } else {
                    app.prefs.homeBgColor = key
                    tabManager.loadInActive(PreferenceStore.HOME_URL)
                    applyImmersiveChrome(true)
                    Toast.makeText(this, "已应用 ${colors[which].second}", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showVisualColorPicker() {
        val density = resources.displayMetrics.density
        val pad = (16 * density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad / 2)
        }
        val preview = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                (56 * density).toInt()
            )
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 14f * density
                setColor(
                    runCatching { android.graphics.Color.parseColor(app.prefs.homeBgColor) }
                        .getOrDefault(0xFF2C333A.toInt())
                )
            }
        }
        root.addView(preview)
        fun seek(label: String, init: Int): android.widget.SeekBar {
            root.addView(TextView(this).apply {
                text = label
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.via_text_secondary))
                textSize = 12f
                setPadding(0, (10 * density).toInt(), 0, 0)
            })
            return android.widget.SeekBar(this).apply {
                max = 255
                progress = init
            }.also { root.addView(it) }
        }
        val init = runCatching { android.graphics.Color.parseColor(app.prefs.homeBgColor) }
            .getOrDefault(0xFF2C333A.toInt())
        val rBar = seek("红 R", android.graphics.Color.red(init))
        val gBar = seek("绿 G", android.graphics.Color.green(init))
        val bBar = seek("蓝 B", android.graphics.Color.blue(init))
        val hexView = TextView(this).apply {
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.via_text))
            textSize = 14f
            setPadding(0, (8 * density).toInt(), 0, 0)
        }
        root.addView(hexView)
        fun refreshPreview() {
            val c = android.graphics.Color.rgb(rBar.progress, gBar.progress, bBar.progress)
            (preview.background as? android.graphics.drawable.GradientDrawable)?.setColor(c)
            hexView.text = String.format("#%06X", 0xFFFFFF and c)
        }
        val listener = object : android.widget.SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: android.widget.SeekBar?, progress: Int, fromUser: Boolean) = refreshPreview()
            override fun onStartTrackingTouch(seekBar: android.widget.SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: android.widget.SeekBar?) {}
        }
        rBar.setOnSeekBarChangeListener(listener)
        gBar.setOnSeekBarChangeListener(listener)
        bBar.setOnSeekBarChangeListener(listener)
        refreshPreview()
        DialogUi.material(this)
            .setTitle("自定义颜色")
            .setView(root)
            .setPositiveButton("应用") { _, _ ->
                val hex = String.format(
                    "#%06X",
                    0xFFFFFF and android.graphics.Color.rgb(rBar.progress, gBar.progress, bBar.progress)
                )
                app.prefs.homeBgColor = hex
                tabManager.loadInActive(PreferenceStore.HOME_URL)
                applyImmersiveChrome(true)
                Toast.makeText(this, "已应用 $hex", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    override fun onPause() {
        dismissHomeSearch()
        if (::tabManager.isInitialized) {
            tabManager.persistSession()
            // Pause active WebView to reduce CPU when backgrounded
            runCatching { tabManager.activeController /* touch */ }
            // TabManager already onPauses inactive; pause active too when activity pauses
            findViewById<FrameLayout>(R.id.webContainer).let { container ->
                for (i in 0 until container.childCount) {
                    (container.getChildAt(i) as? android.webkit.WebView)?.onPause()
                }
            }
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        com.shifuf.prism.push.DevicePlatformClient.updateHeartbeat(this)
        com.shifuf.prism.update.AppUpdater.resumeInstallation(this)
        com.shifuf.prism.update.AppUpdater.checkAutomatically(this)
        // Do NOT re-init JPush here — it freezes the UI for seconds.
        // Connection is maintained by keep-alive / pushcore process.
        if (::tabManager.isInitialized) {
            findViewById<FrameLayout>(R.id.webContainer).let { container ->
                for (i in 0 until container.childCount) {
                    val wv = container.getChildAt(i) as? android.webkit.WebView ?: continue
                    if (wv.visibility == View.VISIBLE) wv.onResume()
                }
            }
            val url = tabManager.activeController?.currentUrl().orEmpty()
            applyImmersiveChrome(isHomeUrl(url.ifBlank { PreferenceStore.HOME_URL }))
        }
    }

    override fun onStop() {
        if (::tabManager.isInitialized) tabManager.persistSession()
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = intent.getStringExtra(EXTRA_OPEN_URL) ?: intent.dataString
        if (!url.isNullOrBlank()) {
            tabManager.open(url, switchTo = true)
            intent.removeExtra(EXTRA_OPEN_URL)
            intent.data = null
            hideTabSwitcher()
            hideMenuPanel()
            exitEditMode()
        }
    }

    private fun navigateFromBar() {
        val text = urlBar.text?.toString().orEmpty()
        tabManager.loadInActive(text)
        exitEditMode()
    }

    private fun renderChrome() {
        val count = tabManager.tabCount().coerceAtLeast(1)
        tabCountBadge.text = if (count > 99) "99+" else count.toString()
        findViewById<View>(R.id.btnTabs).contentDescription = "$count 个标签页"
        updateNavigationButtons()
        if (tabSwitcher.visibility == View.VISIBLE) {
            tabAdapter.submit(tabManager.snapshot())
        }
        val active = tabManager.snapshot().find { it.isActive }
        if (active != null) {
            val url = if (active.url.startsWith("data:")) PreferenceStore.HOME_URL else active.url
            val title = when {
                isHomeUrl(url) -> "主页"
                active.title.isNotBlank() && !active.title.startsWith("data:") -> active.title
                else -> prettyHost(url)
            }
            currentPageTitle = title
            currentPageUrl = url
            if (!editingAddress) showTitleMode()
            applyImmersiveChrome(isHomeUrl(url))
            updateSwipeRefreshEnabled(tabManager.isActiveAtTop())
        }
    }

    private fun updateNavigationButtons() {
        val container = findViewById<FrameLayout>(R.id.webContainer)
        val web = (0 until container.childCount).mapNotNull { container.getChildAt(it) as? android.webkit.WebView }
            .firstOrNull { it.visibility == View.VISIBLE }
        btnBack.isEnabled = web?.canGoBack() == true
        btnForward.isEnabled = web?.canGoForward() == true
        btnBack.alpha = if (btnBack.isEnabled) 1f else .35f
        btnForward.alpha = if (btnForward.isEnabled) 1f else .35f
        findViewById<View>(R.id.btnHome).isSelected = isHomeUrl(currentPageUrl)
    }

    private fun hasHomeWallpaper(): Boolean {
        val f = app.prefs.homeWallpaperFile()
        return app.prefs.homeWallpaperPath.isNotBlank() && f.exists() && f.length() > 32
    }

    private fun applyImmersiveChrome(home: Boolean) {
        val topBar = findViewById<View>(R.id.topBar)
        val bottomBar = findViewById<View>(R.id.bottomBar)
        val urlContainer = findViewById<View>(R.id.urlBarContainer)
        val root = findViewById<View>(android.R.id.content)
        val webContainer = findViewById<View>(R.id.webContainer)
        val density = resources.displayMetrics.density
        val visibility = if (home) View.GONE else View.VISIBLE
        if (topBar.visibility != visibility) {
            topBar.visibility = visibility
            androidx.core.view.ViewCompat.requestApplyInsets(root)
        }
        // Layout is topBar + web (weight=1) + bottomBar — never add chrome-height padding
        // to webContainer or the page will show large blank strips.
        webContainer.setPadding(0, 0, 0, 0)
        if (home) {
            val color = runCatching { android.graphics.Color.parseColor(app.prefs.effectiveHomeBgColor()) }
                .getOrDefault(0xFF2C333A.toInt())
            val wallpaper = hasHomeWallpaper()
            if (wallpaper) {
                window.statusBarColor = android.graphics.Color.TRANSPARENT
                window.navigationBarColor = 0x66000000
                root.setBackgroundColor(android.graphics.Color.TRANSPARENT)
                webContainer.setBackgroundColor(android.graphics.Color.TRANSPARENT)
                topBar.setBackgroundColor(0x33000000)
                bottomBar.setBackgroundColor(0x66000000)
            } else {
                window.statusBarColor = color
                window.navigationBarColor = color
                root.setBackgroundColor(color)
                webContainer.setBackgroundColor(color)
                topBar.setBackgroundColor(color)
                bottomBar.setBackgroundColor(color)
            }
            val light = if (wallpaper) false else isColorLight(color)
            val pill = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                cornerRadius = 20f * density
                setColor(if (wallpaper || !light) 0x24FFFFFF else 0xFFFFFFFF.toInt())
                setStroke(
                    (1f * density).toInt().coerceAtLeast(1),
                    if (wallpaper || !light) 0x22FFFFFF else 0x08000000
                )
            }
            urlContainer.background = pill
            val iconColor = if (light) 0xFF222222.toInt() else 0xFFEDEFF2.toInt()
            val secondary = if (light) 0xFF555555.toInt() else 0xB3EDEFF2.toInt()
            listOf(
                R.id.btnBack, R.id.btnForward, R.id.btnHome, R.id.btnTabs, R.id.btnMenu,
                R.id.btnTopQr, R.id.btnRefresh, R.id.btnClearUrl
            ).forEach { id ->
                (findViewById<View>(id) as? ImageButton)?.setColorFilter(iconColor)
            }
            (urlContainer as? android.view.ViewGroup)?.let { group ->
                for (i in 0 until group.childCount) {
                    val child = group.getChildAt(i)
                    if (child is android.widget.ImageView && child !is ImageButton) {
                        child.setColorFilter(secondary)
                    }
                }
            }
            tabCountBadge.setTextColor(iconColor)
            titleView.setTextColor(iconColor)
            urlBar.setTextColor(iconColor)
            urlBar.setHintTextColor(secondary)
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = light
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = light
        } else {
            val bg = ContextCompat.getColor(this, R.color.via_status_bar)
            val chrome = ContextCompat.getColor(this, R.color.via_chrome)
            window.statusBarColor = bg
            window.navigationBarColor = chrome
            root.setBackgroundColor(ContextCompat.getColor(this, R.color.via_bg))
            webContainer.setBackgroundColor(ContextCompat.getColor(this, R.color.via_bg))
            topBar.setBackgroundResource(R.drawable.bg_top_bar)
            bottomBar.setBackgroundResource(R.drawable.bg_bottom_bar)
            urlContainer.setBackgroundResource(R.drawable.bg_url_bar)
            val iconColor = ContextCompat.getColor(this, R.color.via_icon)
            val secondary = ContextCompat.getColor(this, R.color.via_text_secondary)
            listOf(
                R.id.btnBack, R.id.btnForward, R.id.btnHome, R.id.btnTabs, R.id.btnMenu,
                R.id.btnTopQr, R.id.btnRefresh, R.id.btnClearUrl
            ).forEach { id ->
                (findViewById<View>(id) as? ImageButton)?.setColorFilter(iconColor)
            }
            (urlContainer as? android.view.ViewGroup)?.let { group ->
                for (i in 0 until group.childCount) {
                    val child = group.getChildAt(i)
                    if (child is android.widget.ImageView && child !is ImageButton) {
                        child.setColorFilter(secondary)
                    }
                }
            }
            tabCountBadge.setTextColor(iconColor)
            titleView.setTextColor(ContextCompat.getColor(this, R.color.via_text))
            urlBar.setTextColor(ContextCompat.getColor(this, R.color.via_text))
            urlBar.setHintTextColor(secondary)
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars =
                !app.prefs.nightMode
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars =
                !app.prefs.nightMode
        }
    }

    private fun isColorLight(color: Int): Boolean {
        val r = android.graphics.Color.red(color)
        val g = android.graphics.Color.green(color)
        val b = android.graphics.Color.blue(color)
        // perceived luminance
        return (r * 0.299 + g * 0.587 + b * 0.114) > 160
    }

    private fun showTabSwitcher() {
        hideMenuPanel()
        hideSuggestions()
        tabAdapter.submit(tabManager.snapshot())
        val sheet = findViewById<View>(R.id.tabSheet)
        resizeSheets()
        findViewById<TextView>(R.id.tabSheetTitle).text = "${tabAdapter.itemCount} 个标签页"
        com.shifuf.prism.ui.SheetMotion.show(tabSwitcher, sheet)
        sheet.post { resizeSheets() }
    }

    private fun hideTabSwitcher() {
        val sheet = findViewById<View>(R.id.tabSheet)
        com.shifuf.prism.ui.SheetMotion.hide(tabSwitcher, sheet)
    }

    private fun showMenuPanel() {
        hideTabSwitcher()
        hideSuggestions()
        setupMenuPager()
        val sheet = findViewById<View>(R.id.menuSheet)
        com.shifuf.prism.ui.SheetMotion.show(menuOverlay, sheet)
        sheet.post { resizeSheets() }
    }

    private fun hideMenuPanel() {
        val sheet = findViewById<View>(R.id.menuSheet)
        com.shifuf.prism.ui.SheetMotion.hide(menuOverlay, sheet)
    }

    private fun showAddBookmarkDialog() {
        val c = tabManager.activeController
        val url = c?.currentUrl().orEmpty()
        val title = c?.currentTitle().orEmpty()
        if (url.isBlank() || url.startsWith("about:") || url.startsWith("data:")) {
            Toast.makeText(this, "当前页无法添加书签", Toast.LENGTH_SHORT).show()
            return
        }
        // Toggle: if already bookmarked, offer remove
        if (app.bookmarks.isBookmarked(url)) {
            DialogUi.material(this)
                .setTitle("已添加书签")
                .setMessage("$title\n$url")
                .setPositiveButton("取消书签") { _, _ ->
                    app.bookmarks.removeByUrl(url)
                    Toast.makeText(this, "已取消书签", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            return
        }
        val folders = listOf(BOOKMARK_ROOT_ID to "根目录") +
            app.bookmarks.allFolders().map { f ->
                val path = app.bookmarks.folderPath(f.id).joinToString(" / ") { it.name }
                f.id to path
            }
        val labels = folders.map { it.second }.toTypedArray()
        var selected = 0
        DialogUi.material(this)
            .setTitle("添加书签")
            .setMessage("$title\n$url")
            .setSingleChoiceItems(labels, 0) { _, which -> selected = which }
            .setPositiveButton("添加") { _, _ ->
                app.bookmarks.add(title, url, folders[selected].first)
                Toast.makeText(this, "已添加书签", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun ensureCameraAndScan() {
        val ok = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (ok) openQr() else cameraPermission.launch(Manifest.permission.CAMERA)
    }

    private fun openQr() {
        qrLauncher.launch(Intent(this, QrScanActivity::class.java))
    }

    override fun onUrlChanged(url: String) {
        val normalized = if (url.startsWith("data:")) PreferenceStore.HOME_URL else url
        currentPageUrl = normalized
        if (isHomeUrl(normalized)) currentPageTitle = "主页"
        if (!editingAddress) showTitleMode()
        applyImmersiveChrome(isHomeUrl(normalized))
        // New page starts at top; re-evaluate after first layout/scroll
        updateSwipeRefreshEnabled(true)
        findViewById<View>(R.id.webContainer)?.post {
            updateSwipeRefreshEnabled(tabManager.isActiveAtTop())
        }
    }

    override fun onTitleChanged(title: String) {
        if (title.isNotBlank()) {
            currentPageTitle = title
            if (!editingAddress) showTitleMode()
        }
        if (tabSwitcher.visibility == View.VISIBLE) {
            tabAdapter.submit(tabManager.snapshot())
        }
    }

    override fun onProgress(progress: Int) {
        if (::btnBack.isInitialized) updateNavigationButtons()
        if (progress in 1..99 && !isHomeUrl(currentPageUrl)) {
            progressBar.visibility = View.VISIBLE
            progressBar.progress = progress
        } else {
            progressBar.visibility = View.GONE
            if (::swipeRefresh.isInitialized) swipeRefresh.isRefreshing = false
        }
    }

    override fun onStatus(text: String) {}

    override fun onHomeAction(uri: String) {
        runOnUiThread {
            when {
                uri == "bshome://bookmarks" -> startActivity(Intent(this, BookmarksActivity::class.java))
                uri == "bshome://history" -> startActivity(Intent(this, HistoryActivity::class.java))
                uri == "bshome://downloads" -> startActivity(Intent(this, DownloadsActivity::class.java))
                uri == "bshome://messages" -> startActivity(Intent(this, com.shifuf.prism.ui.PushHistoryActivity::class.java))
                uri == "bshome://settings" -> settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
                uri == "bshome://add" || uri.startsWith("bshome://add?") -> showAddHomeShortcutDialog()
                uri.startsWith("bshome://edit") -> {
                    val id = runCatching { Uri.parse(uri).getQueryParameter("id") }.getOrNull().orEmpty()
                    if (id.isNotBlank()) showEditHomeShortcutDialog(id)
                }
                uri.startsWith("bshome://reorder") -> {
                    val parsed = runCatching { Uri.parse(uri) }.getOrNull()
                    val from = parsed?.getQueryParameter("from").orEmpty()
                    val to = parsed?.getQueryParameter("to").orEmpty()
                    if (from.isNotBlank() && to.isNotBlank()) {
                        app.homeShortcuts.move(from, to)
                        tabManager.loadInActive(PreferenceStore.HOME_URL)
                    }
                }
                uri == "bshome://scan" -> ensureCameraAndScan()
            }
        }
    }

    override fun onLinkLongPress(url: String, isImage: Boolean) {
        runOnUiThread {
            showLinkLongPressMenu(url, isImage)
        }
    }

    private var lastLinkMenuAt = 0L
    private var lastLinkMenuUrl = ""

    override fun onScrollChanged(scrollY: Int) {
        // Keep this light: enable pull-to-refresh only at absolute top
        if (!::swipeRefresh.isInitialized) return
        val atTop = scrollY <= 1 && (::tabManager.isInitialized && tabManager.isActiveAtTop())
        if (swipeRefresh.isEnabled != atTop) {
            swipeRefresh.isEnabled = atTop
        }
    }

    private fun updateSwipeRefreshEnabled(atTopHint: Boolean) {
        if (!::swipeRefresh.isInitialized || !::tabManager.isInitialized) return
        val atTop = atTopHint && tabManager.isActiveAtTop()
        swipeRefresh.isEnabled = atTop
    }

    private fun showLinkLongPressMenu(url: String, isImage: Boolean) {
        if (url.isBlank()) return
        val now = System.currentTimeMillis()
        if (url == lastLinkMenuUrl && now - lastLinkMenuAt < 600) return
        lastLinkMenuAt = now
        lastLinkMenuUrl = url
        val options = mutableListOf(
            "在新标签打开",
            "后台打开",
            "复制链接",
            "分享链接"
        )
        if (url.startsWith("http")) {
            options += "添加书签"
            options += "添加到主页"
        }
        if (isImage) options += "下载图片"
        DialogUi.material(this)
            .setTitle(prettyHost(url).ifBlank { url }.take(48))
            .setItems(options.toTypedArray()) { _, which ->
                when (options[which]) {
                    "在新标签打开" -> {
                        tabManager.open(url, switchTo = true)
                        Toast.makeText(this, "已在新标签打开", Toast.LENGTH_SHORT).show()
                    }
                    "后台打开" -> {
                        tabManager.open(url, switchTo = false)
                        Toast.makeText(this, "已在后台打开", Toast.LENGTH_SHORT).show()
                    }
                    "复制链接" -> {
                        val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("url", url))
                        Toast.makeText(this, "已复制", Toast.LENGTH_SHORT).show()
                    }
                    "分享链接" -> {
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, url)
                        }
                        startActivity(Intent.createChooser(send, "分享链接"))
                    }
                    "添加书签" -> {
                        val title = prettyHost(url)
                        app.bookmarks.add(title, url)
                        Toast.makeText(this, "已添加书签", Toast.LENGTH_SHORT).show()
                    }
                    "添加到主页" -> {
                        app.homeShortcuts.add(prettyHost(url), url)
                        Toast.makeText(this, "已添加到主页", Toast.LENGTH_SHORT).show()
                    }
                    "下载图片" -> {
                        runCatching {
                            app.downloads.enqueue(
                                url = url,
                                mimeType = "image/*",
                                pageUrl = currentPageUrl
                            )
                            Toast.makeText(this, "已开始下载图片", Toast.LENGTH_SHORT).show()
                        }.onFailure {
                            Toast.makeText(this, "下载失败: ${it.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun refreshHomeShortcuts() {
        if (isHomeUrl(tabManager.activeController?.currentUrl().orEmpty())) tabManager.loadInActive(PreferenceStore.HOME_URL)
    }

    private fun showAddHomeShortcutDialog() {
        val url = currentPageUrl.takeIf { !isHomeUrl(it) && it.startsWith("http") }.orEmpty()
        DialogUi.showWebsiteEditor(this, "添加网站", if (url.isBlank()) "" else currentPageTitle,
            url, bookmarks = app.bookmarks.all()) { title, address ->
            app.homeShortcuts.add(title, address)
            refreshHomeShortcuts()
            Toast.makeText(this, "已添加", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showEditHomeShortcutDialog(id: String) {
        val item = app.homeShortcuts.get(id) ?: return
        DialogUi.showWebsiteEditor(this, "编辑网站", item.title, item.url,
            bookmarks = app.bookmarks.all(), onDelete = {
                app.homeShortcuts.remove(id)
                refreshHomeShortcuts()
            }) { title, address ->
            app.homeShortcuts.update(id, title, address)
            refreshHomeShortcuts()
            Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showHomeShortcutOrderActions(id: String) {
        val all = app.homeShortcuts.all()
        val idx = all.indexOfFirst { it.id == id }
        if (idx < 0) return
        val options = mutableListOf<String>()
        if (idx > 0) options += "上移"
        if (idx < all.lastIndex) options += "下移"
        options += "移到最前"
        options += "移到最后"
        DialogUi.material(this)
            .setTitle("调整顺序")
            .setItems(options.toTypedArray()) { _, which ->
                val label = options[which]
                val ordered = all.map { it.id }.toMutableList()
                ordered.remove(id)
                when (label) {
                    "上移" -> ordered.add((idx - 1).coerceAtLeast(0), id)
                    "下移" -> ordered.add((idx).coerceAtMost(ordered.size), id)
                    "移到最前" -> ordered.add(0, id)
                    "移到最后" -> ordered.add(id)
                }
                app.homeShortcuts.reorder(ordered)
                tabManager.loadInActive(PreferenceStore.HOME_URL)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private var edgeTracking = false
    private var edgeArmed = false
    private var edgeFromLeft = false
    private var edgeStartX = 0f
    private var edgeStartY = 0f
    private var edgeHintLeft: View? = null
    private var edgeHintRight: View? = null

    private fun hideEdgeHints() {
        edgeHintLeft?.visibility = View.GONE
        edgeHintRight?.visibility = View.GONE
        edgeHintLeft?.alpha = 1f
        edgeHintRight?.alpha = 1f
        edgeHintLeft?.translationX = 0f
        edgeHintRight?.translationX = 0f
    }

    override fun dispatchTouchEvent(ev: android.view.MotionEvent): Boolean {
        if (edgeHintLeft == null) {
            edgeHintLeft = findViewById(R.id.edgeHintLeft)
            edgeHintRight = findViewById(R.id.edgeHintRight)
        }
        val sheetsOpen = (::tabSwitcher.isInitialized && tabSwitcher.visibility == View.VISIBLE) ||
            (::menuOverlay.isInitialized && menuOverlay.visibility == View.VISIBLE) ||
            (::suggestPanel.isInitialized && suggestPanel.visibility == View.VISIBLE)
        if (!sheetsOpen && ::tabManager.isInitialized) {
            val edge = 24f * resources.displayMetrics.density
            val slop = android.view.ViewConfiguration.get(this).scaledTouchSlop
            when (ev.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    edgeFromLeft = ev.x <= edge
                    val fromRight = ev.x >= resources.displayMetrics.widthPixels - edge
                    // Only arm; don't track until user actually moves horizontally
                    edgeTracking = false
                    edgeStartX = ev.x
                    edgeStartY = ev.y
                    edgeArmed = edgeFromLeft || fromRight
                    if (!edgeFromLeft && fromRight) edgeFromLeft = false
                }
                android.view.MotionEvent.ACTION_MOVE -> {
                    if (edgeArmed && !edgeTracking) {
                        val dx = ev.x - edgeStartX
                        val dy = ev.y - edgeStartY
                        if (kotlin.math.abs(dx) > slop && kotlin.math.abs(dx) > kotlin.math.abs(dy) * 1.2f) {
                            edgeTracking = true
                            if (edgeFromLeft) {
                                edgeHintLeft?.visibility = View.VISIBLE
                                edgeHintLeft?.alpha = 0.35f
                            } else {
                                edgeHintRight?.visibility = View.VISIBLE
                                edgeHintRight?.alpha = 0.35f
                            }
                        } else if (kotlin.math.abs(dy) > slop) {
                            edgeArmed = false // vertical scroll — give up edge gesture
                        }
                    }
                    if (edgeTracking) {
                        val dx = ev.x - edgeStartX
                        val progress = (kotlin.math.abs(dx) / (slop * 6f)).coerceIn(0f, 1f)
                        if (edgeFromLeft && dx > 0) {
                            edgeHintLeft?.alpha = 0.35f + 0.65f * progress
                            edgeHintLeft?.translationX = 12f * progress * resources.displayMetrics.density
                        } else if (!edgeFromLeft && dx < 0) {
                            edgeHintRight?.alpha = 0.35f + 0.65f * progress
                            edgeHintRight?.translationX = -12f * progress * resources.displayMetrics.density
                        }
                    }
                }
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> {
                    val wasTracking = edgeTracking
                    val dx = ev.x - edgeStartX
                    val dy = ev.y - edgeStartY
                    edgeTracking = false
                    edgeArmed = false
                    hideEdgeHints()
                    if (wasTracking &&
                        kotlin.math.abs(dx) > slop * 3 &&
                        kotlin.math.abs(dx) > kotlin.math.abs(dy)
                    ) {
                        val handled = if (edgeFromLeft && dx > 0) {
                            tabManager.activeController?.goBack() == true
                        } else if (!edgeFromLeft && dx < 0) {
                            tabManager.activeController?.goForward() == true
                        } else false
                        if (handled) return true
                    }
                }
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            suggestPanel.visibility == View.VISIBLE || editingAddress -> exitEditMode()
            menuOverlay.visibility == View.VISIBLE -> hideMenuPanel()
            tabSwitcher.visibility == View.VISIBLE -> hideTabSwitcher()
            tabManager.activeController?.goBack() == true -> Unit
            else -> {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    override fun onDestroy() {
        app.debugServer.setNavigateHandler(null)
        app.debugServer.setStateProvider(null)
        if (::tabManager.isInitialized) tabManager.destroyAll()
        super.onDestroy()
    }

    private class SuggestAdapter(
        val onClick: (SearchSuggestions.Item) -> Unit
    ) : RecyclerView.Adapter<SuggestAdapter.VH>() {
        private val data = mutableListOf<SearchSuggestions.Item>()
        fun submit(list: List<SearchSuggestions.Item>) {
            data.clear(); data.addAll(list); notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_suggest, parent, false)
            return VH(v)
        }

        override fun getItemCount() = data.size
        override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(data[position])

        inner class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val title: TextView = itemView.findViewById(R.id.suggestTitle)
            private val sub: TextView = itemView.findViewById(R.id.suggestSub)
            fun bind(item: SearchSuggestions.Item) {
                title.text = item.title
                sub.text = item.subtitle
                itemView.setOnClickListener { onClick(item) }
            }
        }
    }

    companion object {
        const val EXTRA_OPEN_URL = "open_url"
    }
}
