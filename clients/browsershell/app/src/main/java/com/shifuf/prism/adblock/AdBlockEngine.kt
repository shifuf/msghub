package com.shifuf.prism.adblock

import android.content.Context
import android.net.Uri
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference

data class FilterSubscription(
    val id: String,
    val name: String,
    val url: String,
    var enabled: Boolean,
    var ruleCount: Int = 0,
    var lastUpdatedAt: Long = 0L,
    var lastError: String = ""
)

/**
 * Multi-subscription adblock engine (Via-like).
 * Default: only a small safe bundled list ON; remote lists optional.
 */
class AdBlockEngine(private val context: Context) {
    private val parser = EasyListParser()
    private val compiled = AtomicReference(emptyParsed())
    private val dir = File(context.filesDir, "filter_lists").also { it.mkdirs() }
    private val indexFile = File(dir, "subscriptions.json")
    private val subs = CopyOnWriteArrayList<FilterSubscription>()

    @Volatile
    var lastSource: String = "none"
        private set

    @Volatile
    var lastUpdatedAt: Long = 0L
        private set

    fun loadDefaults() {
        if (!indexFile.exists()) {
            seedSubscriptions()
        } else {
            loadIndex()
        }
        // One-time: drop old monolithic easylist_cache that broke sites
        File(context.filesDir, "easylist_cache.txt").delete()
        recompile()
    }

    fun subscriptions(): List<FilterSubscription> = subs.toList()

    fun setEnabled(id: String, enabled: Boolean) {
        val i = subs.indexOfFirst { it.id == id }
        if (i < 0) return
        subs[i] = subs[i].copy(enabled = enabled)
        persistIndex()
        recompile()
    }

    fun addCustom(name: String, url: String): FilterSubscription {
        val sub = FilterSubscription(
            id = "custom_${System.currentTimeMillis()}",
            name = name.ifBlank { url },
            url = url,
            enabled = true
        )
        subs.add(sub)
        persistIndex()
        return sub
    }

    fun remove(id: String) {
        if (id.startsWith("builtin_") || id == "safe") return
        subs.removeAll { it.id == id }
        File(dir, "$id.txt").delete()
        persistIndex()
        recompile()
    }

    fun updateAll(): List<FilterSubscription> {
        subs.filter { it.enabled && it.url.startsWith("http") }.forEach { updateOne(it.id) }
        recompile()
        return subscriptions()
    }

    fun updateOne(id: String): Result<FilterSubscription> = runCatching {
        val sub = subs.find { it.id == id } ?: error("not found")
        if (sub.url == "asset://easylist_subset.txt") {
            val text = context.assets.open("easylist_subset.txt").bufferedReader().use { it.readText() }
            File(dir, "$id.txt").writeText(text)
            val count = parser.parse(text.lineSequence()).rawAccepted
            val updated = sub.copy(ruleCount = count, lastUpdatedAt = System.currentTimeMillis(), lastError = "")
            replace(updated)
            persistIndex()
            recompile()
            return@runCatching updated
        }
        val conn = (URL(sub.url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20000
            readTimeout = 60000
            instanceFollowRedirects = true
            setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36"
            )
        }
        try {
            if (conn.responseCode !in 200..299) error("HTTP ${conn.responseCode}")
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            if (text.length < 50) error("list too small")
            // Cap huge lists for memory/safety on phone: keep first N accepted lines when recompiling
            File(dir, "$id.txt").writeText(text)
            val parsed = parser.parse(text.lineSequence())
            val updated = sub.copy(
                ruleCount = parsed.rawAccepted,
                lastUpdatedAt = System.currentTimeMillis(),
                lastError = ""
            )
            replace(updated)
            persistIndex()
            recompile()
            updated
        } finally {
            conn.disconnect()
        }
    }.onFailure { e ->
        val sub = subs.find { it.id == id } ?: return@onFailure
        replace(sub.copy(lastError = e.message.orEmpty()))
        persistIndex()
    }

    fun shouldBlock(url: String, pageUrl: String = ""): Boolean {
        if (!hasAnyEnabled()) return false
        val host = runCatching { Uri.parse(url).host?.lowercase() }.getOrNull() ?: return false
        // Never block same-origin resources of the page being viewed
        val pageHost = runCatching { Uri.parse(pageUrl).host?.lowercase() }.getOrNull().orEmpty()
        if (pageHost.isNotBlank() && (host == pageHost || host.endsWith(".$pageHost") || pageHost.endsWith(".$host"))) {
            // Only allow same-site block for known ad subdomains
            return isKnownAdHost(host)
        }
        // Protect major portals from false positives
        if (isProtectedHost(host) || (pageHost.isNotBlank() && isProtectedHost(pageHost))) {
            return isKnownAdHost(host)
        }
        // Static site assets should almost never be blocked by substring rules
        val path = runCatching { Uri.parse(url).path?.lowercase() }.getOrNull().orEmpty()
        if (path.endsWith(".css") || path.endsWith(".woff") || path.endsWith(".woff2") ||
            path.endsWith(".ttf") || path.endsWith(".otf") || path.endsWith(".map")
        ) return false
        return parser.matches(url, compiled.get())
    }

