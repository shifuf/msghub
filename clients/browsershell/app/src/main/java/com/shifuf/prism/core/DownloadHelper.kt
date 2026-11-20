package com.shifuf.prism.core

import android.content.Context
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

private val downloadHttp = DownloadHttp(lookupCookie = { CookieManager.getInstance().getCookie(it) })

data class DownloadItem(
    val id: Long,
    val url: String,
    val fileName: String,
    val mimeType: String,
    val pageUrl: String,
    val createdAt: Long,
    val status: Int = STATUS_PENDING,
    val bytesDownloaded: Long = 0,
    val totalBytes: Long = -1,
    val localUri: String = "",
    val backend: String = "builtin",
    val error: String = "",
    val userAgent: String = "",
    val saveDir: String = "",
    val restartOnResume: Boolean = false
) {
    val progress: Int
        get() = if (totalBytes > 0) ((bytesDownloaded * 100) / totalBytes).toInt().coerceIn(0, 100) else -1

    val statusLabel: String
        get() = when (status) {
            STATUS_PENDING -> "等待中"
            STATUS_RUNNING -> "下载中"
            STATUS_PAUSED -> "已暂停"
            STATUS_SUCCESSFUL -> "已完成"
            STATUS_FAILED -> if (error.isBlank()) "失败" else "失败"
            else -> "未知"
        }

    companion object {
        const val STATUS_PENDING = 1
        const val STATUS_RUNNING = 2
        const val STATUS_PAUSED = 4
        const val STATUS_SUCCESSFUL = 8
        const val STATUS_FAILED = 16
    }
}

class DownloadRepository(private val context: Context) {
    private val metaFile = File(context.filesDir, "downloads_meta_v4.json")
    private val defaultDir = File(context.getExternalFilesDir(null) ?: context.filesDir, "downloads").also { it.mkdirs() }
    private val items = ConcurrentHashMap<Long, DownloadItem>()
    private val futures = ConcurrentHashMap<Long, Future<*>>()
    private val pauseFlags = ConcurrentHashMap<Long, AtomicBoolean>()
    private val pool = Executors.newFixedThreadPool(3)
    private val seq = AtomicLong(System.currentTimeMillis() % 100000)
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    @Volatile private var lastPersistAt = 0L
    @Volatile private var lastNotifyAt = 0L

