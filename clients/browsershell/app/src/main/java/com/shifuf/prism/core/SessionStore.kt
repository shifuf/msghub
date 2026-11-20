package com.shifuf.prism.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
// PreferenceStore referenced for HOME_URL

data class SavedTab(
    val title: String,
    val url: String
)

data class SessionSnapshot(
    val tabs: List<SavedTab>,
    val activeIndex: Int
)

class SessionStore(context: Context) {
    private val file = File(context.filesDir, "tab_session.json")

    fun save(tabs: List<SavedTab>, activeIndex: Int) {
        // private mode: do not persist
        if (runCatching { com.shifuf.prism.BrowserApp.instance.prefs.privateMode }.getOrDefault(false)) {
            file.delete()
            return
        }
        if (tabs.isEmpty()) {
            file.delete()
            return
        }
        val cleaned = tabs.map {
            val url = if (it.url.startsWith("data:")) PreferenceStore.HOME_URL else it.url
            val title = if (url == PreferenceStore.HOME_URL) "主页" else it.title
            SavedTab(title = title, url = url)
        }
        val arr = JSONArray()
        cleaned.forEach { t ->
            arr.put(
                JSONObject()
                    .put("title", t.title)
                    .put("url", t.url)
            )
        }
        val root = JSONObject()
            .put("version", 1)
            .put("activeIndex", activeIndex.coerceIn(0, cleaned.lastIndex))
            .put("tabs", arr)
            .put("savedAt", System.currentTimeMillis())
        file.writeText(root.toString())
    }

    fun load(): SessionSnapshot? {
        if (runCatching { com.shifuf.prism.BrowserApp.instance.prefs.privateMode }.getOrDefault(false)) {
            return null
        }
        if (!file.exists()) return null
        return runCatching {
            val root = JSONObject(file.readText())
            val arr = root.getJSONArray("tabs")
            val tabs = ArrayList<SavedTab>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                var url = o.optString("url")
                if (url.startsWith("data:")) url = PreferenceStore.HOME_URL
                if (url.isBlank()) continue
                val title = when {
                    url == PreferenceStore.HOME_URL -> "主页"
                    else -> o.optString("title").ifBlank { url }
                }
                if (title.startsWith("data:")) continue
                tabs.add(SavedTab(title = title, url = url))
            }
            if (tabs.isEmpty()) return null
            val active = root.optInt("activeIndex", 0).coerceIn(0, tabs.lastIndex)
            SessionSnapshot(tabs, active)
        }.getOrNull()
    }

    fun clear() {
        file.delete()
    }
}
