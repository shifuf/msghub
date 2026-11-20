package com.shifuf.prism.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.MainActivity
import com.shifuf.prism.R
import com.shifuf.prism.core.HistoryEntry
import com.google.android.material.appbar.MaterialToolbar
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class HistoryActivity : PrismActivity() {
    private val store get() = BrowserApp.instance.historyStore
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var adapter: Adapter
    private var searchQuery = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = getString(R.string.history_title)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        emptyView.text = getString(R.string.empty_history)
        adapter = Adapter(
            onClick = { openUrl(it.url) },
            onLongClick = { confirmDelete(it) }
        )
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        setupLibrarySearch { searchQuery = it; refresh() }
        refresh()
    }

    private fun refresh() {
        val rows = buildRows(store.all().filter { UiSearch.matches(searchQuery, it.title, it.url) })
        emptyView.text = if (searchQuery.isBlank()) getString(R.string.empty_history) else "未找到相关历史记录"
        setPageSummary(if (searchQuery.isBlank()) "${rows.count { it is Row.Item }} 条记录 · 按浏览时间排列" else "找到 ${rows.count { it is Row.Item }} 条相关记录")
        adapter.submit(rows)
        emptyView.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
        recycler.visibility = if (rows.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun buildRows(list: List<HistoryEntry>): List<Row> {
        if (list.isEmpty()) return emptyList()
        val rows = ArrayList<Row>()
        var lastKey = ""
        list.forEach { e ->
            val key = dayKey(e.visitedAt)
            if (key != lastKey) {
                rows.add(Row.Header(formatDayLabel(e.visitedAt)))
                lastKey = key
            }
            rows.add(Row.Item(e))
        }
        return rows
    }

    private fun dayKey(ts: Long): String {
        val c = Calendar.getInstance().apply { timeInMillis = ts }
        return "${c.get(Calendar.YEAR)}-${c.get(Calendar.MONTH)}-${c.get(Calendar.DAY_OF_MONTH)}"
    }

    private fun formatDayLabel(ts: Long): String {
        val now = Calendar.getInstance()
        val day = Calendar.getInstance().apply { timeInMillis = ts }
        val sameYear = now.get(Calendar.YEAR) == day.get(Calendar.YEAR)
        val startToday = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val startThat = (day.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val diffDays = ((startToday.timeInMillis - startThat.timeInMillis) / (24 * 3600_000L)).toInt()
        val md = SimpleDateFormat("M/d", Locale.getDefault()).format(Date(ts))
        return when (diffDays) {
            0 -> "今天 $md"
            1 -> "昨天 $md"
            else -> {
                if (sameYear) md
                else SimpleDateFormat("yyyy/M/d", Locale.getDefault()).format(Date(ts))
            }
        }
    }

    private fun openUrl(url: String) {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_OPEN_URL, url)
        )
        finish()
    }

    private fun confirmDelete(e: HistoryEntry) {
        DialogUi.material(this)
            .setTitle("删除历史")
            .setMessage(e.title)
            .setPositiveButton("删除") { _, _ -> store.remove(e.id); refresh() }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, R.string.clear).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == 1) {
            DialogUi.material(this)
                .setTitle("清除全部历史？")
                .setMessage("清除后无法恢复，已保存的书签不会受到影响。")
                .setPositiveButton("清除") { _, _ -> store.clear(); refresh() }
                .setNegativeButton("取消", null).show()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private sealed class Row {
        data class Header(val label: String) : Row()
        data class Item(val entry: HistoryEntry) : Row()
    }

    private class Adapter(
        val onClick: (HistoryEntry) -> Unit,
        val onLongClick: (HistoryEntry) -> Unit
    ) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        private val data = mutableListOf<Row>()
        private val timeDf = SimpleDateFormat("HH:mm", Locale.getDefault())

        fun submit(list: List<Row>) {
            data.clear(); data.addAll(list); notifyDataSetChanged()
        }

        override fun getItemViewType(position: Int): Int = when (data[position]) {
            is Row.Header -> 0
            is Row.Item -> 1
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            return if (viewType == 0) {
                val v = LayoutInflater.from(parent.context).inflate(R.layout.item_date_header, parent, false)
                HeaderVH(v)
            } else {
                val v = LayoutInflater.from(parent.context).inflate(R.layout.item_simple, parent, false)
                ItemVH(v)
            }
        }

        override fun getItemCount() = data.size

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            when (val row = data[position]) {
                is Row.Header -> (holder as HeaderVH).bind(row.label)
                is Row.Item -> (holder as ItemVH).bind(row.entry)
            }
        }

        inner class HeaderVH(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val tv: TextView = itemView.findViewById(R.id.dateHeader)
            fun bind(label: String) {
                tv.text = label
            }
        }

        inner class ItemVH(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val title: TextView = itemView.findViewById(R.id.title)
            private val subtitle: TextView = itemView.findViewById(R.id.subtitle)
            private val meta: TextView = itemView.findViewById(R.id.meta)
            fun bind(e: HistoryEntry) {
                itemView.findViewById<android.widget.ImageView>(R.id.rowIcon).setImageResource(R.drawable.ic_history)
                title.text = e.title.ifBlank { e.url }
                subtitle.text = e.url
                meta.text = timeDf.format(Date(e.visitedAt))
                itemView.setOnClickListener { onClick(e) }
                itemView.setOnLongClickListener { onLongClick(e); true }
            }
        }
    }
}