    init {
        // migrate old meta if present
        val old = File(context.filesDir, "downloads_meta_v3.json")
        if (!metaFile.exists() && old.exists()) {
            runCatching { old.copyTo(metaFile, overwrite = false) }
        }
        loadMeta()
        items.values.filter { it.backend == "builtin" && it.status == DownloadItem.STATUS_RUNNING }.forEach {
            items[it.id] = it.copy(status = DownloadItem.STATUS_PAUSED)
        }
        persistMeta()
    }

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    private fun notifyChanged(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastNotifyAt < 200) return
        lastNotifyAt = now
        main.post {
            listeners.forEach { runCatching { it.invoke() } }
        }
    }

    fun downloadDir(): File {
        val custom = runCatching {
            com.shifuf.prism.BrowserApp.instance.prefs.downloadDirPath
        }.getOrDefault("")
        if (custom.isNotBlank() && !custom.startsWith("content:")) {
            val f = File(custom)
            if ((f.isDirectory || f.mkdirs()) && f.canWrite()) return f
        }
        return defaultDir
    }

    fun enqueue(
        url: String,
        userAgent: String? = null,
        contentDisposition: String? = null,
        mimeType: String? = null,
        pageUrl: String? = null,
        backend: DownloadBackend = DownloadBackend.BUILTIN,
        preferredName: String? = null
    ): Long {
        val guessed = preferredName?.takeIf { it.isNotBlank() }
            ?: URLUtil.guessFileName(url, contentDisposition, mimeType)
        return when (DownloadHelper.resolveBackend(url, pageUrl, backend)) {
            DownloadBackend.SYSTEM -> enqueueSystem(url, guessed, userAgent, mimeType, pageUrl)
            DownloadBackend.BUILTIN -> enqueueBuiltin(
                url, guessed, userAgent, mimeType, pageUrl,
                restartOnResume = backend == DownloadBackend.SYSTEM
            )
        }
    }

    private fun enqueueSystem(
        url: String,
        name: String,
        userAgent: String?,
        mimeType: String?,
        pageUrl: String?
    ): Long {
        val safe = name.replace(Regex("""[\\/:*?"<>|]"""), "_")
        val request = android.app.DownloadManager.Request(android.net.Uri.parse(url)).apply {
            setTitle(safe)
            setDescription(url)
            setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setAllowedOverMetered(true)
            setAllowedOverRoaming(true)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Prism/$safe")
            userAgent?.takeIf { it.isNotBlank() }?.let { addRequestHeader("User-Agent", it) }
            if (!pageUrl.isNullOrBlank()) addRequestHeader("Referer", pageUrl)
            val mime = mimeType?.takeIf { it.isNotBlank() && !it.contains('*') }
            if (mime != null) setMimeType(mime)
        }
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
        val id = dm.enqueue(request)
        items[id] = DownloadItem(
            id = id,
            url = url,
            fileName = safe,
            mimeType = mimeType.orEmpty().ifBlank { guessMime(safe) },
            pageUrl = pageUrl.orEmpty(),
            createdAt = System.currentTimeMillis(),
            status = DownloadItem.STATUS_PENDING,
            backend = "system",
            userAgent = userAgent.orEmpty(),
            saveDir = "Download/Prism"
        )
        persistMeta()
        notifyChanged(true)
        toast("系统下载: $safe")
        return id
    }

    private fun enqueueBuiltin(
        url: String,
        name: String,
        userAgent: String?,
        mimeType: String?,
        pageUrl: String?,
        restartOnResume: Boolean
    ): Long {
        val id = seq.incrementAndGet()
        val safeName = name.replace(Regex("""[\\/:*?"<>|]"""), "_")
        val dir = downloadDir()
        val target = uniqueFile(dir, safeName)
        val item = DownloadItem(
            id = id,
            url = url,
            fileName = target.name,
            mimeType = mimeType.orEmpty().ifBlank { guessMime(target.name) },
            pageUrl = pageUrl.orEmpty(),
            createdAt = System.currentTimeMillis(),
            status = DownloadItem.STATUS_PENDING,
            backend = "builtin",
            userAgent = userAgent.orEmpty(),
            saveDir = dir.absolutePath,
            restartOnResume = restartOnResume
        )
        items[id] = item
        persistMeta()
        notifyChanged(true)
        toast("开始下载: ${target.name}")
        startBuiltin(id, target)
        return id
    }

    fun pause(id: Long) {
        val item = items[id] ?: return
        if (item.backend != "builtin") {
            toast("系统下载请到系统下载管理中操作")
            return
        }
        pauseFlags.getOrPut(id) { AtomicBoolean(false) }.set(true)
        futures[id]?.cancel(true)
        update(id, forceNotify = true) { it.copy(status = DownloadItem.STATUS_PAUSED) }
        toast("已暂停")
    }

    fun resume(id: Long) {
        val item = items[id] ?: return
        if (item.backend != "builtin") {
            toast("系统下载请到系统下载管理中操作")
            return
        }
        if (item.status == DownloadItem.STATUS_RUNNING) return
        val dir = if (item.saveDir.isNotBlank()) File(item.saveDir) else downloadDir()
        dir.mkdirs()
        val target = File(dir, item.fileName)
        startBuiltin(id, target)
        toast(if (item.restartOnResume) "重新下载" else "继续下载")
    }

    fun rename(id: Long, newNameRaw: String): Boolean {
        val item = items[id] ?: return false
        val newName = newNameRaw.replace(Regex("""[\\/:*?"<>|]"""), "_").trim()
        if (newName.isBlank() || newName == item.fileName) return false
        if (item.backend == "system" && item.status != DownloadItem.STATUS_SUCCESSFUL) {
            update(id, forceNotify = true) { it.copy(fileName = newName) }
            return true
        }
        val file = fileFor(item)
        val dir = file?.parentFile ?: (if (item.saveDir.isNotBlank()) File(item.saveDir) else downloadDir())
        dir.mkdirs()
        val dest = uniqueFile(dir, newName)
        if (file != null && file.exists()) {
            if (!file.renameTo(dest)) return false
            update(id, forceNotify = true) {
                it.copy(fileName = dest.name, localUri = dest.absolutePath, saveDir = dir.absolutePath)
            }
        } else {
            update(id, forceNotify = true) { it.copy(fileName = dest.name, saveDir = dir.absolutePath) }
        }
        toast("已重命名为 ${dest.name}")
        return true
    }

    private fun startBuiltin(id: Long, target: File) {
        pauseFlags[id] = AtomicBoolean(false)
        futures[id] = pool.submit { runDownload(id, target) }
        update(id, forceNotify = true) { it.copy(status = DownloadItem.STATUS_RUNNING, error = "") }
    }

    private fun runDownload(id: Long, target: File) {
        val item = items[id] ?: return
        var conn: HttpURLConnection? = null
        try {
            val download = downloadHttp.openDownload(
                item.url,
                item.userAgent,
                item.pageUrl,
                existingBytes = target.length(),
                restartOnResume = item.restartOnResume
            )
            conn = download.connection
            val offset = download.appendOffset
            val code = conn.responseCode
            if (code !in 200..299) error("HTTP $code")
            val totalFromHeader = conn.getHeaderField("Content-Range")?.substringAfter("/")?.toLongOrNull()
                ?: if (code == 206) offset + conn.contentLengthLong.coerceAtLeast(0)
                else conn.contentLengthLong
            val total = if (totalFromHeader > 0) totalFromHeader else -1L
            conn.inputStream.use { input ->
                RandomAccessFile(target, "rw").use { raf ->
                    if (offset > 0) raf.seek(offset) else raf.setLength(0)
                    val buf = ByteArray(64 * 1024)
                    var done = offset
                    var lastUi = 0L
                    while (true) {
                        if (pauseFlags[id]?.get() == true || Thread.currentThread().isInterrupted) {
                            update(id, forceNotify = true) {
                                it.copy(
                                    status = DownloadItem.STATUS_PAUSED,
                                    bytesDownloaded = done,
                                    totalBytes = total,
                                    localUri = target.absolutePath
                                )
                            }
                            return
                        }
                        val n = input.read(buf)
                        if (n < 0) break
                        raf.write(buf, 0, n)
                        done += n
                        val now = System.currentTimeMillis()
                        if (now - lastUi > 250) {
                            lastUi = now
                            update(id) {
                                it.copy(
                                    status = DownloadItem.STATUS_RUNNING,
                                    bytesDownloaded = done,
                                    totalBytes = total,
                                    localUri = target.absolutePath
                                )
                            }
                        }
                    }
                    if (total > 0 && done != total) error("下载未完成：$done / $total 字节，可继续下载")
                    update(id, forceNotify = true) {
                        it.copy(
                            status = DownloadItem.STATUS_SUCCESSFUL,
                            bytesDownloaded = done,
                            totalBytes = if (total > 0) total else done,
                            localUri = target.absolutePath,
                            mimeType = it.mimeType.ifBlank { guessMime(target.name) }
                        )
                    }
                    main.post {
                        toast("下载完成: ${target.name}")
                        items[id]?.let { DownloadNotifier.notifyCompleted(context, it) }
                    }
                }
            }
        } catch (e: Exception) {
            if (pauseFlags[id]?.get() == true) {
                update(id, forceNotify = true) { it.copy(status = DownloadItem.STATUS_PAUSED) }
            } else {
                update(id, forceNotify = true) { it.copy(status = DownloadItem.STATUS_FAILED, error = e.message.orEmpty()) }
                main.post {
                    toast("下载失败: ${e.message}")
                    items[id]?.let { DownloadNotifier.notifyFailed(context, it) }
                }
            }
        } finally {
            conn?.disconnect()
            futures.remove(id)
            notifyChanged(true)
        }
    }

    fun list(): List<DownloadItem> {
        items.values.filter { it.backend == "system" }.forEach { refreshSystem(it.id) }
        return items.values.sortedByDescending { it.createdAt }
    }

    fun hasActive(): Boolean = items.values.any {
        it.status == DownloadItem.STATUS_RUNNING || it.status == DownloadItem.STATUS_PENDING
    }

    fun fileFor(item: DownloadItem): File? {
        return when {
            item.localUri.isBlank() -> {
                val dir = if (item.saveDir.isNotBlank()) File(item.saveDir) else downloadDir()
                File(dir, item.fileName).takeIf { it.exists() }
            }
            item.localUri.startsWith("/") -> File(item.localUri).takeIf { it.exists() }
            item.localUri.startsWith("file:") -> runCatching { File(java.net.URI(item.localUri)) }.getOrNull()?.takeIf { it.exists() }
            else -> {
                val dir = if (item.saveDir.isNotBlank()) File(item.saveDir) else downloadDir()
                File(dir, item.fileName).takeIf { it.exists() }
            }
        }
    }

    private fun refreshSystem(id: Long) {
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager
        val c = dm.query(android.app.DownloadManager.Query().setFilterById(id)) ?: return
        c.use { cursor ->
            if (!cursor.moveToFirst()) return
            val status = cursor.getInt(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_STATUS))
            val soFar = cursor.getLong(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = cursor.getLong(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            val local = cursor.getString(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_LOCAL_URI)).orEmpty()
            val mapped = when (status) {
                android.app.DownloadManager.STATUS_PENDING -> DownloadItem.STATUS_PENDING
                android.app.DownloadManager.STATUS_RUNNING -> DownloadItem.STATUS_RUNNING
                android.app.DownloadManager.STATUS_PAUSED -> DownloadItem.STATUS_PAUSED
                android.app.DownloadManager.STATUS_SUCCESSFUL -> DownloadItem.STATUS_SUCCESSFUL
                android.app.DownloadManager.STATUS_FAILED -> DownloadItem.STATUS_FAILED
                else -> DownloadItem.STATUS_PENDING
            }
            val prev = items[id]
            update(id, forceNotify = prev?.status != mapped || prev.bytesDownloaded != soFar) {
                it.copy(status = mapped, bytesDownloaded = soFar, totalBytes = total, localUri = local)
            }
        }
    }

    fun remove(id: Long, deleteFile: Boolean = true) {
        pauseFlags[id]?.set(true)
        futures.remove(id)?.cancel(true)
        val item = items.remove(id)
        if (item?.backend == "system") {
            // System DownloadManager remove always deletes the file it owns.
            if (deleteFile) {
                runCatching {
                    (context.getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager).remove(id)
                }
            }
        } else if (item != null && deleteFile) {
            fileFor(item)?.delete()
        }
        persistMeta()
        notifyChanged(true)
    }

    fun clearFinished(deleteFiles: Boolean = true) {
        items.values.filter {
            it.status == DownloadItem.STATUS_SUCCESSFUL || it.status == DownloadItem.STATUS_FAILED
        }.map { it.id }.forEach { remove(it, deleteFile = deleteFiles) }
    }

    private fun update(id: Long, forceNotify: Boolean = false, block: (DownloadItem) -> DownloadItem) {
        val cur = items[id] ?: return
        val next = block(cur)
        items[id] = next
        when (next.status) {
            DownloadItem.STATUS_RUNNING -> {
                if (System.currentTimeMillis() - lastPersistAt > 1000) {
                    lastPersistAt = System.currentTimeMillis()
                    persistMeta()
                }
            }
            else -> {
                lastPersistAt = System.currentTimeMillis()
                persistMeta()
            }
        }
        notifyChanged(forceNotify || next.status != DownloadItem.STATUS_RUNNING)
    }

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name)
        if (!f.exists()) return f
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var i = 1
        while (f.exists()) {
            f = File(dir, "${base}($i)$ext")
            i++
        }
        return f
    }

    private fun guessMime(name: String): String {
        val n = name.lowercase()
        return when {
            n.endsWith(".apk") -> "application/vnd.android.package-archive"
            n.endsWith(".pdf") -> "application/pdf"
            n.endsWith(".zip") -> "application/zip"
            n.endsWith(".mp4") -> "video/mp4"
            n.endsWith(".mp3") -> "audio/mpeg"
            n.endsWith(".png") -> "image/png"
            n.endsWith(".jpg") || n.endsWith(".jpeg") -> "image/jpeg"
            else -> "application/octet-stream"
        }
    }

    private fun toast(msg: String) {
        main.post { Toast.makeText(context, msg, Toast.LENGTH_SHORT).show() }
    }

    private fun loadMeta() {
        if (!metaFile.exists()) return
        runCatching {
            val arr = JSONArray(metaFile.readText())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val id = o.getLong("id")
                items[id] = DownloadItem(
                    id = id,
                    url = o.optString("url"),
                    fileName = o.optString("fileName"),
                    mimeType = o.optString("mimeType"),
                    pageUrl = o.optString("pageUrl"),
                    createdAt = o.optLong("createdAt"),
                    status = o.optInt("status", DownloadItem.STATUS_PENDING),
                    bytesDownloaded = o.optLong("bytesDownloaded"),
                    totalBytes = o.optLong("totalBytes", -1),
                    localUri = o.optString("localUri"),
                    backend = o.optString("backend", "builtin"),
                    error = o.optString("error"),
                    userAgent = o.optString("userAgent"),
                    saveDir = o.optString("saveDir"),
                    restartOnResume = o.optBoolean("restartOnResume")
                )
            }
        }
    }

    private fun persistMeta() {
        val snapshot = items.values.toList()
        val arr = JSONArray()
        snapshot.forEach { d ->
            arr.put(
                JSONObject()
                    .put("id", d.id)
                    .put("url", d.url)
                    .put("fileName", d.fileName)
                    .put("mimeType", d.mimeType)
                    .put("pageUrl", d.pageUrl)
                    .put("createdAt", d.createdAt)
                    .put("status", d.status)
                    .put("bytesDownloaded", d.bytesDownloaded)
                    .put("totalBytes", d.totalBytes)
                    .put("localUri", d.localUri)
                    .put("backend", d.backend)
                    .put("error", d.error)
                    .put("userAgent", d.userAgent)
                    .put("saveDir", d.saveDir)
                    .put("restartOnResume", d.restartOnResume)
            )
        }
        runCatching { metaFile.writeText(arr.toString()) }
    }
}

