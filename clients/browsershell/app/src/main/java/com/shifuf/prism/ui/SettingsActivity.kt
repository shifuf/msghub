package com.shifuf.prism.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.R
import com.shifuf.prism.core.SearchEngine
import com.shifuf.prism.core.UaProfile
import com.google.android.material.appbar.MaterialToolbar
import java.io.File
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch

class SettingsActivity : PrismActivity() {
    private val app get() = BrowserApp.instance
    private lateinit var adapter: Adapter
    private var pendingChanges = Bundle()
    private var searchQuery = ""
    private val wallpaperModel by lazy { androidx.lifecycle.ViewModelProvider(this)[WallpaperViewModel::class.java] }

    private fun changed(key: String) {
        pendingChanges.putBoolean(key, true)
        setResult(RESULT_OK, Intent().putExtras(pendingChanges))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBundle("pending_changes", pendingChanges)
        super.onSaveInstanceState(outState)
    }

    private val wallpaperPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) wallpaperModel.save(uri)
    }

    private val folderPicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
        val uri = result.data?.data ?: return@registerForActivityResult
        val path = resolveTreePath(uri)
        if (path.isNullOrBlank()) {
            Toast.makeText(this, "内置下载器暂不支持此目录，请使用应用目录或系统下载", Toast.LENGTH_LONG).show()
        } else {
            val dir = File(path)
            val writable = runCatching {
                dir.mkdirs()
                val probe = File.createTempFile("prism-check-", ".tmp", dir)
                probe.delete()
            }.getOrDefault(false)
            if (writable) {
                app.prefs.downloadDirPath = dir.absolutePath
                Toast.makeText(this, "下载目录：$path", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "目录不可用", Toast.LENGTH_SHORT).show()
            }
        }
        refresh()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingChanges = savedInstanceState?.getBundle("pending_changes") ?: Bundle()
        if (!pendingChanges.isEmpty) setResult(RESULT_OK, Intent().putExtras(pendingChanges))
        setContentView(R.layout.activity_settings)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        adapter = Adapter(
            onClick = { onRow(it) },
            onToggle = { id, checked ->
                when (id) {
                    52 -> { com.shifuf.prism.update.AppUpdater.setAutoEnabled(this, checked); refresh() }
                    3 -> toggleDesktop(checked)
                    4 -> togglePrivate(checked)
                    10 -> toggleNight(checked)
                    20 -> toggleDownloadSystem(checked)
                    30 -> toggleAdblock(checked)
                    42 -> toggleDebug(checked)
                    72 -> {
                        if (checked) com.shifuf.prism.push.JPushHelper.resume(this)
                        else com.shifuf.prism.push.JPushHelper.stop(this)
                        refresh()
                    }
                    74 -> {
                        com.shifuf.prism.push.JPushHelper.setKeepAliveEnabled(this, checked)
                        refresh()
                    }
                }
            }
        )
        val recycler = findViewById<RecyclerView>(R.id.recycler)
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        val search = findViewById<android.widget.EditText>(R.id.settingsSearch)
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                searchQuery = s?.toString().orEmpty()
                refresh()
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })
        lifecycleScope.launch {
            lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
                wallpaperModel.state.collect { state ->
                    when (state) {
                        WallpaperViewModel.State.SAVED -> {
                            changed(EXTRA_HOME_APPEARANCE)
                            refresh()
                            Toast.makeText(this@SettingsActivity, "主页壁纸已更新", Toast.LENGTH_SHORT).show()
                            wallpaperModel.consumeResult()
                        }
                        WallpaperViewModel.State.FAILED -> {
                            Toast.makeText(this@SettingsActivity, "壁纸设置失败，请重新选择图片", Toast.LENGTH_LONG).show()
                            wallpaperModel.consumeResult()
                        }
                        else -> Unit
                    }
                }
            }
        }
        refresh()
    }

    override fun onResume() {
        super.onResume()
        com.shifuf.prism.push.DevicePlatformClient.updateHeartbeat(this)
        refresh()
        com.shifuf.prism.update.AppUpdater.resumeInstallation(this)
    }

    private fun refresh() {
        if (!::adapter.isInitialized) return
        val all = buildRows()
        val filtered = mutableListOf<Row>()
        var section: Row.Section? = null
        var addedSection: Row.Section? = null
        all.forEach { row ->
            if (row is Row.Section) section = row
            else {
                val match = when (row) {
                    is Row.Item -> UiSearch.matches(searchQuery, row.title, row.subtitle, section?.title)
                    is Row.Switch -> UiSearch.matches(searchQuery, row.title, row.subtitle, section?.title)
                    else -> false
                }
                if (match) {
                    section?.let { if (it != addedSection) { filtered.add(it); addedSection = it } }
                    filtered.add(row)
                }
            }
        }
        adapter.submit(filtered)
        findViewById<View>(R.id.settingsEmpty).visibility = if (filtered.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun buildRows(): List<Row> {
        val dlPath = app.prefs.downloadDirPath.ifBlank { "应用私有目录" }.let {
            if (it.length > 28) "…" + it.takeLast(27) else it
        }
        val wallLabel = when {
            app.prefs.homeWallpaperPath.isBlank() -> "点击设置壁纸"
            else -> "已设置 · 点击更换"
        }
        return listOf(
            Row.Section("浏览"),
            Row.Item(1, R.drawable.ic_search, "搜索引擎", app.prefs.searchEngine.displayName),
            Row.Item(2, R.drawable.ic_desktop, "浏览器标识", app.prefs.uaProfile.label),
            Row.Switch(3, R.drawable.ic_desktop, "电脑模式", "使用桌面站点 UA", app.prefs.desktopMode),
            Row.Switch(4, R.drawable.ic_shield, "无痕模式", "不保存历史与会话", app.prefs.privateMode),

            Row.Section("外观"),
            Row.Switch(10, R.drawable.ic_night, "夜间模式", "深色界面与主页", app.prefs.nightMode),
            Row.Item(11, R.drawable.ic_reader, "主页背景色", app.prefs.homeBgColor),
            Row.Item(12, R.drawable.ic_star, "主页壁纸", wallLabel),
            Row.Item(14, R.drawable.ic_home, "主页图标", "${app.homeShortcuts.all().size} 个 · 管理"),
            Row.Item(13, R.drawable.ic_refresh, "恢复默认外观", "重置颜色与壁纸"),

            Row.Section("下载"),
            Row.Switch(20, R.drawable.ic_download, "使用系统下载", "关闭则用内置下载器", app.prefs.downloadUseSystem),
            Row.Item(21, R.drawable.ic_download, "下载目录", dlPath),
            Row.Item(22, R.drawable.ic_folder, "选择下载目录", "系统文件夹选择器"),
            Row.Item(23, R.drawable.ic_refresh, "恢复默认下载目录", null),

            Row.Section("拦截与扩展"),
            Row.Switch(30, R.drawable.ic_block, "广告拦截", "${app.adBlock.ruleCount()} 条规则", app.prefs.adBlockEnabled),
            Row.Item(31, R.drawable.ic_settings, "规则订阅", "EasyList / 自定义"),
            Row.Item(32, R.drawable.ic_code, "用户脚本", "油猴脚本管理"),

            Row.Section("隐私"),
            Row.Item(60, R.drawable.ic_trash, "清除浏览数据", "历史 / Cookie / 缓存 / 图标缓存"),

            Row.Section("工具"),
            Row.Item(40, R.drawable.ic_sniffer, "资源嗅探", "视频 / 音频 / 下载"),
            Row.Item(41, R.drawable.ic_network, "网络日志", "请求与拦截记录"),
            Row.Switch(42, R.drawable.ic_network, "联调服务", if (app.debugServer.isRunning) "运行中 :${app.debugServer.port}" else "WebSocket 调试", app.debugServer.isRunning),

            Row.Section("消息与通知"),
            Row.Item(
                73,
                R.drawable.ic_message,
                "消息中心",
                run {
                    val n = app.pushHistory.all().size
                    val u = app.pushHistory.unreadCount()
                    if (n == 0) "通知与会话" else if (u > 0) "$u 条未读 · 共 $n 条消息" else "$n 条消息 · 全部已读"
                }
            ),
            Row.Item(70, R.drawable.ic_network, "Registration ID", jpushRidLabel()),
            Row.Item(71, R.drawable.ic_copy, "复制 Registration ID", "用于消息平台 / 极光控制台"),
            Row.Item(
                77,
                R.drawable.ic_globe,
                "消息平台地址",
                app.prefs.msgPlatformBaseUrl.ifBlank { "未设置" }.let {
                    if (it.length > 28) it.take(14) + "…" + it.takeLast(10) else it
                }
            ),
            Row.Switch(
                72,
                R.drawable.ic_bell,
                "接收通知",
                if (com.shifuf.prism.push.JPushHelper.isPushStopped(this)) "已关闭" else "已开启",
                !com.shifuf.prism.push.JPushHelper.isPushStopped(this)
            ),
            Row.Switch(
                74,
                R.drawable.ic_network,
                "后台保活",
                if (com.shifuf.prism.push.JPushHelper.isPushStopped(this)) "推送关闭时不运行"
                else if (com.shifuf.prism.push.JPushHelper.isKeepAliveEnabled(this))
                    "已开启（显示「棱镜 · 后台服务」）"
                else "已关闭",
                com.shifuf.prism.push.JPushHelper.isKeepAliveEnabled(this)
            ),
            Row.Item(75, R.drawable.ic_bell, "通知诊断", "查看 RID / 权限 / 连接状态"),
            Row.Item(78, R.drawable.ic_message, "关联消息设备", com.shifuf.prism.push.DevicePlatformClient.pairingLabel(this)),
            Row.Item(79, R.drawable.ic_bell, "通知权限", com.shifuf.prism.push.PushNotifier.channelStatus(this)),
            Row.Item(76, R.drawable.ic_settings, "请求忽略电池优化", "系统可能弹窗确认"),

            Row.Section("关于"),
            Row.Item(50, R.drawable.ic_settings, "版本", "棱镜 ${com.shifuf.prism.BuildConfig.VERSION_NAME}"),
            Row.Item(51, R.drawable.ic_refresh, "检查更新", "从在线更新清单检查新版本"),
            Row.Switch(52, R.drawable.ic_refresh, "自动检查更新", "启动时检查，每天最多一次；下载前确认", com.shifuf.prism.update.AppUpdater.autoEnabled(this)),
        )
    }

    private fun jpushRidLabel(): String {
        val rid = com.shifuf.prism.push.JPushHelper.registrationId(this)
        return if (rid.isBlank()) "等待连接，稍后刷新"
        else if (rid.length > 22) rid.take(10) + "…" + rid.takeLast(8)
        else rid
    }

    private fun onRow(id: Int) {
        when (id) {
            1 -> pickSearchEngine()
            2 -> pickUa()
            3 -> toggleDesktop(!app.prefs.desktopMode)
            4 -> togglePrivate(!app.prefs.privateMode)
            10 -> toggleNight(!app.prefs.nightMode)
            11 -> pickHomeColor()
            12 -> wallpaperPicker.launch("image/*")
            13 -> {
                app.prefs.homeBgColor = "#F2F2F7"
                app.prefs.homeWallpaperPath = ""
                runCatching { app.prefs.homeWallpaperFile().delete() }
                Toast.makeText(this, "已恢复默认外观", Toast.LENGTH_SHORT).show()
                changed(EXTRA_HOME_APPEARANCE)
                refresh()
            }
            14 -> manageHomeShortcuts()
            20 -> toggleDownloadSystem(!app.prefs.downloadUseSystem)
            21 -> {
                val path = app.prefs.downloadDirPath.ifBlank { app.downloads.downloadDir().absolutePath }
                Toast.makeText(this, path, Toast.LENGTH_LONG).show()
            }
            22 -> openFolderPicker()
            23 -> {
                app.prefs.downloadDirPath = ""
                Toast.makeText(this, "已恢复默认下载目录", Toast.LENGTH_SHORT).show()
                refresh()
            }
            30 -> toggleAdblock(!app.prefs.adBlockEnabled)
            31 -> startActivity(Intent(this, FilterRulesActivity::class.java))
            32 -> startActivity(Intent(this, ScriptsActivity::class.java))
            40 -> startActivity(
                Intent(this, SnifferActivity::class.java)
                    .putExtra(SnifferActivity.EXTRA_TAB_ID, intent.getStringExtra(SnifferActivity.EXTRA_TAB_ID))
            )
            41 -> startActivity(Intent(this, NetworkLogActivity::class.java))
            42 -> toggleDebug(!app.debugServer.isRunning)
            60 -> clearBrowsingData()
            70 -> {
                val rid = com.shifuf.prism.push.JPushHelper.registrationId(this)
                Toast.makeText(this, if (rid.isBlank()) "尚未获取到 RID" else rid, Toast.LENGTH_LONG).show()
            }
            71 -> {
                val rid = com.shifuf.prism.push.JPushHelper.registrationId(this)
                if (rid.isBlank()) {
                    Toast.makeText(this, "尚未获取到 RID，请稍后再试", Toast.LENGTH_SHORT).show()
                } else {
                    val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("rid", rid))
                    Toast.makeText(this, "已复制 Registration ID", Toast.LENGTH_SHORT).show()
                }
            }
            72 -> {
                val stopped = com.shifuf.prism.push.JPushHelper.isPushStopped(this)
                if (stopped) com.shifuf.prism.push.JPushHelper.resume(this)
                else com.shifuf.prism.push.JPushHelper.stop(this)
                refresh()
            }
            73 -> startActivity(Intent(this, PushHistoryActivity::class.java))
            74 -> {
                val on = !com.shifuf.prism.push.JPushHelper.isKeepAliveEnabled(this)
                com.shifuf.prism.push.JPushHelper.setKeepAliveEnabled(this, on)
                refresh()
            }
            75 -> showPushDiagnostics()
            76 -> requestIgnoreBatteryOptimizations()
            77 -> editMsgPlatformBase()
            78 -> pairPushDevice()
            79 -> openNotificationSettings()
            50 -> Unit
            51 -> com.shifuf.prism.update.AppUpdater.check(this, showLatest = true)
        }
    }

    private fun editMsgPlatformBase() {
        val input = DialogUi.styledEditText(this, "https://msg.shifuf.com", prefill = app.prefs.msgPlatformBaseUrl)
        DialogUi.material(this)
            .setTitle("消息平台地址")
            .setMessage("用于同步消息的已读状态，并打开与管理员的会话。")
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton("保存") { _, _ ->
                var v = input.text?.toString()?.trim().orEmpty()
                if (v.isNotBlank() && !v.startsWith("http://") && !v.startsWith("https://")) {
                    v = "https://$v"
                }
                app.prefs.msgPlatformBaseUrl = v.trimEnd('/')
                Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show()
                refresh()
            }
            .setNeutralButton("默认") { _, _ ->
                app.prefs.msgPlatformBaseUrl = "https://msg.shifuf.com"
                Toast.makeText(this, "已恢复默认", Toast.LENGTH_SHORT).show()
                refresh()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun showPushDiagnostics() {
        val text = com.shifuf.prism.push.JPushHelper.diagnosticText(this)
        DialogUi.material(this)
            .setTitle("通知诊断")
            .setMessage(text)
            .setPositiveButton("复制") { _, _ ->
                val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("diag", text))
                Toast.makeText(this, "已复制诊断信息", Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton("重新检查连接") { _, _ ->
                com.shifuf.prism.push.JPushHelper.recover(this)
                com.shifuf.prism.push.DevicePlatformClient.retryPending(this)
                Toast.makeText(this, "已请求检查连接状态", Toast.LENGTH_SHORT).show()
                refresh()
            }
            .setNegativeButton("关闭", null)
            .show()
    }

    private fun pairPushDevice() {
        val input = DialogUi.styledEditText(this, "16 位配对码").apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            filters = arrayOf(android.text.InputFilter.LengthFilter(16))
        }
        val dialog = DialogUi.material(this)
            .setTitle(if (com.shifuf.prism.push.DevicePairingStore(this).hasEncryptedToken) "重新关联消息设备" else "关联消息设备")
            .setMessage("在消息平台中创建一次性配对码，然后在此输入。设备凭证只保存在本机应用私有存储中。")
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton("关联", null)
            .setNegativeButton("取消", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val code = input.text?.toString()?.trim().orEmpty()
                if (!com.shifuf.prism.push.DevicePlatformProtocol.isPairCode(code)) {
                    input.error = "请输入完整的 16 位十六进制配对码"
                    return@setOnClickListener
                }
                val rid = com.shifuf.prism.push.JPushHelper.registrationId(this)
                if (rid.isBlank()) {
                    input.error = "推送 Registration ID 尚未就绪，请稍后重试"
                    return@setOnClickListener
                }
                input.error = null
                input.isEnabled = false
                dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).isEnabled = false
                com.shifuf.prism.push.DevicePlatformClient.pair(this, code) { result ->
                    if (isFinishing || isDestroyed) return@pair
                    input.isEnabled = true
                    dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).isEnabled = true
                    result.onSuccess { message ->
                        dialog.dismiss()
                        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                        refresh()
                    }.onFailure { error ->
                        input.error = error.message ?: "设备关联失败，请稍后重试"
                    }
                }
            }
        }
        dialog.show()
    }

    private fun openNotificationSettings() {
        runCatching {
            startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName))
        }.onFailure {
            Toast.makeText(this, "无法打开系统通知设置", Toast.LENGTH_LONG).show()
        }
    }

    private fun requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < 23) {
            Toast.makeText(this, "当前系统无需此设置", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) {
                Toast.makeText(this, "已在电池优化白名单中", Toast.LENGTH_SHORT).show()
                return
            }
            val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (e: Exception) {
            // Fallback to app details
            try {
                startActivity(
                    Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                )
            } catch (_: Exception) {
                Toast.makeText(this, "无法打开系统设置: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun toggleDesktop(enabled: Boolean) {
        app.prefs.desktopMode = enabled
        app.prefs.uaProfileId = if (enabled) UaProfile.CHROME_DESKTOP.id else UaProfile.CHROME_ANDROID.id
        Toast.makeText(this, if (enabled) "电脑模式：开" else "电脑模式：关", Toast.LENGTH_SHORT).show()
        changed(EXTRA_RELOAD_UA)
        refresh()
    }

    private fun togglePrivate(enabled: Boolean) {
        app.prefs.privateMode = enabled
        if (enabled) com.shifuf.prism.core.SessionStore(this).clear()
        Toast.makeText(this, if (enabled) "无痕模式已开" else "无痕模式已关", Toast.LENGTH_SHORT).show()
        refresh()
    }

    private fun toggleNight(enabled: Boolean) {
        app.prefs.nightMode = enabled
        changed(EXTRA_HOME_APPEARANCE)
        AppCompatDelegate.setDefaultNightMode(
            if (enabled) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
        )
    }

    private fun toggleDownloadSystem(enabled: Boolean) {
        app.prefs.downloadUseSystem = enabled
        Toast.makeText(this, if (enabled) "下载引擎：系统" else "下载引擎：内置", Toast.LENGTH_SHORT).show()
        refresh()
    }

    private fun toggleAdblock(enabled: Boolean) {
        app.prefs.adBlockEnabled = enabled
        Toast.makeText(this, if (enabled) "广告拦截：开" else "广告拦截：关", Toast.LENGTH_SHORT).show()
        refresh()
    }

    private fun toggleDebug(enable: Boolean) {
        app.prefs.debugServerEnabled = enable
        if (enable) {
            runCatching { app.debugServer.start() }
                .onSuccess { Toast.makeText(this, "联调已开 :${app.debugServer.port}", Toast.LENGTH_LONG).show() }
                .onFailure {
                    app.prefs.debugServerEnabled = false
                    Toast.makeText(this, "启动失败: ${it.message}", Toast.LENGTH_LONG).show()
                }
        } else {
            app.debugServer.stop()
            Toast.makeText(this, "联调已关", Toast.LENGTH_SHORT).show()
        }
        refresh()
    }

    private fun clearBrowsingData() {
        val ranges = listOf(
            "最近 1 小时" to 1L * 60 * 60 * 1000,
            "最近 24 小时" to 24L * 60 * 60 * 1000,
            "最近 7 天" to 7L * 24 * 60 * 60 * 1000,
            "最近 30 天" to 30L * 24 * 60 * 60 * 1000,
            "全部时间" to -1L
        )
        DialogUi.material(this)
            .setTitle("清除时间范围")
            .setItems(ranges.map { it.first }.toTypedArray()) { _, which ->
                val rangeLabel = ranges[which].first
                val duration = ranges[which].second
                val sinceMs = if (duration < 0) 0L else System.currentTimeMillis() - duration
                val allTime = duration < 0
                showClearDataTypes(rangeLabel, sinceMs, allTime)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showClearDataTypes(rangeLabel: String, sinceMs: Long, allTime: Boolean) {
        val options = arrayOf(
            "浏览历史",
            "Cookie / 网站数据",
            "WebView 缓存",
            "网络日志",
            "图标缓存"
        )
        // Cookie/cache/icon usually can't be time-filtered reliably — only enable fully for all-time
        val checked = booleanArrayOf(true, allTime, allTime, true, false)
        DialogUi.material(this)
            .setTitle("清除浏览数据 · $rangeLabel")
            .setMultiChoiceItems(options, checked) { _, which, isChecked ->
                // For non-all-time ranges, Cookie/Cache/Icon are all-or-nothing; warn by forcing all-time only
                if (!allTime && which in listOf(1, 2, 4) && isChecked) {
                    Toast.makeText(this, "${options[which]}仅支持“全部时间”彻底清除", Toast.LENGTH_SHORT).show()
                }
                checked[which] = isChecked
            }
            .setPositiveButton("清除") { _, _ ->
                var summary = ArrayList<String>()
                if (checked[0]) {
                    val n = if (allTime) {
                        val before = app.historyStore.all().size
                        app.historyStore.clear()
                        before
                    } else {
                        app.historyStore.clearSince(sinceMs)
                    }
                    summary += "历史 ${n} 条"
                }
                if (checked[1]) {
                    if (!allTime) {
                        Toast.makeText(this, "Cookie 只能全部清除，已跳过", Toast.LENGTH_SHORT).show()
                    } else {
                        runCatching {
                            val cm = android.webkit.CookieManager.getInstance()
                            cm.removeAllCookies(null)
                            cm.flush()
                        }
                        runCatching { android.webkit.WebStorage.getInstance().deleteAllData() }
                        summary += "Cookie"
                    }
                }
                if (checked[2]) {
                    if (!allTime) {
                        Toast.makeText(this, "缓存只能全部清除，已跳过", Toast.LENGTH_SHORT).show()
                    } else {
                        runCatching {
                            // The live WebView owns its database files; use its cache API.
                            android.webkit.WebView(this).let { webView ->
                                webView.clearCache(true)
                                webView.destroy()
                            }
                        }
                        summary += "缓存"
                    }
                }
                if (checked[3]) {
                    val n = if (allTime) {
                        val before = app.networkLog.snapshot().size
                        app.networkLog.clear()
                        before
                    } else {
                        app.networkLog.clearSince(sinceMs)
                    }
                    summary += "日志 ${n} 条"
                }
                if (checked[4]) {
                    if (!allTime) {
                        Toast.makeText(this, "图标缓存只能全部清除，已跳过", Toast.LENGTH_SHORT).show()
                    } else {
                        app.favicons.clear()
                        summary += "图标缓存"
                    }
                }
                val msg = if (summary.isEmpty()) "未清除任何数据" else "已清除（$rangeLabel）：${summary.joinToString("、")}"
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                changed(EXTRA_HOME_APPEARANCE)
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun deleteDir(dir: java.io.File?) {
        if (dir == null || !dir.exists()) return
        dir.listFiles()?.forEach { child ->
            if (child.isDirectory) deleteDir(child) else runCatching { child.delete() }
        }
    }

    private fun openFolderPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    Uri.parse("content://com.android.externalstorage.documents/document/primary:Download")
                )
            }
        }
        folderPicker.launch(intent)
    }

    fun manageHomeShortcuts() {
        val list = app.homeShortcuts.all()
        if (list.isEmpty()) {
            editShortcut(null, "", "")
            return
        }
        val labels = list.mapIndexed { i, it -> "${i + 1}. ${it.title}\n${it.url}" }.toTypedArray()
        DialogUi.material(this)
            .setTitle("主页图标")
            .setItems(labels) { _, which ->
                val item = list[which]
                DialogUi.material(this)
                    .setTitle(item.title)
                    .setItems(arrayOf("编辑", "上移", "下移", "删除")) { _, action ->
                        when (action) {
                            0 -> editShortcut(item.id, item.title, item.url)
                            1 -> {
                                if (which > 0) {
                                    app.homeShortcuts.move(item.id, list[which - 1].id)
                                    changed(EXTRA_HOME_APPEARANCE)
                                    refresh()
                                }
                            }
                            2 -> {
                                if (which < list.lastIndex) {
                                    app.homeShortcuts.move(item.id, list[which + 1].id)
                                    changed(EXTRA_HOME_APPEARANCE)
                                    refresh()
                                }
                            }
                            3 -> {
                                app.homeShortcuts.remove(item.id)
                                Toast.makeText(this, "已删除", Toast.LENGTH_SHORT).show()
                                changed(EXTRA_HOME_APPEARANCE)
                                refresh()
                            }
                        }
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
            }
            .setNeutralButton("添加") { _, _ ->
                editShortcut(null, "", "")
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun editShortcut(id: String?, title: String, url: String) {
        DialogUi.showWebsiteEditor(this, if (id == null) "添加网站" else "编辑网站", title, url,
            bookmarks = app.bookmarks.all()) { name, address ->
            if (id == null) app.homeShortcuts.add(name, address) else app.homeShortcuts.update(id, name, address)
            changed(EXTRA_HOME_APPEARANCE)
            refresh()
            Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show()
        }
    }

    private fun resolveTreePath(uri: Uri): String? {
        // primary:Download/xxx -> /storage/emulated/0/Download/xxx
        val docId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull() ?: return null
        val parts = docId.split(":", limit = 2)
        if (parts.size < 2) return null
        val type = parts[0]
        val rel = parts[1]
        return if (type.equals("primary", true)) {
            File(Environment.getExternalStorageDirectory(), rel).absolutePath
        } else {
            // secondary storage volume id
            "/storage/$type/$rel"
        }
    }

    private fun pickSearchEngine() {
        val engines = SearchEngine.entries
        DialogUi.material(this)
            .setTitle("默认搜索引擎")
            .setSingleChoiceItems(engines.map { it.displayName }.toTypedArray(), engines.indexOf(app.prefs.searchEngine)) { d, which ->
                app.prefs.searchEngineId = engines[which].id
                Toast.makeText(this, "已切换为 ${engines[which].displayName}", Toast.LENGTH_SHORT).show()
                d.dismiss()
                changed(EXTRA_HOME_APPEARANCE)
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun pickUa() {
        val profiles = UaProfile.entries
        DialogUi.material(this)
            .setTitle("浏览器标识（UA）")
            .setSingleChoiceItems(profiles.map { it.label }.toTypedArray(), profiles.indexOf(app.prefs.uaProfile)) { d, which ->
                val selected = profiles[which]
                app.prefs.uaProfileId = selected.id
                app.prefs.desktopMode = selected == UaProfile.CHROME_DESKTOP
                Toast.makeText(this, "已切换：${selected.label}", Toast.LENGTH_SHORT).show()
                d.dismiss()
                changed(EXTRA_RELOAD_UA)
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun pickHomeColor() {
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
                    Toast.makeText(this, "已应用 ${colors[which].second}", Toast.LENGTH_SHORT).show()
                    changed(EXTRA_HOME_APPEARANCE)
                    refresh()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showVisualColorPicker() {
        val density = resources.displayMetrics.density
        val pad = (16 * density).toInt()
        val root = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad / 2)
        }
        val preview = android.view.View(this).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
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
            root.addView(android.widget.TextView(this).apply {
                text = label
                setTextColor(getColor(R.color.via_text_secondary))
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
        val hexView = android.widget.TextView(this).apply {
            setTextColor(getColor(R.color.via_text))
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
                Toast.makeText(this, "已应用 $hex", Toast.LENGTH_SHORT).show()
                changed(EXTRA_HOME_APPEARANCE)
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private sealed class Row {
        data class Section(val title: String) : Row()
        data class Item(
            val id: Int,
            val icon: Int,
            val title: String,
            val subtitle: String?
        ) : Row()
        data class Switch(
            val id: Int,
            val icon: Int,
            val title: String,
            val subtitle: String?,
            val checked: Boolean
        ) : Row()
    }

    private class Adapter(
        val onClick: (Int) -> Unit,
        val onToggle: (Int, Boolean) -> Unit
    ) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        private val data = mutableListOf<Row>()
        fun submit(list: List<Row>) {
            data.clear(); data.addAll(list); notifyDataSetChanged()
        }

        override fun getItemViewType(position: Int) = when (data[position]) {
            is Row.Section -> 0
            is Row.Item -> 1
            is Row.Switch -> 2
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val layout = when (viewType) {
                0 -> R.layout.item_settings_section
                2 -> R.layout.item_settings_switch
                else -> R.layout.item_settings_row
            }
            val v = LayoutInflater.from(parent.context).inflate(layout, parent, false)
            return object : RecyclerView.ViewHolder(v) {}
        }

        override fun getItemCount() = data.size

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            val lp = holder.itemView.layoutParams as? RecyclerView.LayoutParams
                ?: RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            val first = position == 0 || data[position - 1] is Row.Section
            val last = position == data.lastIndex || data[position + 1] is Row.Section
            if (data[position] !is Row.Section) {
                holder.itemView.background = DialogUi.groupedRow(holder.itemView.context, first, last)
            }
            when (val row = data[position]) {
                is Row.Section -> {
                    lp.topMargin = 0
                    lp.bottomMargin = 0
                    holder.itemView.layoutParams = lp
                    holder.itemView.findViewById<TextView>(R.id.section).text = row.title
                }
                is Row.Item -> {
                    lp.topMargin = 0
                    lp.bottomMargin = 0
                    holder.itemView.layoutParams = lp
                    holder.itemView.findViewById<ImageView>(R.id.icon).setImageResource(row.icon)
                    holder.itemView.findViewById<TextView>(R.id.title).text = row.title
                    val sub = holder.itemView.findViewById<TextView>(R.id.subtitle)
                    val value = holder.itemView.findViewById<TextView>(R.id.value)
                    if (row.subtitle.isNullOrBlank()) {
                        sub.visibility = View.GONE
                        value.visibility = View.GONE
                    } else if (row.subtitle.length <= 8 && !row.subtitle.contains('\n') &&
                        holder.itemView.resources.configuration.fontScale <= 1.2f &&
                        holder.itemView.resources.configuration.screenWidthDp >= 360) {
                        sub.visibility = View.GONE
                        value.visibility = View.VISIBLE
                        value.text = row.subtitle
                    } else {
                        sub.visibility = View.VISIBLE
                        value.visibility = View.GONE
                        sub.text = row.subtitle
                    }
                    holder.itemView.setOnClickListener { onClick(row.id) }
                }
                is Row.Switch -> {
                    lp.topMargin = 0
                    lp.bottomMargin = 0
                    holder.itemView.layoutParams = lp
                    holder.itemView.findViewById<ImageView>(R.id.icon).setImageResource(row.icon)
                    holder.itemView.findViewById<TextView>(R.id.title).text = row.title
                    val sub = holder.itemView.findViewById<TextView>(R.id.subtitle)
                    if (row.subtitle.isNullOrBlank()) {
                        sub.visibility = View.GONE
                    } else {
                        sub.visibility = View.VISIBLE
                        sub.text = row.subtitle
                    }
                    val toggle = holder.itemView.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(R.id.toggle)
                    toggle.setOnCheckedChangeListener(null)
                    toggle.isChecked = row.checked
                    toggle.contentDescription = row.title
                    toggle.setOnCheckedChangeListener { _, isChecked ->
                        onToggle(row.id, isChecked)
                    }
                    holder.itemView.setOnClickListener { toggle.isChecked = !toggle.isChecked }
                }
            }
        }
    }

    companion object {
        const val EXTRA_RELOAD_UA = "reload_ua"
        const val EXTRA_HOME_APPEARANCE = "home_appearance"
    }
}
