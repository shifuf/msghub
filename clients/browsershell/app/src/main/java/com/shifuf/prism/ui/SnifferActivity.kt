package com.shifuf.prism.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.MainActivity
import com.shifuf.prism.R
import com.shifuf.prism.core.DownloadBackend
import com.shifuf.prism.core.DownloadHelper
import com.shifuf.prism.core.ExternalPlayerHelper
import com.shifuf.prism.core.SniffedResource
import com.google.android.material.appbar.MaterialToolbar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SnifferActivity : PrismActivity() {
    private val sniffer get() = BrowserApp.instance.sniffer
    private val prefs get() = BrowserApp.instance.prefs
    private val scopeId get() = intent?.getStringExtra(EXTRA_TAB_ID)
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var adapter: Adapter
    private val df = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    private var searchQuery = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = getString(R.string.sniffer_title)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        adapter = Adapter(
            df = df,
            onClick = { showActions(it) },
            onLongClick = { showActions(it) }
        )
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        setupLibrarySearch("搜索资源格式或链接") { searchQuery = it; refresh() }
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        val page = inspectedPage()
        val list = sniffer.snapshot(page, scopeId).filter { UiSearch.matches(searchQuery, it.url, it.typeLabel, it.mimeHint) }
        setPageSummary("${list.size} 个音视频资源 · 点按播放或下载")
        adapter.submit(list)
        emptyView.text = if (searchQuery.isNotBlank()) "未找到匹配的音视频资源" else if (page.isBlank() || page.startsWith("about:")) {
            "请先打开网页并播放音频或视频"
        } else {
            "当前页尚未嗅探到音视频资源\n$page"
        }
        emptyView.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        recycler.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun inspectedPage(): String = sniffer.pageUrl(scopeId)

    private fun clearResults() {
        sniffer.clear(scopeId, inspectedPage())
        refresh()
    }

    private fun showActions(item: SniffedResource) {
        if (!checkResource(item)) return
        val options = arrayOf(
            "通过应用播放…",
            "下载",
            "新标签打开",
            "复制链接",
            "分享",
            "清空列表"
        )
        DialogUi.material(this)
            .setTitle(item.typeLabel.uppercase(Locale.getDefault()))
            .setItems(options) { _, which ->
                if (!checkResource(item)) return@setItems
                when (which) {
                    0 -> playExternal(item)
                    1 -> download(item)
                    2 -> openInNewTab(item.url)
                    3 -> copy(item.url)
                    4 -> share(item.url)
                    5 -> clearResults()
                }
            }
            .show()
    }

    private fun checkResource(item: SniffedResource): Boolean {
        if (sniffer.isCurrent(item, scopeId)) return true
        refresh()
        Toast.makeText(this, "网页已变化，请重新选择资源", Toast.LENGTH_SHORT).show()
        return false
    }

    private fun playExternal(item: SniffedResource) {
        ExternalPlayerHelper.playWithChooser(
            context = this,
            url = item.url,
            rememberedPackage = prefs.preferredPlayerPackage,
            audioMimeType = item.audioMimeType,
        ) { chosen ->
            prefs.preferredPlayerPackage = chosen?.packageName.orEmpty()
            if (chosen == null) {
                Toast.makeText(this, "已清除记住的播放器", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "已记住: ${chosen.label}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun download(item: SniffedResource) {
        val mime = item.audioMimeType ?: when (item.typeLabel) {
            "m3u8" -> "application/x-mpegURL"
            "mpd" -> "application/dash+xml"
            "webm" -> "video/webm"
            else -> "video/mp4"
        }
        val pageUrl = item.pageUrl
        val backend = if (prefs.downloadUseSystem) DownloadBackend.SYSTEM else DownloadBackend.BUILTIN
        DownloadHelper.resolveFileName(
            url = item.url,
            mimeType = mime,
            pageUrl = pageUrl,
        ) { name ->
            runOnUiThread {
                if (isFinishing || isDestroyed || !checkResource(item)) return@runOnUiThread
                val resolved = DownloadHelper.resolveBackend(item.url, pageUrl, backend)
                DialogUi.showDownloadConfirm(
                    context = this,
                    fileName = name,
                    url = item.url,
                    engineLabel = if (resolved == DownloadBackend.SYSTEM) "系统" else "内置",
                    onConfirm = { chosen ->
                        if (checkResource(item)) runCatching {
                            BrowserApp.instance.downloads.enqueue(
                                url = item.url,
                                mimeType = mime,
                                pageUrl = pageUrl,
                                backend = backend,
                                preferredName = chosen
                            )
                        }.onFailure {
                            Toast.makeText(this, "下载失败: ${it.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                )
            }
        }
    }

    private fun openInNewTab(url: String) {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_OPEN_URL, url)
        )
        finish()
    }

    private fun copy(text: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("资源链接", text))
        Toast.makeText(this, "已复制", Toast.LENGTH_SHORT).show()
    }

    private fun share(url: String) {
        startActivity(
            Intent.createChooser(
                Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, url)
                },
                "分享资源链接"
            )
        )
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, R.string.clear).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(0, 2, 1, "清除记住的播放器")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            1 -> {
                clearResults(); true
            }
            2 -> {
                prefs.preferredPlayerPackage = ""
                Toast.makeText(this, "已清除记住的播放器", Toast.LENGTH_SHORT).show()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private class Adapter(
        val df: SimpleDateFormat,
        val onClick: (SniffedResource) -> Unit,
        val onLongClick: (SniffedResource) -> Unit
    ) : RecyclerView.Adapter<Adapter.VH>() {
        private val data = mutableListOf<SniffedResource>()
        fun submit(list: List<SniffedResource>) {
            data.clear(); data.addAll(list); notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_simple, parent, false)
            return VH(v)
        }

        override fun getItemCount() = data.size
        override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(data[position])

        inner class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val title: TextView = itemView.findViewById(R.id.title)
            private val subtitle: TextView = itemView.findViewById(R.id.subtitle)
            private val meta: TextView = itemView.findViewById(R.id.meta)
            fun bind(item: SniffedResource) {
                itemView.findViewById<android.widget.ImageView>(R.id.rowIcon).setImageResource(R.drawable.ic_sniffer)
                title.text = "${df.format(Date(item.timestamp))}  ·  ${item.typeLabel.uppercase(Locale.getDefault())}"
                subtitle.text = item.url
                meta.text = item.pageUrl
                itemView.setOnClickListener { onClick(item) }
                itemView.setOnLongClickListener { onLongClick(item); true }
            }
        }
    }

    companion object {
        const val EXTRA_TAB_ID = "tab_id"
    }
}
