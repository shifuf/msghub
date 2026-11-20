package com.shifuf.prism.core

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import androidx.appcompat.app.AlertDialog

data class PlayerApp(
    val label: String,
    val packageName: String,
    val activityName: String,
    val icon: Drawable? = null
)

object ExternalPlayerHelper {
    // Only real video players / media viewers — no browsers
    private val KNOWN_PLAYER_PACKAGES = listOf(
        "com.miui.video",
        "com.miui.videoplayer",
        "com.android.gallery3d",
        "com.miui.gallery",
        "com.google.android.apps.photos",
        "com.coloros.gallery3d",
        "com.vivo.gallery",
        "com.samsung.android.video",
        "com.sec.android.app.videoplayer",
        "com.huawei.himovie",
        "org.videolan.vlc",
        "com.mxtech.videoplayer.ad",
        "com.mxtech.videoplayer.pro",
        "com.mxtech.videoplayer.beta",
        "com.kmplayer",
        "com.brouken.player",
        "tv.danmaku.bili",
        "com.bilibili.app.in",
        // 播霸 / QQ浏览器 媒体组件
        "com.tencent.mtt",
        "com.tencent.qqlive",
        "com.tencent.qqbrowser.x5",
        "com.tencent.mtt.x86"
    )

    private val BLOCKED_PACKAGES = setOf(
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.android.vending",
        "com.android.browser",
        "com.sec.android.app.sbrowser",
        "com.mi.globalbrowser",
        "com.huawei.browser",
        "com.opera.browser",
        "org.mozilla.firefox",
        "com.microsoft.emmx",
        "com.UCMobile",
        "com.qihoo.browser",
        "mark.via",
        "mark.via.gp",
        "com.shifuf.prism"
    )

    private val ALLOWED_BROWSER_PLAYERS = setOf(
        "com.tencent.mtt" // 播霸（QQ浏览器）
    )

    fun queryPlayers(context: Context, url: String): List<PlayerApp> {
        val pm = context.packageManager
        val myPkg = context.packageName
        // dedupe by package only (one entry per app)
        val found = LinkedHashMap<String, PlayerApp>()

        fun consider(ri: ResolveInfo) {
            val ai = ri.activityInfo ?: return
            val pkg = ai.packageName
            if (pkg == myPkg) return
            if (BLOCKED_PACKAGES.contains(pkg) && !ALLOWED_BROWSER_PLAYERS.contains(pkg)) return
            if (found.containsKey(pkg)) return
            val label = ri.loadLabel(pm)?.toString().orEmpty().ifBlank { pkg }
            val allowSpecial = ALLOWED_BROWSER_PLAYERS.contains(pkg) ||
                label.contains("播霸") || label.contains("播放器") ||
                label.contains("视频") || label.contains("图库") || label.contains("媒体") ||
                label.contains("Player", true) || label.contains("Gallery", true)
            if (!allowSpecial) {
                if (isBrowserPackage(pkg, pm, ri)) return
                if (label.contains("浏览器") || label.contains("Browser", true) ||
                    label.contains("Via", true) || label.equals("Chrome", true)
                ) return
            }
            val icon = runCatching { ri.loadIcon(pm) }.getOrNull()
            found[pkg] = PlayerApp(label, pkg, ai.name, icon)
        }

        val flags = resolveFlags()
        buildCandidateIntents(url).forEach { intent ->
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, flags).forEach { consider(it) }
        }

