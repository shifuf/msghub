package com.shifuf.prism.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.R
import com.shifuf.prism.core.NetworkEntry
import com.google.android.material.appbar.MaterialToolbar

class NetworkLogActivity : PrismActivity() {
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var adapter: Adapter

    private var searchQuery = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = getString(R.string.network_title)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        emptyView.text = getString(R.string.empty_network)
        adapter = Adapter { copy(it.url) }
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        setupLibrarySearch("搜索请求地址、方法或类型") { searchQuery = it; refresh() }
        refresh()
    }

    private fun refresh() {
        val list = BrowserApp.instance.networkLog.snapshot().filter { UiSearch.matches(searchQuery, it.url, it.method, it.resourceType, it.pageUrl) }
        setPageSummary("${list.size} 条请求 · ${list.count { it.blocked }} 条已拦截 · 点按复制链接")
        emptyView.text = if (searchQuery.isBlank()) getString(R.string.empty_network) else "未找到匹配的请求"
        adapter.submit(list)
        emptyView.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        recycler.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, R.string.clear).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == 1) {
            BrowserApp.instance.networkLog.clear()
            refresh()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private fun copy(text: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("url", text))
        Toast.makeText(this, "已复制", Toast.LENGTH_SHORT).show()
    }

    private class Adapter(val onClick: (NetworkEntry) -> Unit) :
        RecyclerView.Adapter<Adapter.VH>() {
        private val data = mutableListOf<NetworkEntry>()
        fun submit(list: List<NetworkEntry>) {
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
            fun bind(item: NetworkEntry) {
                val flag = if (item.blocked) "已拦截" else "已放行"
                itemView.findViewById<android.widget.ImageView>(R.id.rowIcon).setImageResource(if (item.blocked) R.drawable.ic_block else R.drawable.ic_network)
                title.text = "${item.method} · $flag · ${item.resourceType}"
                subtitle.text = item.url
                meta.text = item.pageUrl
                title.setTextColor(
                    itemView.context.getColor(if (item.blocked) R.color.via_danger else R.color.via_text)
                )
                itemView.setOnClickListener { onClick(item) }
            }
        }
    }
}
