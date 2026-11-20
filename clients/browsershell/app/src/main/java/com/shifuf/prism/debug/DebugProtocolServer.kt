package com.shifuf.prism.debug

import android.util.Log
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.BuildConfig
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArraySet

/**
 * PC ↔ Android debug protocol (v1).
 *
 * Wire: WebSocket text frames, JSON.
 * Request:  { "id":"1", "method":"network.getEntries", "params":{} }
 * Response: { "id":"1", "ok":true, "result":{...} }
 * Event:    { "event":"network.request", "params":{...} }
 *
 * Methods reserved for PC console:
 * - ping
 * - browser.navigate {url}
 * - browser.getState
 * - network.getEntries
 * - network.clear
 * - sniffer.getEntries
 * - sniffer.clear
 * - scripts.list
 * - scripts.setEnabled {id, enabled}
 * - adblock.getState / adblock.setEnabled {enabled}
 */
class DebugProtocolServer(private val app: BrowserApp) {
    private var server: ServerImpl? = null
    @Volatile
    private var navigateHandler: ((String) -> Unit)? = null
    @Volatile
    private var stateProvider: (() -> Map<String, Any?>)? = null

    val port: Int get() = BuildConfig.DEBUG_PORT
    val isRunning: Boolean get() = server != null

    fun setNavigateHandler(handler: ((String) -> Unit)?) {
        navigateHandler = handler
    }

    fun setStateProvider(provider: (() -> Map<String, Any?>)?) {
        stateProvider = provider
    }

    @Synchronized
    fun start() {
        if (server != null) return
        val s = ServerImpl(InetSocketAddress(port))
        s.isReuseAddr = true
        s.start()
        server = s
        Log.i(TAG, "Debug protocol listening on ws://0.0.0.0:$port")
    }

    @Synchronized
    fun stop() {
        runCatching { server?.stop(500) }
        server = null
        Log.i(TAG, "Debug protocol stopped")
    }

    fun broadcastEvent(event: String, params: Map<String, Any?>) {
        val s = server ?: return
        val payload = JSONObject()
            .put("event", event)
            .put("params", JSONObject(params))
            .toString()
        s.broadcastSafe(payload)
    }

    private fun handleMessage(conn: WebSocket, message: String) {
        val req = runCatching { JSONObject(message) }.getOrNull()
        if (req == null) {
            conn.send(error(null, "invalid_json", "Body must be JSON object"))
            return
        }
        val id = req.optString("id", null)
        val method = req.optString("method", "")
        val params = req.optJSONObject("params") ?: JSONObject()
        try {
            val result = dispatch(method, params)
            conn.send(
                JSONObject()
                    .put("id", id)
                    .put("ok", true)
                    .put("result", result)
                    .toString()
            )
        } catch (e: Exception) {
            conn.send(error(id, "method_error", e.message ?: "error"))
        }
    }

