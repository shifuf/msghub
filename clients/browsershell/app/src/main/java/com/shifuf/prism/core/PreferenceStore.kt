package com.shifuf.prism.core

import android.content.Context
import java.io.File

enum class SearchEngine(
    val id: String,
    val displayName: String,
    val homeUrl: String,
    val queryUrl: String
) {
    BAIDU("baidu", "百度", "https://www.baidu.com", "https://www.baidu.com/s?wd=%s"),
    GOOGLE("google", "谷歌", "https://www.google.com", "https://www.google.com/search?q=%s"),
    BING("bing", "必应", "https://www.bing.com", "https://www.bing.com/search?q=%s"),
    SO360("so360", "360搜索", "https://www.so.com", "https://www.so.com/s?q=%s"),
    SOGOU("sogou", "搜狗", "https://www.sogou.com", "https://www.sogou.com/web?query=%s"),
    DUCK("duck", "DuckDuckGo", "https://duckduckgo.com", "https://duckduckgo.com/?q=%s");

    fun search(query: String): String =
        queryUrl.replace("%s", android.net.Uri.encode(query))

    companion object {
        fun fromId(id: String): SearchEngine = entries.find { it.id == id } ?: BAIDU
    }
}

enum class UaProfile(val id: String, val label: String) {
    DEFAULT("default", "默认（系统）"),
    CHROME_ANDROID("chrome_android", "Chrome Android"),
    CHROME_DESKTOP("chrome_desktop", "Chrome 电脑"),
    IPHONE("iphone", "iPhone Safari"),
    IPAD("ipad", "iPad Safari"),
    WECHAT("wechat", "微信浏览器");

    companion object {
        fun fromId(id: String): UaProfile = entries.find { it.id == id } ?: DEFAULT
    }
}

class PreferenceStore(context: Context) {
    private val sp = context.getSharedPreferences("browser_prefs", Context.MODE_PRIVATE)
    private val filesDir = context.filesDir

    var adBlockEnabled: Boolean
        get() = sp.getBoolean(KEY_ADBLOCK, true)
        set(value) = sp.edit().putBoolean(KEY_ADBLOCK, value).apply()

    var desktopMode: Boolean
        get() = sp.getBoolean(KEY_DESKTOP, false)
        set(value) = sp.edit().putBoolean(KEY_DESKTOP, value).apply()

    var debugServerEnabled: Boolean
        get() = sp.getBoolean(KEY_DEBUG, false)
        set(value) = sp.edit().putBoolean(KEY_DEBUG, value).apply()

    var lastUrl: String
        get() {
            val v = sp.getString(KEY_LAST_URL, HOME_URL) ?: HOME_URL
            return if (v.startsWith("data:") || v == "https://example.com" || v == "https://www.baidu.com") HOME_URL else v
        }
        set(value) {
            val store = if (value.startsWith("data:")) HOME_URL else value
            sp.edit().putString(KEY_LAST_URL, store).apply()
        }

    var adBlockListUrl: String
        get() = sp.getString(KEY_ADBLOCK_URL, "https://easylist.to/easylist/easylist.txt")
            ?: "https://easylist.to/easylist/easylist.txt"
        set(value) = sp.edit().putString(KEY_ADBLOCK_URL, value).apply()

    var adBlockAutoUpdate: Boolean
        get() = sp.getBoolean(KEY_ADBLOCK_AUTO, false)
        set(value) = sp.edit().putBoolean(KEY_ADBLOCK_AUTO, value).apply()

    var preferredPlayerPackage: String
        get() = sp.getString(KEY_PLAYER_PKG, "") ?: ""
        set(value) = sp.edit().putString(KEY_PLAYER_PKG, value).apply()

    var searchEngineId: String
        get() = sp.getString(KEY_SEARCH, SearchEngine.BAIDU.id) ?: SearchEngine.BAIDU.id
        set(value) = sp.edit().putString(KEY_SEARCH, value).apply()

    val searchEngine: SearchEngine get() = SearchEngine.fromId(searchEngineId)

    var homeBgColor: String
        get() = sp.getString(KEY_HOME_BG, "#F2F2F7") ?: "#F2F2F7"
        set(value) = sp.edit().putString(KEY_HOME_BG, value).apply()

    var homeLogoText: String
        get() = sp.getString(KEY_HOME_LOGO, "棱") ?: "棱"
        set(value) = sp.edit().putString(KEY_HOME_LOGO, value).apply()

