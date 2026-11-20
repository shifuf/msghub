package com.shifuf.prism.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.R
import com.shifuf.prism.core.DownloadBackend
import com.shifuf.prism.core.DownloadHelper
import com.shifuf.prism.core.DownloadItem
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class DownloadsActivity : PrismActivity() {
    private val repo get() = BrowserApp.instance.downloads
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var searchBox: android.widget.EditText
    private lateinit var chips: ChipGroup
    private lateinit var adapter: Adapter
    private var filter = "all"
    private var query = ""
    private var refreshRunnable: Runnable? = null
    private val changeListener: () -> Unit = { runOnUiThread { if (!isDestroyed) refresh() } }

    private val folderPicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
        val uri = result.data?.data ?: return@registerForActivityResult
        val path = resolveTreePath(uri)
        if (path.isNullOrBlank()) {
            runCatching {
                contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
            }
            BrowserApp.instance.prefs.downloadDirPath = uri.toString()
            Toast.makeText(this, "已选择下载目录", Toast.LENGTH_SHORT).show()
        } else {
            val dir = File(path)
            if (dir.exists() || dir.mkdirs()) {
                BrowserApp.instance.prefs.downloadDirPath = dir.absolutePath
                Toast.makeText(this, "下载目录：$path", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "目录不可用", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_downloads)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = "下载"
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        searchBox = findViewById(R.id.searchBox)
        chips = findViewById(R.id.filterChips)

        listOf(
            "all" to "全部",
            "doc" to "文档",
            "zip" to "压缩包",
            "apk" to "安装包",
            "image" to "图片",
            "video" to "视频",
            "audio" to "音频"
        ).forEachIndexed { index, (id, label) ->
            chips.addView(
                Chip(this, null, com.google.android.material.R.attr.chipStyle).apply {
                    text = label
                    this.id = View.generateViewId()
                    chipBackgroundColor = android.content.res.ColorStateList(
                        arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                        intArrayOf(getColor(R.color.via_accent_soft), getColor(R.color.via_card)))
                    setTextColor(android.content.res.ColorStateList(
                        arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                        intArrayOf(getColor(R.color.via_accent), getColor(R.color.via_text_secondary))))
                    chipStrokeWidth = 0f
                    chipCornerRadius = dp(14).toFloat()
                    isCheckedIconVisible = false
                    setEnsureMinTouchTargetSize(true)
                    isCheckable = true
                    isChecked = index == 0
                    tag = id
                }
            )
        }
        chips.setOnCheckedStateChangeListener { group, checkedIds ->
            val chip = checkedIds.firstOrNull()?.let { group.findViewById<Chip>(it) }
            filter = (chip?.tag as? String) ?: "all"
            refresh()
        }

        adapter = Adapter(
            onClick = { item -> onItemClick(item) },
            onLongClick = { item -> onItemLongClick(item) }
        )
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter

        searchBox.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                query = s?.toString().orEmpty().trim()
                refresh()
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        findViewById<TextView>(R.id.btnNewDownload).setOnClickListener { showNewDownload() }
        findViewById<TextView>(R.id.btnEditDownloads).setOnClickListener {
            val pathLabel = BrowserApp.instance.prefs.downloadDirPath.ifBlank { "应用私有目录" }
            DialogUi.material(this)
                .setTitle("下载选项")
                .setItems(
                    arrayOf(
                        "清除已完成",
                        if (BrowserApp.instance.prefs.downloadUseSystem) "切换到内置下载" else "切换到系统下载",
                        "下载目录：$pathLabel",
                        "选择下载目录…",
                        "恢复默认下载目录"
                    )
                ) { _, which ->
                    when (which) {
                        0 -> {
                            repo.clearFinished(); refresh()
                        }
                        1 -> {
                            BrowserApp.instance.prefs.downloadUseSystem =
                                !BrowserApp.instance.prefs.downloadUseSystem
                            Toast.makeText(
                                this,
                                if (BrowserApp.instance.prefs.downloadUseSystem) "已使用系统下载管理"
                                else "已使用浏览器内置下载",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                        2 -> Toast.makeText(this, pathLabel, Toast.LENGTH_LONG).show()
                        3 -> pickDownloadDir()
                        4 -> {
                            BrowserApp.instance.prefs.downloadDirPath = ""
                            Toast.makeText(this, "已恢复默认下载目录", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
                .show()
        }

        repo.addListener(changeListener)
        refreshRunnable = object : Runnable {
            override fun run() {
                if (isDestroyed) return
                // Always refresh while page is open so progress never sticks on "等待中"
                refresh()
                recycler.postDelayed(this, 500)
            }
        }
        recycler.post(refreshRunnable!!)
        refresh()
    }

    override fun onDestroy() {
        repo.removeListener(changeListener)
        refreshRunnable?.let { recycler.removeCallbacks(it) }
        super.onDestroy()
    }

    private fun pickDownloadDir() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    Uri.parse("content://com.android.externalstorage.documents/document/primary:Download")
                )
            }
        }
        folderPicker.launch(intent)
    }

    private fun resolveTreePath(uri: Uri): String? {
        val docId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull() ?: return null
        val parts = docId.split(":", limit = 2)
        if (parts.size < 2) return null
        return if (parts[0].equals("primary", true)) {
            File(Environment.getExternalStorageDirectory(), parts[1]).absolutePath
        } else {
            "/storage/${parts[0]}/${parts[1]}"
        }
    }

    private fun showNewDownload() {
        val input = DialogUi.styledEditText(this, "输入下载链接 https://...")
        val engine = if (BrowserApp.instance.prefs.downloadUseSystem) "系统下载" else "内置下载"
        DialogUi.material(this)
            .setTitle("新建下载（$engine）")
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton("下一步") { _, _ ->
                val url = input.text?.toString()?.trim().orEmpty()
                if (!url.startsWith("http")) {
                    Toast.makeText(this, "请输入有效链接", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                confirmAndDownload(url)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun confirmAndDownload(url: String, mime: String? = null, pageUrl: String? = null) {
        val backend = if (BrowserApp.instance.prefs.downloadUseSystem) DownloadBackend.SYSTEM else DownloadBackend.BUILTIN
        DownloadHelper.resolveFileName(
            url = url,
            mimeType = mime,
            pageUrl = pageUrl,
        ) { name ->
            runOnUiThread {
                val resolved = DownloadHelper.resolveBackend(url, pageUrl, backend)
                DialogUi.showDownloadConfirm(
                    context = this,
                    fileName = name,
                    url = url,
                    engineLabel = if (resolved == DownloadBackend.SYSTEM) "系统" else "内置",
                    onConfirm = { chosen ->
                        runCatching {
                            repo.enqueue(url = url, mimeType = mime, pageUrl = pageUrl, backend = backend, preferredName = chosen)
                        }.onSuccess { refresh() }.onFailure {
                            Toast.makeText(this, "无法开始下载", Toast.LENGTH_LONG).show()
                        }
                    }
                )
            }
        }
    }

    private fun onItemClick(item: DownloadItem) {
        when (item.status) {
            DownloadItem.STATUS_SUCCESSFUL -> openFile(item)
            else -> showItemActions(item)
        }
    }

    private fun onItemLongClick(item: DownloadItem) {
        showItemActions(item)
    }

    private fun showItemActions(item: DownloadItem) {
        val actions = mutableListOf<String>()
        if (item.status == DownloadItem.STATUS_RUNNING) actions += "暂停"
        if (item.status == DownloadItem.STATUS_PAUSED || item.status == DownloadItem.STATUS_FAILED || item.status == DownloadItem.STATUS_PENDING) actions += "继续"
        if (item.status == DownloadItem.STATUS_SUCCESSFUL) actions += "打开"
        actions += "重命名"
        actions += "复制下载链接"
        if (item.localUri.isNotBlank() || item.status == DownloadItem.STATUS_SUCCESSFUL) {
            actions += "复制本地路径"
        }
        actions += "分享链接"
        actions += "删除"
        DialogUi.material(this)
            .setTitle(item.fileName)
            .setItems(actions.toTypedArray()) { _, which ->
                when (actions[which]) {
                    "暂停" -> repo.pause(item.id)
                    "继续" -> repo.resume(item.id)
                    "打开" -> openFile(item)
                    "重命名" -> renameItem(item)
                    "复制下载链接" -> copyText(item.url, "已复制下载链接")
                    "复制本地路径" -> {
                        val path = repo.fileFor(item)?.absolutePath
                            ?: item.localUri.ifBlank { "无本地路径" }
                        copyText(path, "已复制本地路径")
                    }
                    "分享链接" -> shareText(item.url)
                    "删除" -> confirmDelete(item)
                }
                refresh()
            }
            .show()
    }

    private fun confirmDelete(item: DownloadItem) {
        val hasFile = repo.fileFor(item)?.exists() == true ||
            (item.backend == "system" && item.localUri.isNotBlank())
        if (!hasFile) {
            repo.remove(item.id, deleteFile = false)
            refresh()
            return
        }
        DialogUi.material(this)
            .setTitle("删除下载")
            .setMessage("「${item.fileName}」\n\n是否同时删除本地文件？")
            .setPositiveButton("删除记录和文件") { _, _ ->
                repo.remove(item.id, deleteFile = true)
                refresh()
            }
            .setNeutralButton("仅删除记录") { _, _ ->
                repo.remove(item.id, deleteFile = false)
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun renameItem(item: DownloadItem) {
        val input = DialogUi.styledEditText(this, "新文件名", prefill = item.fileName)
        DialogUi.material(this)
            .setTitle("重命名")
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton("保存") { _, _ ->
                val name = input.text?.toString()?.trim().orEmpty()
                if (name.isBlank()) return@setPositiveButton
                if (!repo.rename(item.id, name)) {
                    Toast.makeText(this, "重命名失败", Toast.LENGTH_SHORT).show()
                }
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun copyText(text: String, toast: String) {
        val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
        cm.setPrimaryClip(android.content.ClipData.newPlainText("download", text))
        Toast.makeText(this, toast, Toast.LENGTH_SHORT).show()
    }

    private fun shareText(text: String) {
        startActivity(
            Intent.createChooser(
                Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                },
                "分享链接"
            )
        )
    }

    private fun openFile(item: DownloadItem) {
        val file = repo.fileFor(item)
        if (file == null || !file.exists()) {
            if (item.backend == "system" && item.localUri.isNotBlank()) {
                openSystemUri(item)
                return
            }
            Toast.makeText(this, "文件不存在", Toast.LENGTH_SHORT).show()
            return
        }
        val mime = resolveMime(item, file.name)
        if (file.name.endsWith(".apk", true) || mime.contains("android.package")) {
            openApk(file, mime)
            return
        }
        val uri = runCatching {
            FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        }.getOrElse {
            Toast.makeText(this, "无法分享文件: ${it.message}", Toast.LENGTH_LONG).show()
            return
        }
        runCatching {
            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }.onFailure {
            runCatching {
                startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "*/*")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        },
                        "打开文件"
                    )
                )
            }.onFailure { e2 ->
                Toast.makeText(this, "无法打开: ${e2.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun openSystemUri(item: DownloadItem) {
        val mime = resolveMime(item, item.fileName)
        val uri = android.net.Uri.parse(item.localUri)
        runCatching {
            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }.onFailure {
            Toast.makeText(this, "无法打开: ${it.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun openApk(file: File, mime: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canInstall = packageManager.canRequestPackageInstalls()
            if (!canInstall) {
                DialogUi.material(this)
                    .setTitle("需要安装权限")
                    .setMessage("安装 APK 需要允许“安装未知应用”。是否前往设置开启？")
                    .setPositiveButton("去设置") { _, _ ->
                        runCatching {
                            startActivity(
                                Intent(
                                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    android.net.Uri.parse("package:$packageName")
                                )
                            )
                        }
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
                return
            }
        }
        val uri = runCatching {
            FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        }.getOrElse {
            Toast.makeText(this, "无法分享 APK: ${it.message}", Toast.LENGTH_LONG).show()
            return
        }
        runCatching {
            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime.ifBlank { "application/vnd.android.package-archive" })
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }.onFailure {
            Toast.makeText(this, "无法安装: ${it.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun resolveMime(item: DownloadItem, name: String): String {
        val n = name.lowercase()
        val fromItem = item.mimeType.takeIf {
            it.isNotBlank() && !it.contains('*') && it != "application/octet-stream"
        }
        if (fromItem != null) return fromItem
        return when {
            n.endsWith(".apk") -> "application/vnd.android.package-archive"
            n.endsWith(".pdf") -> "application/pdf"
            n.endsWith(".mp4") -> "video/mp4"
            n.endsWith(".zip") -> "application/zip"
            n.endsWith(".png") -> "image/png"
            n.endsWith(".jpg") || n.endsWith(".jpeg") -> "image/jpeg"
            n.endsWith(".mp3") -> "audio/mpeg"
            n.endsWith(".txt") -> "text/plain"
            else -> "application/octet-stream"
        }
    }

    private fun refresh() {
        var list = repo.list()
        if (query.isNotBlank()) {
            list = list.filter {
                it.fileName.contains(query, true) || it.url.contains(query, true)
            }
        }
        list = list.filter { matchFilter(it, filter) }
        val rows = buildRows(list)
        val activeCount = list.count { it.status == DownloadItem.STATUS_RUNNING || it.status == DownloadItem.STATUS_PENDING }
        setPageSummary("${list.size} 个文件" + if (activeCount > 0) " · $activeCount 个正在下载" else " · 点按打开，长按管理")
        emptyView.text = if (query.isNotBlank() || filter != "all") "未找到匹配的文件\n试试其他关键词或分类" else "还没有下载文件\n点按下方新建下载，或从网页保存内容"
        adapter.submit(rows)
        emptyView.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
        recycler.visibility = if (rows.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun matchFilter(item: DownloadItem, f: String): Boolean {
        if (f == "all") return true
        val name = item.fileName.lowercase()
        val mime = item.mimeType.lowercase()
        return when (f) {
            "doc" -> listOf(".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".txt").any { name.endsWith(it) } ||
                mime.contains("pdf") || mime.contains("document")
            "zip" -> listOf(".zip", ".rar", ".7z", ".tar", ".gz").any { name.endsWith(it) }
            "apk" -> name.endsWith(".apk") || mime.contains("android.package")
            "image" -> listOf(".jpg", ".jpeg", ".png", ".webp", ".gif").any { name.endsWith(it) } || mime.startsWith("image/")
            "video" -> listOf(".mp4", ".mkv", ".webm", ".flv").any { name.endsWith(it) } || mime.startsWith("video/")
            "audio" -> listOf(".mp3", ".m4a", ".flac", ".aac").any { name.endsWith(it) } || mime.startsWith("audio/")
            else -> true
        }
    }

    private fun buildRows(list: List<DownloadItem>): List<Row> {
        if (list.isEmpty()) return emptyList()
        val rows = ArrayList<Row>()
        var lastKey = ""
        list.forEach { item ->
            val key = dayKey(item.createdAt)
            if (key != lastKey) {
                rows.add(Row.Header(dayLabel(item.createdAt)))
                lastKey = key
            }
            rows.add(Row.Item(item))
        }
        return rows
    }

    private fun dayKey(ts: Long): String {
        val c = Calendar.getInstance().apply { timeInMillis = ts }
        return "${c.get(Calendar.YEAR)}-${c.get(Calendar.DAY_OF_YEAR)}"
    }

    private fun dayLabel(ts: Long): String {
        val df = SimpleDateFormat("MM月dd日 E", Locale.CHINA)
        return df.format(Date(if (ts > 0) ts else System.currentTimeMillis()))
    }

    private sealed class Row {
        data class Header(val label: String) : Row()
        data class Item(val item: DownloadItem) : Row()
    }

    private class Adapter(
        val onClick: (DownloadItem) -> Unit,
        val onLongClick: (DownloadItem) -> Unit
    ) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        private val data = mutableListOf<Row>()
        fun submit(list: List<Row>) {
            data.clear(); data.addAll(list); notifyDataSetChanged()
        }

        override fun getItemViewType(position: Int) = when (data[position]) {
            is Row.Header -> 0
            is Row.Item -> 1
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            val layout = if (viewType == 0) R.layout.item_date_header else R.layout.item_download
            val v = LayoutInflater.from(parent.context).inflate(layout, parent, false)
            return object : RecyclerView.ViewHolder(v) {}
        }

        override fun getItemCount() = data.size

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            when (val row = data[position]) {
                is Row.Header -> holder.itemView.findViewById<TextView>(R.id.dateHeader).text = row.label
                is Row.Item -> {
                    val title = holder.itemView.findViewById<TextView>(R.id.title)
                    val subtitle = holder.itemView.findViewById<TextView>(R.id.subtitle)
                    val meta = holder.itemView.findViewById<TextView>(R.id.meta)
                    val progress = holder.itemView.findViewById<android.widget.ProgressBar>(R.id.progress)
                    val item = row.item
                    title.text = item.fileName
                    subtitle.setTextColor(holder.itemView.context.getColor(
                        if (item.status == DownloadItem.STATUS_FAILED) R.color.via_danger else R.color.via_text_secondary))
                    val size = formatSize(item.bytesDownloaded, item.totalBytes)
                    val pct = item.progress
                    subtitle.text = when (item.status) {
                        DownloadItem.STATUS_RUNNING -> {
                            if (pct >= 0) "$size · 下载中 $pct%" else "$size · 下载中…"
                        }
                        DownloadItem.STATUS_PAUSED -> "$size · 已暂停 · 点击继续"
                        DownloadItem.STATUS_SUCCESSFUL -> "$size · 已完成 · 点击打开"
                        DownloadItem.STATUS_FAILED -> "失败 · 点击重试${if (item.error.isNotBlank()) " · ${item.error}" else ""}"
                        DownloadItem.STATUS_PENDING -> "等待中…"
                        else -> item.statusLabel
                    }
                    when (item.status) {
                        DownloadItem.STATUS_RUNNING, DownloadItem.STATUS_PAUSED, DownloadItem.STATUS_PENDING -> {
                            progress.visibility = View.VISIBLE
                            progress.isIndeterminate = pct < 0
                            if (pct >= 0) progress.progress = pct
                        }
                        else -> progress.visibility = View.GONE
                    }
                    val engine = if (item.backend == "system") "系统" else "内置"
                    val dir = item.saveDir.takeIf { it.isNotBlank() }?.let { " · ${it.takeLast(28)}" } ?: ""
                    meta.text = "$engine$dir · ${item.url.take(42)}"
                    holder.itemView.setOnClickListener { onClick(item) }
                    holder.itemView.setOnLongClickListener { onLongClick(item); true }
                }
            }
        }

        private fun formatSize(done: Long, total: Long): String {
            fun mb(v: Long) = String.format(Locale.US, "%.1f MB", v / 1024f / 1024f)
            return if (total > 0) "${mb(done)}/${mb(total)}" else if (done > 0) mb(done) else "-"
        }
    }
}

