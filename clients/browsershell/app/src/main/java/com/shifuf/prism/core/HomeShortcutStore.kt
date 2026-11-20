package com.shifuf.prism.core

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class HomeShortcut(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val url: String,
    val iconUrl: String = "",
    val order: Int = 0
)

class HomeShortcutStore(context: Context) {
    private val file = File(context.filesDir, "home_shortcuts.json")
    private val items = linkedMapOf<String, HomeShortcut>()

    init {
        load()
        if (!file.exists()) seedDefaults()
    }

    fun all(): List<HomeShortcut> = items.values.sortedBy { it.order }

    fun get(id: String): HomeShortcut? = items[id]

    fun add(title: String, url: String, iconUrl: String = ""): HomeShortcut {
        val cleanUrl = normalizeUrl(url)
        val existing = items.values.find { it.url.equals(cleanUrl, true) }
        if (existing != null) {
            val updated = existing.copy(
                title = title.ifBlank { existing.title },
                iconUrl = iconUrl.ifBlank { existing.iconUrl.ifBlank { faviconOf(cleanUrl) } }
            )
            items[updated.id] = updated
            persist()
            return updated
        }
        val s = HomeShortcut(
            title = title.ifBlank { hostLabel(cleanUrl) },
            url = cleanUrl,
            iconUrl = iconUrl.ifBlank { faviconOf(cleanUrl) },
            order = (items.values.maxOfOrNull { it.order } ?: -1) + 1
        )
        items[s.id] = s
        persist()
        return s
    }

    fun update(id: String, title: String, url: String, iconUrl: String? = null): HomeShortcut? {
        val old = items[id] ?: return null
        val cleanUrl = normalizeUrl(url)
        val updated = old.copy(
            title = title.ifBlank { hostLabel(cleanUrl) },
            url = cleanUrl,
            iconUrl = when {
                iconUrl != null -> iconUrl
                !old.url.equals(cleanUrl, true) -> faviconOf(cleanUrl)
                else -> old.iconUrl.ifBlank { faviconOf(cleanUrl) }
            }
        )
        items[id] = updated
        persist()
        return updated
    }

    fun remove(id: String) {
        if (items.remove(id) != null) persist()
    }

    fun move(fromId: String, toId: String) {
        if (fromId == toId) return
        val ordered = all().toMutableList()
        val fromIdx = ordered.indexOfFirst { it.id == fromId }
        val toIdx = ordered.indexOfFirst { it.id == toId }
        if (fromIdx < 0 || toIdx < 0) return
        val item = ordered.removeAt(fromIdx)
        ordered.add(toIdx, item)
        ordered.forEachIndexed { idx, s ->
            items[s.id] = s.copy(order = idx)
        }
        persist()
    }

    fun reorder(ids: List<String>) {
        val known = ids.filter { items.containsKey(it) }
        known.forEachIndexed { idx, id ->
            val old = items[id] ?: return@forEachIndexed
            items[id] = old.copy(order = idx)
        }
        // append any missing at end
        items.values.filter { it.id !in known }.sortedBy { it.order }.forEachIndexed { idx, s ->
            items[s.id] = s.copy(order = known.size + idx)
        }
        persist()
    }

    fun clear() {
        items.clear()
        persist()
    }

    private fun seedDefaults() {
        listOf(
            "百度" to "https://www.baidu.com",
            "哔哩哔哩" to "https://www.bilibili.com",
            "知乎" to "https://www.zhihu.com",
            "GitHub" to "https://github.com"
        ).forEachIndexed { idx, (title, url) ->
            val s = HomeShortcut(
                title = title,
                url = url,
                iconUrl = faviconOf(url),
                order = idx
            )
            items[s.id] = s
        }
        persist()
    }

    private fun load() {
        if (!file.exists()) return
        runCatching {
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val s = HomeShortcut(
                    id = o.optString("id", UUID.randomUUID().toString()),
                    title = o.optString("title"),
                    url = o.optString("url"),
                    iconUrl = o.optString("iconUrl"),
                    order = o.optInt("order", i)
                )
                if (s.url.isNotBlank()) items[s.id] = s
            }
        }
    }

    private fun persist() {
        val arr = JSONArray()
        all().forEach { s ->
            arr.put(
                JSONObject()
                    .put("id", s.id)
                    .put("title", s.title)
                    .put("url", s.url)
                    .put("iconUrl", s.iconUrl)
                    .put("order", s.order)
            )
        }
        file.writeText(arr.toString())
    }

    companion object {
        fun normalizeUrl(raw: String): String {
            val t = raw.trim()
            if (t.isBlank()) return t
            if (t.startsWith("http://", true) || t.startsWith("https://", true)) return t
            return "https://$t"
        }

        fun hostLabel(url: String): String {
            val host = runCatching { Uri.parse(url).host }.getOrNull().orEmpty()
            return host.removePrefix("www.").ifBlank { url }
        }

        fun faviconOf(url: String): String {
            val host = runCatching { Uri.parse(url).host }.getOrNull().orEmpty()
            if (host.isBlank()) return ""
            return "https://www.google.com/s2/favicons?domain=$host&sz=128"
        }
    }
}
