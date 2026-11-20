package com.shifuf.prism.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.R
import com.shifuf.prism.script.Userscript
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.switchmaterial.SwitchMaterial
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ScriptsActivity : PrismActivity() {
    private val store get() = BrowserApp.instance.scriptStore
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var adapter: ScriptAdapter

    private var searchQuery = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_list)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = getString(R.string.scripts_title)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        emptyView.text = getString(R.string.empty_scripts)
        adapter = ScriptAdapter(
            onToggle = { script, enabled ->
                store.setEnabled(script.id, enabled)
                BrowserApp.instance.debugServer.broadcastEvent(
                    "scripts.changed",
                    mapOf("id" to script.id, "enabled" to enabled)
                )
                refresh()
            },
            onLongClick = { script -> confirmDelete(script) }
        )
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        setupLibrarySearch("搜索脚本名称或说明") { searchQuery = it; refresh() }
        refresh()
    }

    private fun refresh() {
        val list = store.all().filter { UiSearch.matches(searchQuery, it.name, it.description) }
        setPageSummary("${list.size} 个脚本 · ${list.count { it.enabled }} 个已开启")
        emptyView.text = if (searchQuery.isBlank()) getString(R.string.empty_scripts) else "未找到匹配的脚本"
        adapter.submit(list)
        emptyView.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        recycler.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
    }

    private val localScriptPicker = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri == null) return@registerForActivityResult
        runCatching {
            contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                ?: error("无法读取文件")
        }.onSuccess { src ->
            runCatching { store.addOrUpdate(src) }
                .onSuccess {
                    Toast.makeText(this, "已导入: ${it.name}", Toast.LENGTH_SHORT).show()
                    refresh()
                }
                .onFailure {
                    Toast.makeText(this, "导入失败: ${it.message}", Toast.LENGTH_LONG).show()
                }
        }.onFailure {
            Toast.makeText(this, "读取失败: ${it.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, R.string.add_script).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(0, 2, 1, R.string.install_from_url).setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        menu.add(0, 5, 2, "本地导入").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        menu.add(0, 3, 3, R.string.subscriptions).setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        menu.add(0, 4, 4, R.string.refresh_subs).setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            1 -> { showImportDialog(); true }
            2 -> { showInstallFromUrlDialog(); true }
            3 -> { showSubscriptionsDialog(); true }
            4 -> { refreshAllSubs(); true }
            5 -> { localScriptPicker.launch("*/*"); true }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun showImportDialog() {
        val input = DialogUi.styledEditText(
            this,
            hint = "粘贴 // ==UserScript== ... 完整源码",
            singleLine = false,
            minLines = 8,
            prefill = ""
        )
        DialogUi.material(this)
            .setTitle(R.string.add_script)
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val src = input.text?.toString().orEmpty()
                if (src.isBlank()) return@setPositiveButton
                runCatching { store.addOrUpdate(src) }
                    .onSuccess {
                        Toast.makeText(this, "已导入: ${it.name}", Toast.LENGTH_SHORT).show()
                        refresh()
                    }
                    .onFailure {
                        Toast.makeText(this, "导入失败: ${it.message}", Toast.LENGTH_LONG).show()
                    }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showInstallFromUrlDialog() {
        val input = DialogUi.styledEditText(this, "https://.../script.user.js", prefill = "")
        DialogUi.material(this)
            .setTitle(R.string.install_from_url)
            .setMessage("将下载 userscript 并自动加入订阅源。")
            .setView(DialogUi.wrap(this, input))
            .setPositiveButton("安装") { _, _ ->
                val url = input.text?.toString()?.trim().orEmpty()
                if (url.isBlank()) return@setPositiveButton
                Toast.makeText(this, "下载中…", Toast.LENGTH_SHORT).show()
                BrowserApp.instance.appScope.launch {
                    val result = store.installFromUrl(url)
                    withContext(Dispatchers.Main) {
                        result.onSuccess {
                            Toast.makeText(this@ScriptsActivity, "已安装: ${it.name}", Toast.LENGTH_LONG).show()
                            refresh()
                        }.onFailure {
                            Toast.makeText(this@ScriptsActivity, "安装失败: ${it.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showSubscriptionsDialog() {
        val subs = store.subscriptions()
        if (subs.isEmpty()) {
            Toast.makeText(this, "暂无订阅。请先从 URL 安装脚本。", Toast.LENGTH_LONG).show()
            return
        }
        val labels = subs.map {
            val err = if (it.lastError.isBlank()) "OK" else "ERR: ${it.lastError}"
            "${it.name.ifBlank { it.url }}\n${it.url}\n$err"
        }.toTypedArray()
        DialogUi.material(this)
            .setTitle(R.string.subscriptions)
            .setItems(labels) { _, which ->
                val sub = subs[which]
                DialogUi.material(this)
                    .setTitle(sub.name.ifBlank { "订阅" })
                    .setMessage(sub.url)
                    .setPositiveButton("更新") { _, _ ->
                        BrowserApp.instance.appScope.launch {
                            val r = store.refreshSubscription(sub.id)
                            withContext(Dispatchers.Main) {
                                r.onSuccess {
                                    Toast.makeText(this@ScriptsActivity, "已更新: ${it.name}", Toast.LENGTH_SHORT).show()
                                    refresh()
                                }.onFailure {
                                    Toast.makeText(this@ScriptsActivity, "更新失败: ${it.message}", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    }
                    .setNeutralButton("删除订阅") { _, _ ->
                        store.removeSubscription(sub.id)
                        Toast.makeText(this, "已删除订阅", Toast.LENGTH_SHORT).show()
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun refreshAllSubs() {
        val subs = store.subscriptions()
        if (subs.isEmpty()) {
            Toast.makeText(this, "暂无订阅", Toast.LENGTH_SHORT).show()
            return
        }
        Toast.makeText(this, "正在更新 ${subs.size} 个订阅…", Toast.LENGTH_SHORT).show()
        BrowserApp.instance.appScope.launch {
            val results = store.refreshAllSubscriptions()
            val ok = results.count { it.isSuccess }
            withContext(Dispatchers.Main) {
                Toast.makeText(this@ScriptsActivity, "订阅更新完成: $ok/${results.size}", Toast.LENGTH_LONG).show()
                refresh()
            }
        }
    }

    private fun confirmDelete(script: Userscript) {
        DialogUi.material(this)
            .setTitle("删除脚本")
            .setMessage("删除 ${script.name}？")
            .setPositiveButton("删除") { _, _ ->
                store.remove(script.id)
                refresh()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private class ScriptAdapter(
        val onToggle: (Userscript, Boolean) -> Unit,
        val onLongClick: (Userscript) -> Unit
    ) : RecyclerView.Adapter<ScriptAdapter.VH>() {
        private val data = mutableListOf<Userscript>()
        fun submit(list: List<Userscript>) {
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
            fun bind(s: Userscript) {
                title.text = s.name
                subtitle.text = s.description.ifBlank { s.matches.joinToString() }
                val src = s.updateUrl.ifBlank { s.downloadUrl }.ifBlank { "local" }
                meta.text = "v${s.version} · ${s.runAt} · $src"
                itemView.findViewById<android.widget.ImageView>(R.id.rowIcon).setImageResource(R.drawable.ic_code)
                toggle.visibility = View.VISIBLE
                toggle.setOnCheckedChangeListener(null)
                toggle.isChecked = s.enabled
                toggle.contentDescription = s.name
                toggle.setOnCheckedChangeListener { _, checked -> onToggle(s, checked) }
                itemView.setOnLongClickListener { onLongClick(s); true }
            }
        }
    }
}
