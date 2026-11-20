package com.shifuf.prism.script

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class UserscriptStore(context: Context) {
    private val dir = File(context.filesDir, "userscripts").also { it.mkdirs() }
    private val indexFile = File(dir, "index.json")
    private val subsFile = File(dir, "subscriptions.json")
    private val scripts = linkedMapOf<String, Userscript>()
    private val subscriptions = linkedMapOf<String, ScriptSubscription>()

    data class ScriptSubscription(
        val id: String = UUID.randomUUID().toString(),
        val url: String,
        val name: String = "",
        val lastScriptId: String = "",
        val lastCheckedAt: Long = 0L,
        val lastError: String = ""
    )

    init {
        load()
        loadSubs()
    }

    fun all(): List<Userscript> = scripts.values.toList()
    fun subscriptions(): List<ScriptSubscription> = subscriptions.values.toList()

    fun enabledFor(url: String): List<Userscript> =
        scripts.values.filter { it.enabled && UserscriptParser.matchesUrl(it, url) }

    fun addOrUpdate(source: String, fromUrl: String = ""): Userscript {
        val parsed = UserscriptParser.parse(source)
        val withUrl = if (fromUrl.isNotBlank()) {
            parsed.copy(
                updateUrl = parsed.updateUrl.ifBlank { fromUrl },
                downloadUrl = parsed.downloadUrl.ifBlank { fromUrl }
            )
        } else parsed
        val existing = scripts.values.find { it.name == withUrl.name && it.namespace == withUrl.namespace }
        val id = existing?.id ?: withUrl.id.ifBlank { UUID.randomUUID().toString() }
        val script = withUrl.copy(id = id, enabled = existing?.enabled ?: true)
        // sanitize filename
        val safeId = id.replace(Regex("""[^\w.\-]+"""), "_")
        File(dir, "$safeId.user.js").writeText(script.source)
        // if id had invalid chars, keep map key as original id but file safe
        scripts[id] = script
        // also write by id hash if needed
        if (safeId != id) {
            File(dir, "${id.hashCode()}.user.js").writeText(script.source)
        }
        persistIndex()
        return script
    }

    fun setEnabled(id: String, enabled: Boolean) {
        val s = scripts[id] ?: return
        scripts[id] = s.copy(enabled = enabled)
        persistIndex()
    }

    fun remove(id: String) {
        scripts.remove(id)
        val safeId = id.replace(Regex("""[^\w.\-]+"""), "_")
        File(dir, "$safeId.user.js").delete()
        File(dir, "${id.hashCode()}.user.js").delete()
        persistIndex()
    }

    fun installFromUrl(url: String): Result<Userscript> = runCatching {
        val text = httpGet(url)
        if (!text.contains("==UserScript==", ignoreCase = true)) {
            error("不是有效的 userscript（缺少 ==UserScript== 头）")
        }
        val script = addOrUpdate(text, fromUrl = url)
        // auto subscription entry
        val subId = subscriptions.values.find { it.url == url }?.id ?: UUID.randomUUID().toString()
        subscriptions[subId] = ScriptSubscription(
            id = subId,
            url = url,
            name = script.name,
            lastScriptId = script.id,
            lastCheckedAt = System.currentTimeMillis()
        )
        persistSubs()
        script
    }

    fun addSubscription(url: String): ScriptSubscription {
        val existing = subscriptions.values.find { it.url == url }
        if (existing != null) return existing
        val sub = ScriptSubscription(url = url)
        subscriptions[sub.id] = sub
        persistSubs()
        return sub
    }

    fun removeSubscription(id: String) {
        subscriptions.remove(id)
        persistSubs()
    }

    fun refreshSubscription(id: String): Result<Userscript> = runCatching {
        val sub = subscriptions[id] ?: error("subscription not found")
        val script = installFromUrl(sub.url).getOrThrow()
        subscriptions[id] = sub.copy(
            name = script.name,
            lastScriptId = script.id,
            lastCheckedAt = System.currentTimeMillis(),
            lastError = ""
        )
        persistSubs()
        script
    }.onFailure { e ->
        val sub = subscriptions[id] ?: return@onFailure
        subscriptions[id] = sub.copy(lastError = e.message.orEmpty(), lastCheckedAt = System.currentTimeMillis())
        persistSubs()
    }

    fun refreshAllSubscriptions(): List<Result<Userscript>> {
        return subscriptions.keys.map { refreshSubscription(it) }
    }

    fun ensureSeedScripts() {
        if (scripts.isNotEmpty()) return
        addOrUpdate(SEED_HELLO)
        addOrUpdate(SEED_DARK)
    }

    private fun httpGet(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 30000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "Prism/2.0")
        }
        try {
            if (conn.responseCode !in 200..299) error("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun load() {
        if (!indexFile.exists()) return
        val arr = JSONArray(indexFile.readText())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val id = o.getString("id")
            val safeId = id.replace(Regex("""[^\w.\-]+"""), "_")
            val file = listOf(
                File(dir, "$safeId.user.js"),
                File(dir, "$id.user.js"),
                File(dir, "${id.hashCode()}.user.js")
            ).firstOrNull { it.exists() } ?: continue
            val source = file.readText()
            val parsed = UserscriptParser.parse(source, id).copy(
                id = id,
                enabled = o.optBoolean("enabled", true),
                updateUrl = o.optString("updateUrl"),
                downloadUrl = o.optString("downloadUrl")
            )
            scripts[id] = parsed
        }
    }

    private fun persistIndex() {
        val arr = JSONArray()
        scripts.values.forEach { s ->
            arr.put(
                JSONObject()
                    .put("id", s.id)
                    .put("name", s.name)
                    .put("enabled", s.enabled)
                    .put("updateUrl", s.updateUrl)
                    .put("downloadUrl", s.downloadUrl)
            )
        }
        indexFile.writeText(arr.toString(2))
    }

    private fun loadSubs() {
        if (!subsFile.exists()) return
        runCatching {
            val arr = JSONArray(subsFile.readText())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val s = ScriptSubscription(
                    id = o.getString("id"),
                    url = o.getString("url"),
                    name = o.optString("name"),
                    lastScriptId = o.optString("lastScriptId"),
                    lastCheckedAt = o.optLong("lastCheckedAt"),
                    lastError = o.optString("lastError")
                )
                subscriptions[s.id] = s
            }
        }
    }

    private fun persistSubs() {
        val arr = JSONArray()
        subscriptions.values.forEach { s ->
            arr.put(
                JSONObject()
                    .put("id", s.id)
                    .put("url", s.url)
                    .put("name", s.name)
                    .put("lastScriptId", s.lastScriptId)
                    .put("lastCheckedAt", s.lastCheckedAt)
                    .put("lastError", s.lastError)
            )
        }
        subsFile.writeText(arr.toString(2))
    }

    companion object {
        private val SEED_HELLO = """
            // ==UserScript==
            // @name         棱镜 Hello
            // @namespace    shell.demo
            // @version      1.1
            // @description  演示脚本：仅写控制台日志（不改页面布局）
            // @match        *://example.com/*
            // @grant        none
            // @run-at       document-end
            // ==/UserScript==
            (function () {
              console.log('[棱镜] hello userscript', location.href);
            })();
        """.trimIndent()

        private val SEED_DARK = """
            // ==UserScript==
            // @name         Soft Dark Overlay
            // @namespace    shell.demo
            // @version      1.0
            // @description  示例：给页面加一层轻微暗色（默认禁用演示可开）
            // @match        *://example.com/*
            // @grant        GM_addStyle
            // @run-at       document-start
            // ==/UserScript==
            (function () {
              if (typeof GM_addStyle === 'function') {
                GM_addStyle('html{filter:invert(0.04) hue-rotate(180deg);} img,video{filter:invert(1) hue-rotate(180deg);}');
              }
            })();
        """.trimIndent()
    }
}