object DownloadHelper {
    private val nameIo = Executors.newCachedThreadPool { r ->
        Thread(r, "prism-dl-name").apply { isDaemon = true }
    }
    private val main = Handler(Looper.getMainLooper())

    fun resolveBackend(url: String, pageUrl: String?, preferredBackend: DownloadBackend): DownloadBackend =
        downloadHttp.resolveBackend(url, pageUrl, preferredBackend)

    fun enqueue(
        context: Context,
        url: String,
        userAgent: String? = null,
        contentDisposition: String? = null,
        mimeType: String? = null,
        pageUrl: String? = null,
        preferredName: String? = null
    ): Long {
        val app = context.applicationContext as? com.shifuf.prism.BrowserApp
        val backend = if (app?.prefs?.downloadUseSystem == true) DownloadBackend.SYSTEM else DownloadBackend.BUILTIN
        val repo = app?.downloads ?: DownloadRepository(context.applicationContext)
        return repo.enqueue(url, userAgent, contentDisposition, mimeType, pageUrl, backend, preferredName)
    }

    /**
     * 解析真实下载文件名：优先 Content-Disposition / 跳转后 URL 末段，
     * 解决短链（如 /s/xxx → /download）被猜成 download.apk 的问题。
     */
    fun resolveFileName(
        url: String,
        userAgent: String? = null,
        contentDisposition: String? = null,
        mimeType: String? = null,
        pageUrl: String? = null,
        callback: (String) -> Unit
    ) {
        val fallback = URLUtil.guessFileName(url, contentDisposition, mimeType)
        // 已有明确文件名则不必探测
        val fromCd = parseContentDisposition(contentDisposition)
        if (!fromCd.isNullOrBlank() && !looksGeneric(fromCd)) {
            callback(sanitizeFileName(fromCd))
            return
        }
        if (!looksGeneric(fallback) && !urlLooksLikeShareLink(url)) {
            callback(sanitizeFileName(fallback))
            return
        }
        nameIo.execute {
            val resolved = runCatching {
                probeFileName(url, userAgent, pageUrl, mimeType) ?: fallback
            }.getOrDefault(fallback)
            main.post { callback(sanitizeFileName(resolved)) }
        }
    }