    fun ruleCount(): Int {
        val p = compiled.get()
        return p.domainBlocks.size + p.pathContains.size + p.startWith.size +
            p.regexBlocks.size + p.elementHiding.size
    }

    fun elementHidingCss(): String = elementHidingCssSafe()

    fun elementHidingCssSafe(): String {
        // Keep element hiding very conservative — broad selectors break layouts.
        val selectors = compiled.get().elementHiding
            .filter { isSafeHideSelector(it) }
            .take(80)
        if (selectors.isEmpty()) return ""
        return selectors.joinToString(",\n") { it } + "\n{display:none !important;}"
    }

    /** Legacy API used by menus */
    fun updateFromUrl(url: String): Result<Int> = runCatching {
        val existing = subs.find { it.url == url }
        val id = existing?.id ?: addCustom("Custom", url).id
        setEnabled(id, true)
        updateOne(id).getOrThrow().ruleCount
    }

    fun reloadBundled() {
        updateOne("safe")
        recompile()
    }

    private fun recompile() {
        val domainBlocks = HashSet<String>()
        val pathContains = ArrayList<String>()
        val startWith = ArrayList<String>()
        val regexBlocks = ArrayList<java.util.regex.Pattern>()
        val domainExceptions = HashSet<String>()
        val pathExceptions = ArrayList<String>()
        val elementHiding = ArrayList<String>()
        var accepted = 0
        var skipped = 0
        val sources = ArrayList<String>()

        subs.filter { it.enabled }.forEach { sub ->
            val text = loadText(sub) ?: return@forEach
            val p = parser.parse(text.lineSequence())
            // Soft cap + filter short needles that wreck first-party pages
            domainBlocks.addAll(p.domainBlocks)
            pathContains.addAll(p.pathContains.filter { it.length >= 8 }.take(2500))
            startWith.addAll(p.startWith.filter { it.length >= 12 }.take(1000))
            regexBlocks.addAll(p.regexBlocks.filter { it.pattern().length >= 10 }.take(200))
            domainExceptions.addAll(p.domainExceptions)
            pathExceptions.addAll(p.pathExceptions.take(2000))
            elementHiding.addAll(p.elementHiding.take(200))
            accepted += p.rawAccepted
            skipped += p.rawSkipped
            sources.add(sub.name)
            if (sub.ruleCount == 0 && p.rawAccepted > 0) {
                replace(sub.copy(ruleCount = p.rawAccepted))
            }
        }

        compiled.set(
            EasyListParser.ParsedList(
                domainBlocks = domainBlocks,
                pathContains = pathContains.distinct(),
                startWith = startWith.distinct(),
                regexBlocks = regexBlocks,
                domainExceptions = domainExceptions,
                pathExceptions = pathExceptions.distinct(),
                elementHiding = elementHiding.distinct(),
                rawAccepted = accepted,
                rawSkipped = skipped
            )
        )
        lastSource = sources.joinToString(", ").ifBlank { "none" }
        lastUpdatedAt = System.currentTimeMillis()
        persistIndex()
        Log.i(TAG, "recompiled rules=$accepted domains=${domainBlocks.size} source=$lastSource")
    }

    private fun loadText(sub: FilterSubscription): String? {
        if (sub.url == "asset://easylist_subset.txt") {
            return runCatching {
                context.assets.open("easylist_subset.txt").bufferedReader().use { it.readText() }
            }.getOrNull()
        }
        val f = File(dir, "${sub.id}.txt")
        if (f.exists() && f.length() > 20) return f.readText()
        // try fetch once if enabled remote
        if (sub.enabled && sub.url.startsWith("http")) {
            runCatching { updateOne(sub.id) }
            if (f.exists()) return f.readText()
        }
        return null
    }

    private fun seedSubscriptions() {
        subs.clear()
        // Safe default ON
        val safeText = context.assets.open("easylist_subset.txt").bufferedReader().use { it.readText() }
        File(dir, "safe.txt").writeText(safeText)
        val safeCount = parser.parse(safeText.lineSequence()).rawAccepted
        subs.add(
            FilterSubscription(
                id = "safe",
                name = "棱镜 Safe",
                url = "asset://easylist_subset.txt",
                enabled = true,
                ruleCount = safeCount,
                lastUpdatedAt = System.currentTimeMillis()
            )
        )
        // Remote lists OFF by default (user enables like Via)
        DEFAULT_REMOTE.forEach { (id, name, url) ->
            subs.add(
                FilterSubscription(
                    id = id,
                    name = name,
                    url = url,
                    enabled = false
                )
            )
        }
        persistIndex()
    }

