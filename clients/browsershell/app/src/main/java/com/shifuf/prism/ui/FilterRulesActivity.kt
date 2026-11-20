package com.shifuf.prism.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.R
import com.shifuf.prism.adblock.FilterSubscription
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.switchmaterial.SwitchMaterial
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class FilterRulesActivity : PrismActivity() {
    private val engine get() = BrowserApp.instance.adBlock
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var adapter: Adapter
    private val df = SimpleDateFormat("M/d HH:mm", Locale.getDefault())

    private var searchQuery = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = "规则订阅"
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        emptyView.visibility = View.GONE
        adapter = Adapter(
            df = df,
            onToggle = { sub, enabled ->
                if (enabled) {
                    // auto download if not present, then enable
                    val needsDownload = sub.ruleCount <= 0 && sub.url.startsWith("http")
                    if (needsDownload) {
                        Toast.makeText(this, "正在下载 ${sub.name}…", Toast.LENGTH_SHORT).show()
                        BrowserApp.instance.appScope.launch {
                            val r = engine.updateOne(sub.id)
                            withContext(Dispatchers.Main) {
                                r.onSuccess {
                                    engine.setEnabled(sub.id, true)
                                    refresh()
                                    Toast.makeText(
                                        this@FilterRulesActivity,
                                        "已启用 ${it.name}（${it.ruleCount} 条规则）",
                                        Toast.LENGTH_LONG
                                    ).show()
                                }.onFailure {
                                    engine.setEnabled(sub.id, false)
                                    refresh()
                                    Toast.makeText(
                                        this@FilterRulesActivity,
                                        "下载失败: ${it.message}",
                                        Toast.LENGTH_LONG
                                    ).show()
                                }
                            }
                        }
                    } else {
                        engine.setEnabled(sub.id, true)
                        refresh()
                        Toast.makeText(this, "已启用 ${sub.name}（${engine.ruleCount()} 条生效）", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    engine.setEnabled(sub.id, false)
                    refresh()
                    Toast.makeText(this, "已关闭 ${sub.name}", Toast.LENGTH_SHORT).show()
                }
            }
        )
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        setupLibrarySearch("搜索规则名称或订阅地址") { searchQuery = it; refresh() }
        refresh()
    }

    private fun refresh() {
        val list = engine.subscriptions().filter { UiSearch.matches(searchQuery, it.name, it.url) }
        adapter.submit(list)
        setPageSummary("${engine.ruleCount()} 条生效规则 · ${list.size} 个订阅")
        emptyView.text = if (searchQuery.isBlank()) "还没有规则订阅，点按右上角添加" else "未找到匹配的规则订阅"
        emptyView.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        recycler.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "添加").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(0, 2, 1, "更新").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            1 -> {
                val input = DialogUi.styledEditText(this, "https://.../list.txt")
                DialogUi.material(this)
                    .setTitle("添加规则订阅")
                    .setView(DialogUi.wrap(this, input))
                    .setPositiveButton("添加") { _, _ ->
                        val url = input.text?.toString()?.trim().orEmpty()
                        if (url.startsWith("http")) {
                            engine.addCustom("自定义", url)
                            refresh()
                            Toast.makeText(this, "已添加，开启时会自动下载", Toast.LENGTH_SHORT).show()
                        }
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
                true
            }
            2 -> {
                Toast.makeText(this, "正在更新已启用规则…", Toast.LENGTH_SHORT).show()
                BrowserApp.instance.appScope.launch {
                    runCatching { engine.updateAll() }
                    withContext(Dispatchers.Main) {
                        refresh()
                        Toast.makeText(
                            this@FilterRulesActivity,
                            "完成 · 生效规则 ${engine.ruleCount()}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private class Adapter(
        val df: SimpleDateFormat,
        val onToggle: (FilterSubscription, Boolean) -> Unit
    ) : RecyclerView.Adapter<Adapter.VH>() {
        private val data = mutableListOf<FilterSubscription>()
        fun submit(list: List<FilterSubscription>) {
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
            private val toggle: SwitchMaterial = itemView.findViewById(R.id.toggle)
            fun bind(s: FilterSubscription) {
                itemView.findViewById<android.widget.ImageView>(R.id.rowIcon).setImageResource(R.drawable.ic_block)
                title.text = s.name
                val updated = if (s.lastUpdatedAt > 0) df.format(Date(s.lastUpdatedAt)) else "未下载"
                subtitle.text = if (s.ruleCount > 0) "${s.ruleCount} 条规则 · $updated" else "未下载 · $updated"
                meta.text = s.lastError.ifBlank { s.url }
                toggle.visibility = View.VISIBLE
                toggle.setOnCheckedChangeListener(null)
                toggle.isChecked = s.enabled
                toggle.contentDescription = s.name
                toggle.setOnCheckedChangeListener { _, checked -> onToggle(s, checked) }
            }
        }
    }
}