    private fun dispatch(method: String, params: JSONObject): JSONObject {
        return when (method) {
            "ping" -> JSONObject().put("pong", true).put("ts", System.currentTimeMillis())
            "browser.navigate" -> {
                val url = params.getString("url")
                navigateHandler?.invoke(url)
                    ?: error("navigate handler not attached (open browser UI first)")
                JSONObject().put("accepted", true).put("url", url)
            }
            "browser.getState" -> {
                val state = stateProvider?.invoke() ?: mapOf("attached" to false)
                JSONObject(state)
            }
            "network.getEntries" -> {
                val arr = JSONArray()
                app.networkLog.snapshot().forEach { e ->
                    arr.put(
                        JSONObject()
                            .put("id", e.id)
                            .put("url", e.url)
                            .put("method", e.method)
                            .put("type", e.resourceType)
                            .put("pageUrl", e.pageUrl)
                            .put("blocked", e.blocked)
                            .put("ts", e.timestamp)
                    )
                }
                JSONObject().put("entries", arr)
            }
            "network.clear" -> {
                app.networkLog.clear()
                JSONObject().put("cleared", true)
            }
            "sniffer.getEntries" -> {
                val arr = JSONArray()
                app.sniffer.snapshot().forEach { e ->
                    arr.put(
                        JSONObject()
                            .put("url", e.url)
                            .put("mimeHint", e.mimeHint)
                            .put("pageUrl", e.pageUrl)
                            .put("ts", e.timestamp)
                    )
                }
                JSONObject().put("entries", arr)
            }
            "sniffer.clear" -> {
                app.sniffer.clear()
                JSONObject().put("cleared", true)
            }
            "scripts.list" -> {
                val arr = JSONArray()
                app.scriptStore.all().forEach { s ->
                    arr.put(
                        JSONObject()
                            .put("id", s.id)
                            .put("name", s.name)
                            .put("version", s.version)
                            .put("enabled", s.enabled)
                            .put("matches", JSONArray(s.matches))
                            .put("description", s.description)
                    )
                }
                JSONObject().put("scripts", arr)
            }
            "scripts.setEnabled" -> {
                val id = params.getString("id")
                val enabled = params.getBoolean("enabled")
                app.scriptStore.setEnabled(id, enabled)
                JSONObject().put("id", id).put("enabled", enabled)
            }
            "adblock.getState" -> JSONObject()
                .put("enabled", app.prefs.adBlockEnabled)
                .put("ruleCount", app.adBlock.ruleCount())
                .put("source", app.adBlock.lastSource)
                .put("updatedAt", app.adBlock.lastUpdatedAt)
            "adblock.setEnabled" -> {
                val enabled = params.getBoolean("enabled")
                app.prefs.adBlockEnabled = enabled
                JSONObject().put("enabled", enabled)
            }
            "adblock.update" -> {
                val url = params.optString("url", app.prefs.adBlockListUrl)
                val count = app.adBlock.updateFromUrl(url).getOrThrow()
                JSONObject().put("ruleCount", count).put("source", app.adBlock.lastSource)
            }
            "scripts.installFromUrl" -> {
                val url = params.getString("url")
                val script = app.scriptStore.installFromUrl(url).getOrThrow()
                JSONObject()
                    .put("id", script.id)
                    .put("name", script.name)
                    .put("version", script.version)
            }
            "bookmarks.list" -> {
                val arr = JSONArray()
                app.bookmarks.all().forEach { b ->
                    arr.put(
                        JSONObject()
                            .put("id", b.id)
                            .put("title", b.title)
                            .put("url", b.url)
                            .put("folderId", b.folderId)
                            .put("createdAt", b.createdAt)
                    )
                }
                val folders = JSONArray()
                app.bookmarks.allFolders().forEach { f ->
                    folders.put(
                        JSONObject()
                            .put("id", f.id)
                            .put("name", f.name)
                            .put("parentId", f.parentId)
                            .put("createdAt", f.createdAt)
                    )
                }
                JSONObject().put("bookmarks", arr).put("folders", folders)
            }
            "bookmarks.addFolder" -> {
                val name = params.getString("name")
                val parentId = params.optString("parentId", "root")
                val f = app.bookmarks.addFolder(name, parentId)
                JSONObject().put("id", f.id).put("name", f.name).put("parentId", f.parentId)
            }
            "session.get" -> {
                JSONObject()
                    .put("lastUrl", app.prefs.lastUrl)
                    .put("note", "full tab session is restored by MainActivity from tab_session.json")
            }
            "history.list" -> {
                val arr = JSONArray()
                app.historyStore.all().forEach { e ->
                    arr.put(
                        JSONObject()
                            .put("id", e.id)
                            .put("title", e.title)
                            .put("url", e.url)
                            .put("visitedAt", e.visitedAt)
                    )
                }
                JSONObject().put("history", arr)
            }
            else -> error("unknown method: $method")
        }
    }

    private fun error(id: String?, code: String, message: String): String {
        return JSONObject()
            .put("id", id)
            .put("ok", false)
            .put("error", JSONObject().put("code", code).put("message", message))
            .toString()
    }

    private inner class ServerImpl(address: InetSocketAddress) : WebSocketServer(address) {
        private val clients = CopyOnWriteArraySet<WebSocket>()

        override fun onOpen(conn: WebSocket, handshake: ClientHandshake?) {
            clients.add(conn)
            conn.send(
                JSONObject()
                    .put("event", "session.welcome")
                    .put(
                        "params",
                        JSONObject()
                            .put("protocol", PROTOCOL_VERSION)
                            .put("app", "棱镜")
                            .put("port", port)
                    )
                    .toString()
            )
            Log.i(TAG, "client connected: ${conn.remoteSocketAddress}")
        }

        override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
            clients.remove(conn)
        }

        override fun onMessage(conn: WebSocket, message: String) {
            handleMessage(conn, message)
        }

        override fun onError(conn: WebSocket?, ex: Exception?) {
            Log.w(TAG, "ws error: ${ex?.message}")
        }

        override fun onStart() {
            Log.i(TAG, "websocket server started")
        }

        fun broadcastSafe(text: String) {
            clients.forEach { c ->
                runCatching { if (c.isOpen) c.send(text) }
            }
        }
    }

    companion object {
        private const val TAG = "DebugProtocol"
        const val PROTOCOL_VERSION = "1.0"
    }
}
