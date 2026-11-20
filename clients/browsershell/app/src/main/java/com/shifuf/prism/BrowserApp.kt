package com.shifuf.prism

import android.app.Application
import com.shifuf.prism.adblock.AdBlockEngine
import com.shifuf.prism.core.BookmarkStore
import com.shifuf.prism.core.DownloadNotifier
import com.shifuf.prism.core.DownloadRepository
import com.shifuf.prism.core.FaviconCache
import com.shifuf.prism.core.HistoryStore
import com.shifuf.prism.core.HomeShortcutStore
import com.shifuf.prism.core.NetworkLogStore
import com.shifuf.prism.core.PreferenceStore
import com.shifuf.prism.core.ResourceSniffer
import com.shifuf.prism.debug.DebugProtocolServer
import com.shifuf.prism.push.JPushHelper
import com.shifuf.prism.push.PushHistoryStore
import com.shifuf.prism.push.PushKeepAliveService
import com.shifuf.prism.push.PushNotifier
import com.shifuf.prism.push.PushProcess
import com.shifuf.prism.script.UserscriptStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class BrowserApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    lateinit var prefs: PreferenceStore
        private set
    lateinit var scriptStore: UserscriptStore
        private set
    lateinit var networkLog: NetworkLogStore
        private set
    lateinit var sniffer: ResourceSniffer
        private set
    lateinit var adBlock: AdBlockEngine
        private set
    lateinit var debugServer: DebugProtocolServer
        private set
    lateinit var bookmarks: BookmarkStore
        private set
    lateinit var historyStore: HistoryStore
        private set
    lateinit var downloads: DownloadRepository
        private set
    lateinit var homeShortcuts: HomeShortcutStore
        private set
    lateinit var favicons: FaviconCache
        private set
    lateinit var pushHistory: PushHistoryStore
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Lightweight prefs first
        prefs = PreferenceStore(this)
        pushHistory = PushHistoryStore(this)

        val pushCore = PushProcess.isPushCoreProcess(this)
        if (pushCore) {
            // push process: only async JPush, no browser stack
            return
        }
        // Start registration before the browser store graph warms up. JPushHelper dispatches all
        // native/network initialization to its worker, keeping process and receiver startup light.
        JPushHelper.init(this, privacyAgreed = true)
        com.shifuf.prism.push.DevicePlatformClient.retryPending(this)
        androidx.appcompat.app.AppCompatDelegate.setDefaultNightMode(
            if (prefs.nightMode) androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_YES
            else androidx.appcompat.app.AppCompatDelegate.MODE_NIGHT_NO
        )
        com.shifuf.prism.push.MsgPlatformClient.retryPending(prefs)
        runCatching {
            val connectivity = getSystemService(android.net.ConnectivityManager::class.java)
            connectivity.registerDefaultNetworkCallback(object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    com.shifuf.prism.push.MsgPlatformClient.retryPending(prefs)
                    com.shifuf.prism.push.DevicePlatformClient.retryPending(this@BrowserApp)
                    JPushHelper.recover(this@BrowserApp)
                }
            })
        }

        // Main process: browser stack first so UI can open immediately
        scriptStore = UserscriptStore(this)
        networkLog = NetworkLogStore()
        sniffer = ResourceSniffer()
        adBlock = AdBlockEngine(this)
        debugServer = DebugProtocolServer(this)
        bookmarks = BookmarkStore(this)
        historyStore = HistoryStore(this)
        downloads = DownloadRepository(this)
        homeShortcuts = HomeShortcutStore(this)
        favicons = FaviconCache(this)

        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            private var started = 0
            override fun onActivityStarted(activity: android.app.Activity) {
                if (started++ == 0) {
                    JPushHelper.recover(this@BrowserApp)
                    com.shifuf.prism.push.MsgPlatformClient.retryPending(prefs)
                    com.shifuf.prism.push.DevicePlatformClient.retryPending(this@BrowserApp)
                }
            }
            override fun onActivityStopped(activity: android.app.Activity) { started = (started - 1).coerceAtLeast(0) }
            override fun onActivityCreated(activity: android.app.Activity, state: android.os.Bundle?) {}
            override fun onActivityResumed(activity: android.app.Activity) {}
            override fun onActivityPaused(activity: android.app.Activity) {}
            override fun onActivitySaveInstanceState(activity: android.app.Activity, state: android.os.Bundle) {}
            override fun onActivityDestroyed(activity: android.app.Activity) {}
        })

        // Defer heavy disk/network work so first frame is interactive
        appScope.launch {
            runCatching { scriptStore.ensureSeedScripts() }
            runCatching { adBlock.loadDefaults() }
            runCatching { DownloadNotifier.ensureChannel(this@BrowserApp) }
            runCatching { PushNotifier.ensureChannel(this@BrowserApp) }
            val urls = homeShortcuts.all().map { it.url } + bookmarks.all().take(20).map { it.url }
            favicons.prefetch(urls)
            if (prefs.adBlockAutoUpdate) {
                runCatching { adBlock.updateAll() }
            }
        }
    }

    companion object {
        lateinit var instance: BrowserApp
            private set
    }
}