    var homeWallpaperPath: String
        get() = sp.getString(KEY_HOME_WALL, "") ?: ""
        set(value) = sp.edit().putString(KEY_HOME_WALL, value).apply()

    fun homeWallpaperFile(): File = File(filesDir, "home_wallpaper.jpg")

    var nightMode: Boolean
        get() = sp.getBoolean(KEY_NIGHT, false)
        set(value) = sp.edit().putBoolean(KEY_NIGHT, value).apply()

    /** Resolved home background considering night mode sync. */
    fun effectiveHomeBgColor(): String {
        val raw = homeBgColor
        if (!nightMode) return raw
        // Night mode: force dark home if user picked a light solid color
        return try {
            val c = android.graphics.Color.parseColor(raw)
            val lum = android.graphics.Color.red(c) * 0.299 +
                android.graphics.Color.green(c) * 0.587 +
                android.graphics.Color.blue(c) * 0.114
            if (lum > 160) "#000000" else raw
        } catch (_: Exception) {
            "#000000"
        }
    }

    var privateMode: Boolean
        get() = sp.getBoolean(KEY_PRIVATE, false)
        set(value) = sp.edit().putBoolean(KEY_PRIVATE, value).apply()

    var uaProfileId: String
        get() = sp.getString(KEY_UA, UaProfile.DEFAULT.id) ?: UaProfile.DEFAULT.id
        set(value) = sp.edit().putString(KEY_UA, value).apply()

    val uaProfile: UaProfile get() = UaProfile.fromId(uaProfileId)

    /** true = Android DownloadManager; false = built-in downloader */
    var downloadUseSystem: Boolean
        get() = sp.getBoolean(KEY_DL_SYSTEM, false)
        set(value) = sp.edit().putBoolean(KEY_DL_SYSTEM, value).apply()

    /** Custom absolute path for built-in downloads; empty = app private downloads */
    var downloadDirPath: String
        get() = sp.getString(KEY_DL_DIR, "") ?: ""
        set(value) = sp.edit().putString(KEY_DL_DIR, value).apply()

    /**
     * 消息推送平台根地址，例如 https://msg.shifuf.com
     * 用于点击通知后回传已读（取消未读邮件兜底）。
     */
    var msgPlatformBaseUrl: String
        get() = sp.getString(KEY_MSG_BASE, "https://msg.shifuf.com") ?: "https://msg.shifuf.com"
        set(value) = sp.edit().putString(KEY_MSG_BASE, value.trim()).apply()

    var pendingReadReceipts: String
        get() = sp.getString("pending_read_receipts", "[]") ?: "[]"
        set(value) { sp.edit().putString("pending_read_receipts", value).commit() }

    fun readReceiptQueue() = com.shifuf.prism.push.ReadReceiptQueue(java.io.File(filesDir, "read_receipts.json"))

    fun deviceReceiptQueue() = com.shifuf.prism.push.DeviceReceiptQueue(java.io.File(filesDir, "device_receipts.json"))

    fun conversationSession(originalBase: String, messageId: String): com.shifuf.prism.push.ConversationSessionFile {
        val key = java.security.MessageDigest.getInstance("SHA-256")
            .digest("$originalBase\u0000$messageId".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        return com.shifuf.prism.push.ConversationSessionFile(File(filesDir, "conversations/$key.json"))
    }

    companion object {
        const val HOME_URL = "about:home"
        private const val KEY_ADBLOCK = "adblock_enabled"
        private const val KEY_DESKTOP = "desktop_mode"
        private const val KEY_DEBUG = "debug_server"
        private const val KEY_LAST_URL = "last_url"
        private const val KEY_ADBLOCK_URL = "adblock_list_url"
        private const val KEY_ADBLOCK_AUTO = "adblock_auto_update"
        private const val KEY_PLAYER_PKG = "preferred_player_pkg"
        private const val KEY_SEARCH = "search_engine"
        private const val KEY_HOME_BG = "home_bg"
        private const val KEY_HOME_LOGO = "home_logo"
        private const val KEY_HOME_WALL = "home_wallpaper_path"
        private const val KEY_NIGHT = "night_mode"
        private const val KEY_PRIVATE = "private_mode"
        private const val KEY_UA = "ua_profile"
        private const val KEY_DL_SYSTEM = "download_use_system"
        private const val KEY_DL_DIR = "download_dir_path"
        private const val KEY_MSG_BASE = "msg_platform_base_url"
    }
}