        KNOWN_PLAYER_PACKAGES.forEach { pkg ->
            if (found.containsKey(pkg)) return@forEach
            if (BLOCKED_PACKAGES.contains(pkg) && !ALLOWED_BROWSER_PLAYERS.contains(pkg)) return@forEach
            runCatching {
                val view = buildViewIntent(url).apply { setPackage(pkg) }
                @Suppress("DEPRECATION")
                val list = pm.queryIntentActivities(view, flags)
                if (list.isNotEmpty()) {
                    list.forEach { consider(it) }
                } else if (ALLOWED_BROWSER_PLAYERS.contains(pkg) || pkg.contains("mtt") || pkg.contains("video")) {
                    val launch = pm.getLaunchIntentForPackage(pkg)
                    val act = launch?.component?.className
                    if (act != null) {
                        val label = runCatching {
                            val ai = if (Build.VERSION.SDK_INT >= 33) {
                                pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))
                            } else {
                                @Suppress("DEPRECATION")
                                pm.getApplicationInfo(pkg, 0)
                            }
                            pm.getApplicationLabel(ai)?.toString() ?: pkg
                        }.getOrDefault(pkg)
                        val icon = runCatching { pm.getApplicationIcon(pkg) }.getOrNull()
                        found[pkg] = PlayerApp(label, pkg, act, icon)
                    }
                }
            }
        }

        return found.values.sortedBy { it.label.lowercase() }
    }

    fun play(context: Context, url: String, player: PlayerApp? = null) {
        if (player == null) {
            context.startActivity(Intent.createChooser(buildViewIntent(url), "通过应用播放"))
            return
        }
        val view = buildViewIntent(url).apply {
            component = ComponentName(player.packageName, player.activityName)
            setPackage(player.packageName)
        }
        runCatching { context.startActivity(view) }
            .recoverCatching {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                        setPackage(player.packageName)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                )
            }
            .onFailure {
                context.startActivity(Intent.createChooser(buildViewIntent(url), "通过应用播放"))
            }
    }

    fun playWithChooser(
        context: Context,
        url: String,
        rememberedPackage: String?,
        onRemember: (PlayerApp?) -> Unit
    ) {
        val players = queryPlayers(context, url)
        if (players.isEmpty()) {
            play(context, url, null)
            return
        }
        if (!rememberedPackage.isNullOrBlank()) {
            val remembered = players.find { it.packageName == rememberedPackage }
            if (remembered != null) {
                play(context, url, remembered)
                return
            }
        }
        val labels = players.map { it.label }.toTypedArray()
        AlertDialog.Builder(context)
            .setTitle("外置视频播放器")
            .setSingleChoiceItems(labels, -1) { dialog, which ->
                val chosen = players[which]
                dialog.dismiss()
                AlertDialog.Builder(context)
                    .setTitle(chosen.label)
                    .setMessage("当选择外置播放器播放视频时，使用该应用？")
                    .setPositiveButton("记住") { _, _ ->
                        onRemember(chosen)
                        play(context, url, chosen)
                    }
                    .setNegativeButton("仅此一次") { _, _ ->
                        play(context, url, chosen)
                    }
                    .setNeutralButton("清除记忆") { _, _ ->
                        onRemember(null)
                        play(context, url, chosen)
                    }
                    .show()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun isBrowserPackage(pkg: String, pm: PackageManager, ri: ResolveInfo): Boolean {
        val p = pkg.lowercase()
        if (p.contains("browser") || p.contains("chrome") || p.contains("firefox") ||
            p.contains("webview") || p.contains("via") || p.contains("ucmobile") ||
            p.contains("mtt") || p.contains("sogou.activity")
        ) return true
        // If it handles http browsable MAIN-ish, treat as browser when label says so
        val label = ri.loadLabel(pm)?.toString().orEmpty().lowercase()
        return label.contains("browser") || label.contains("浏览器")
    }

    private fun buildCandidateIntents(url: String): List<Intent> {
        val uri = Uri.parse(url)
        return listOf("video/*", "video/mp4", "application/x-mpegURL").map { mime ->
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
        }
    }

    private fun buildViewIntent(url: String): Intent {
        val mime = when {
            url.contains(".m3u8", true) -> "application/x-mpegURL"
            url.contains(".mpd", true) -> "application/dash+xml"
            url.contains(".webm", true) -> "video/webm"
            url.contains(".mkv", true) -> "video/x-matroska"
            url.contains(".mp4", true) -> "video/mp4"
            else -> "video/*"
        }
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(Uri.parse(url), mime)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
    }

    private fun resolveFlags(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PackageManager.MATCH_DEFAULT_ONLY
        } else PackageManager.MATCH_DEFAULT_ONLY
    }
}