    private fun urlLooksLikeShareLink(url: String): Boolean {
        val path = runCatching { URL(url).path.trimEnd('/') }.getOrDefault("")
        // /s/xxx 短链、路径无扩展名、末段为 download
        val last = path.substringAfterLast('/')
        return path.contains("/s/") ||
            last.equals("download", true) ||
            last.equals("dl", true) ||
            (!last.contains('.') && last.isNotBlank())
    }

    private fun looksGeneric(name: String): Boolean {
        val n = name.lowercase().trim()
        return n.isBlank() ||
            n == "download" ||
            n == "download.bin" ||
            n == "download.apk" ||
            n == "file" ||
            n == "file.bin" ||
            n.matches(Regex("""^download(\(\d+\))?(\.\w+)?$""")) ||
            n.matches(Regex("""^[0-9a-f]{16,}(\.\w+)?$"""))
    }

    private fun probeFileName(
        url: String,
        userAgent: String?,
        pageUrl: String?,
        mimeType: String?
    ): String? {
        var current = url
        var redirects = 0
        while (redirects < 8) {
            val conn = downloadHttp.open(current, userAgent, pageUrl, method = "HEAD")
            val code = try {
                conn.responseCode
            } catch (_: Exception) {
                // 部分服务不支持 HEAD，改 GET 只读头
                conn.disconnect()
                return probeWithGet(current, userAgent, pageUrl, mimeType)
            }
            when (code) {
                in 300..399 -> {
                    val next = downloadHttp.resolveRedirect(conn.url, conn.getHeaderField("Location"))
                    conn.disconnect()
                    current = next ?: return null
                    redirects++
                }
                in 200..299 -> {
                    val cd = conn.getHeaderField("Content-Disposition")
                    val ct = conn.contentType ?: mimeType
                    val finalUrl = conn.url?.toString() ?: current
                    conn.disconnect()
                    parseContentDisposition(cd)?.takeIf { !looksGeneric(it) }?.let { return it }
                    val fromUrl = URLUtil.guessFileName(finalUrl, cd, ct)
                    if (!looksGeneric(fromUrl)) return fromUrl
                    // HEAD 没给名字，再试 GET
                    return probeWithGet(finalUrl, userAgent, pageUrl, ct) ?: fromUrl
                }
                405, 501 -> {
                    conn.disconnect()
                    return probeWithGet(current, userAgent, pageUrl, mimeType)
                }
                else -> {
                    conn.disconnect()
                    return probeWithGet(current, userAgent, pageUrl, mimeType)
                }
            }
        }
        return null
    }

