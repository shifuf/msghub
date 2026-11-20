package com.shifuf.prism.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class HistoryEntry(
    val id: Long,
    val title: String,
    val url: String,
    val visitedAt: Long = System.currentTimeMillis()
)

class HistoryStore(context: Context) {
    private val file = File(context.filesDir, "history.json")
    private val items = ArrayList<HistoryEntry>()
    private var seq = 0L

    init {
        load()
    }

    fun all(): List<HistoryEntry> = items.toList()

    fun search(query: String, limit: Int = 8): List<HistoryEntry> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        return items.asSequence()
            .filter {
                it.title.lowercase().contains(q) ||
                    it.url.lowercase().contains(q)
            }
            .distinctBy { it.url }
            .take(limit)
            .toList()
    }

    fun add(title: String, url: String) {
        if (url.isBlank() || url.startsWith("about:") || url.startsWith("data:")) return
        // de-dupe consecutive same url
        if (items.isNotEmpty() && items.first().url == url) {
            items[0] = items[0].copy(title = title.ifBlank { items[0].title }, visitedAt = System.currentTimeMillis())
            persist()
            return
        }
        items.add(0, HistoryEntry(id = ++seq, title = title.ifBlank { url }, url = url))
        while (items.size > MAX) items.removeAt(items.lastIndex)
        persist()
    }

    fun remove(id: Long) {
        items.removeAll { it.id == id }
        persist()
    }

    fun clear() {
        items.clear()
        persist()
    }

    /** Remove history entries within [sinceMs, untilMs]. */
    fun clearBetween(sinceMs: Long, untilMs: Long = Long.MAX_VALUE): Int {
        val before = items.size
        items.removeAll { it.visitedAt in sinceMs..untilMs }
        val removed = before - items.size
        if (removed > 0) persist()
        return removed
    }

    /** Remove history newer than or equal to sinceMs (e.g. last hour / last 7 days). */
    fun clearSince(sinceMs: Long): Int = clearBetween(sinceMs, Long.MAX_VALUE)

    private fun load() {
        if (!file.exists()) return
        runCatching {
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val id = o.getLong("id")
                seq = maxOf(seq, id)
                items.add(
                    HistoryEntry(
                        id = id,
                        title = o.optString("title"),
                        url = o.getString("url"),
                        visitedAt = o.optLong("visitedAt", System.currentTimeMillis())
                    )
                )
            }
        }
    }

    private fun persist() {
        val arr = JSONArray()
        items.forEach { e ->
            arr.put(
                JSONObject()
                    .put("id", e.id)
                    .put("title", e.title)
                    .put("url", e.url)
                    .put("visitedAt", e.visitedAt)
            )
        }
        file.writeText(arr.toString())
    }

    companion object {
        private const val MAX = 500
    }
}