    private fun loadIndex() {
        runCatching {
            val arr = JSONArray(indexFile.readText())
            subs.clear()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                subs.add(
                    FilterSubscription(
                        id = o.getString("id"),
                        name = o.getString("name"),
                        url = o.getString("url"),
                        enabled = o.optBoolean("enabled", false),
                        ruleCount = o.optInt("ruleCount", 0),
                        lastUpdatedAt = o.optLong("lastUpdatedAt", 0L),
                        lastError = o.optString("lastError")
                    )
                )
            }
            if (subs.none { it.id == "safe" }) {
                // migrate: ensure safe list exists and enabled
                seedSubscriptions()
            }
        }.onFailure { seedSubscriptions() }
    }

    private fun persistIndex() {
        val arr = JSONArray()
        subs.forEach { s ->
            arr.put(
                JSONObject()
                    .put("id", s.id)
                    .put("name", s.name)
                    .put("url", s.url)
                    .put("enabled", s.enabled)
                    .put("ruleCount", s.ruleCount)
                    .put("lastUpdatedAt", s.lastUpdatedAt)
                    .put("lastError", s.lastError)
            )
        }
        indexFile.writeText(arr.toString(2))
    }

    private fun replace(sub: FilterSubscription) {
        val i = subs.indexOfFirst { it.id == sub.id }
        if (i >= 0) subs[i] = sub
    }

    private fun hasAnyEnabled() = subs.any { it.enabled }

    private fun isSafeHideSelector(sel: String): Boolean {
        val s = sel.trim().lowercase()
        if (s.isEmpty() || s.length < 8) return false
        // Reject generic / substring class matches that hide real UI
        if (s == ".ad" || s == ".ads" || s == ".advert" || s == ".banner" || s == ".sponsor" || s == ".promo") return false
        if (s.contains("[class*=\"ad\"") || s.contains("[id*=\"ad\"") || s.contains("[class^=\"ad\"") || s.contains("[id^=\"ad\"")) return false
        if (s.contains("body") || s.contains("html") || s == "div" || s == "section" || s == "main") return false
        // Allow only high-confidence ad network / slot selectors
        return s.contains("adsbygoogle") || s.contains("google_ads") || s.contains("div-gpt-ad") ||
            s.contains("doubleclick") || s.contains("googlesyndication") || s.contains("taboola") ||
            s.contains("outbrain") || s.contains("ad-slot") || s.contains("data-ad-slot") ||
            s.contains("adsbox") || s.contains("advertisement") || s.contains("dfp-ad")
    }

    private fun isProtectedHost(host: String): Boolean {
        val protected = listOf(
            "baidu.com", "bdstatic.com", "bdimg.com", "qq.com", "gtimg.com",
            "sogou.com", "so.com", "360.cn", "bing.com", "google.com", "gstatic.com",
            "bilibili.com", "hdslb.com", "zhihu.com", "zhimg.com",
            "douyin.com", "tiktok.com", "bytedance.com", "byteimg.com", "ibytedtos.com",
            "taobao.com", "tmall.com", "alicdn.com", "jd.com", "weibo.com", "sinaimg.cn",
            "github.com", "githubusercontent.com", "microsoft.com", "apple.com",
            "youtube.com", "ytimg.com", "googlevideo.com"
        )
        return protected.any { host == it || host.endsWith(".$it") }
    }

    private fun isKnownAdHost(host: String): Boolean {
        val ads = listOf(
            "doubleclick.net", "googlesyndication.com", "googleadservices.com",
            "googletagservices.com", "google-analytics.com", "adnxs.com", "adsrvr.org",
            "scorecardresearch.com", "moatads.com", "amazon-adsystem.com", "taboola.com",
            "outbrain.com", "criteo.com", "pubmatic.com", "hm.baidu.com", "pos.baidu.com",
            "cpro.baidu.com"
        )
        return ads.any { host == it || host.endsWith(".$it") }
    }

    companion object {
        private const val TAG = "AdBlockEngine"
        private val DEFAULT_REMOTE = listOf(
            Triple("easylist", "EasyList", "https://easylist.to/easylist/easylist.txt"),
            Triple("easylist_china", "EasyList China", "https://easylist-downloads.adblockplus.org/easylistchina.txt"),
            Triple("cjx", "CJX's Annoyance List", "https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjx-annoyance.txt"),
            Triple("easyprivacy", "EasyPrivacy", "https://easylist.to/easylist/easyprivacy.txt"),
            Triple("awrl", "Adblock Warning Removal List", "https://easylist-downloads.adblockplus.org/antiadblockfilters.txt")
        )

        private fun emptyParsed() = EasyListParser.ParsedList(
            domainBlocks = emptySet(),
            pathContains = emptyList(),
            startWith = emptyList(),
            regexBlocks = emptyList(),
            domainExceptions = emptySet(),
            pathExceptions = emptyList(),
            elementHiding = emptyList(),
            rawAccepted = 0,
            rawSkipped = 0
        )
    }
}