    private fun probeWithGet(
        url: String,
        userAgent: String?,
        pageUrl: String?,
        mimeType: String?
    ): String? {
        var current = url
        var redirects = 0
        while (redirects < 8) {
            val conn = downloadHttp.open(current, userAgent, pageUrl, range = "bytes=0-0")
            val code = try {
                conn.responseCode
            } catch (_: Exception) {
                conn.disconnect()
                return null
            }
            when (code) {
                in 300..399 -> {
                    val next = downloadHttp.resolveRedirect(conn.url, conn.getHeaderField("Location"))
                    conn.disconnect()
                    current = next ?: return null
                    redirects++
                }
                in 200..299, 206 -> {
                    val cd = conn.getHeaderField("Content-Disposition")
                    val ct = conn.contentType ?: mimeType
                    val finalUrl = conn.url?.toString() ?: current
                    runCatching { conn.inputStream.close() }
                    conn.disconnect()
                    parseContentDisposition(cd)?.takeIf { !looksGeneric(it) }?.let { return it }
                    val fromUrl = URLUtil.guessFileName(finalUrl, cd, ct)
                    return if (!looksGeneric(fromUrl)) fromUrl else null
                }
                else -> {
                    conn.disconnect()
                    return null
                }
            }
        }
        return null
    }

    fun parseContentDisposition(header: String?): String? {
        if (header.isNullOrBlank()) return null
        // filename*=UTF-8''xxx
        val star = Regex("""filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)""", RegexOption.IGNORE_CASE)
            .find(header)
        if (star != null) {
            val raw = star.groupValues[1].trim().trim('"', '\'')
            return runCatching {
                java.net.URLDecoder.decode(raw, "UTF-8")
            }.getOrDefault(raw)
        }
        val plain = Regex("""filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)""", RegexOption.IGNORE_CASE)
            .find(header)
        if (plain != null) {
            val raw = (plain.groupValues[1].ifBlank { plain.groupValues[2] }).trim().trim('"', '\'')
            return runCatching {
                java.net.URLDecoder.decode(raw, "UTF-8")
            }.getOrDefault(raw)
        }
        return null
    }

    fun sanitizeFileName(name: String): String =
        name.replace(Regex("""[\\/:*?"<>|]"""), "_").trim().ifBlank { "download.bin" }
}
