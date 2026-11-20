package com.shifuf.prism.ui

import android.content.Intent
import android.os.Bundle
import android.os.FileObserver
import android.provider.Settings
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButtonToggleGroup
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.R
import com.shifuf.prism.push.JPushHelper
import com.shifuf.prism.push.MsgPlatformClient
import com.shifuf.prism.push.PushHistoryItem
import com.shifuf.prism.push.PushNotifier
import com.shifuf.prism.push.PushPayload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PushHistoryActivity : PrismActivity() {
    private val store get() = BrowserApp.instance.pushHistory
    private val prefs get() = BrowserApp.instance.prefs
    private lateinit var recycler: RecyclerView
    private lateinit var emptyView: TextView
    private lateinit var statusView: TextView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var adapter: Adapter
    private var observer: FileObserver? = null
    private var refreshJob: Job? = null
    private var statusJob: Job? = null
    private var query = ""
    private var unreadOnly = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_message_center)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = "消息中心"
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }
        recycler = findViewById(R.id.recycler)
        emptyView = findViewById(R.id.emptyView)
        statusView = findViewById(R.id.messageStatus)
        swipe = findViewById(R.id.messageRefresh)
        adapter = Adapter(::openMessage, ::confirmDelete)
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter
        query = savedInstanceState?.getString("query").orEmpty()
        unreadOnly = savedInstanceState?.getBoolean("unread") ?: false
        findViewById<EditText>(R.id.messageSearch).apply {
            setText(query)
            doAfterTextChanged { query = it?.toString().orEmpty(); refresh() }
        }
        findViewById<MaterialButtonToggleGroup>(R.id.messageFilter).apply {
            check(if (unreadOnly) R.id.filterUnread else R.id.filterAll)
            addOnButtonCheckedListener { _, id, checked ->
                if (checked) { unreadOnly = id == R.id.filterUnread; refresh() }
            }
        }
        swipe.setColorSchemeColors(getColor(R.color.via_accent))
        swipe.setOnChildScrollUpCallback { _, _ -> recycler.canScrollVertically(-1) }
        swipe.setOnRefreshListener { synchronize() }
        statusView.setOnClickListener { showDiagnostics() }
        val inset = dp(UiLayoutPolicy.contentInset(resources.configuration.screenWidthDp))
        findViewById<View>(R.id.messageControls).setPadding(inset, 0, inset, 0)
        findViewById<ViewGroup>(android.R.id.content).getChildAt(0).addOnLayoutChangeListener { _, _, top, _, bottom, _, _, _, _ ->
            val compact = bottom - top < dp(460)
            findViewById<View>(R.id.pageHeading)?.visibility = if (compact) View.GONE else View.VISIBLE
            statusView.maxLines = if (compact) 1 else 4
            statusView.ellipsize = android.text.TextUtils.TruncateAt.END
        }
        handleOpenId(intent)
    }

    override fun onStart() {
        super.onStart()
        com.shifuf.prism.push.DevicePlatformClient.updateHeartbeat(this)
        observer = store.observe { refresh() }
        statusJob = lifecycleScope.launch {
            while (true) { refresh(); delay(5000) }
        }
        MsgPlatformClient.retryPending(prefs)
    }

    override fun onStop() {
        observer?.stopWatching(); observer = null
        statusJob?.cancel(); refreshJob?.cancel()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("query", query); outState.putBoolean("unread", unreadOnly)
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent); handleOpenId(intent); refresh()
    }

    private fun handleOpenId(intent: Intent?) {
        val id = intent?.getStringExtra(EXTRA_OPEN_ID).orEmpty()
        intent?.removeExtra(EXTRA_OPEN_ID)
        if (id.isNotBlank()) lifecycleScope.launch {
            val item = withContext(Dispatchers.IO) { store.get(id) }
            if (item != null) openMessage(item)
        }
    }

    private fun synchronize() {
        JPushHelper.recover(this)
        MsgPlatformClient.retryPending(prefs)
        refresh()
    }

    private fun refresh() {
        if (!::adapter.isInitialized) return
        refreshJob?.cancel()
        refreshJob = lifecycleScope.launch {
            val (all, pending) = withContext(Dispatchers.IO) {
                store.all() to runCatching { prefs.readReceiptQueue().pending().size }.getOrDefault(0)
            }
            val list = all.filter { (!unreadOnly || !it.read) && UiSearch.matches(query, it.title, it.content) }
            adapter.submit(list)
            emptyView.text = when {
                query.isNotBlank() -> "没有找到相关消息\n试试其他关键词"
                unreadOnly -> "未读消息已处理\n新消息会自动出现在这里"
                else -> "还没有消息\n收到通知后可在这里查看和回复"
            }
            emptyView.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
            recycler.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
            setPageHeading("消息中心", "${all.size} 条消息 · ${all.count { !it.read }} 条未读")
            val connection = when {
                !JPushHelper.isEnabled(this@PushHistoryActivity) -> "推送已暂停"
                JPushHelper.isConnected(this@PushHistoryActivity) -> "推送已连接"
                else -> "等待推送连接"
            }
            statusView.text = "$connection · ${PushNotifier.channelStatus(this@PushHistoryActivity)}" +
                if (pending > 0) "\n$pending 条已读回执待同步 · 点按诊断" else "\n点按查看通知设置与连接诊断"
            swipe.isRefreshing = false
        }
    }

    private fun openMessage(item: PushHistoryItem) {
        startActivity(Intent(this, ConversationActivity::class.java).putExtra(ConversationActivity.EXTRA_HISTORY_ID, item.id))
    }

    private fun showDiagnostics() {
        AlertDialog.Builder(this).setTitle("通知与连接")
            .setMessage(JPushHelper.diagnosticText(this) + "\n\n系统限制、未允许通知或关闭渠道会影响提醒。连接恢复后会继续同步已读回执。")
            .setPositiveButton("通知设置") { _, _ ->
                startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
            }
            .setNeutralButton("恢复连接") { _, _ -> synchronize() }
            .setNegativeButton("关闭", null).show()
    }

    private fun confirmDelete(item: PushHistoryItem) {
        AlertDialog.Builder(this).setTitle("删除这条本机消息？").setMessage("${item.title}\n服务器上的会话仍会保留。")
            .setPositiveButton("删除") { _, _ -> lifecycleScope.launch { withContext(Dispatchers.IO) { store.remove(item.id) }; refresh() } }
            .setNegativeButton(android.R.string.cancel, null).show()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 3, 0, "刷新").setIcon(R.drawable.ic_refresh).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(0, 1, 1, "全部标为已读")
        menu.add(0, 4, 2, "通知诊断")
        menu.add(0, 2, 3, "清空本机记录")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        1 -> { lifecycleScope.launch { withContext(Dispatchers.IO) { store.markAllRead() }; refresh()
            Toast.makeText(this@PushHistoryActivity, "已标为本机已读，回执将在联网后同步", Toast.LENGTH_SHORT).show() }; true }
        2 -> { AlertDialog.Builder(this).setTitle("清空本机消息？").setMessage("清空后无法在本机恢复记录。服务器上的会话仍会保留。")
            .setPositiveButton("清空") { _, _ -> lifecycleScope.launch { withContext(Dispatchers.IO) { store.clear() }; refresh() } }
            .setNegativeButton(android.R.string.cancel, null).show(); true }
        3 -> { swipe.isRefreshing = true; synchronize(); true }
        4 -> { showDiagnostics(); true }
        else -> super.onOptionsItemSelected(item)
    }

    private class Adapter(val onClick: (PushHistoryItem) -> Unit, val onLongClick: (PushHistoryItem) -> Unit) : RecyclerView.Adapter<Adapter.VH>() {
        private val data = ArrayList<PushHistoryItem>()
        private val fmt = SimpleDateFormat("MM-dd HH:mm", Locale.getDefault())
        init { setHasStableIds(true) }
        fun submit(list: List<PushHistoryItem>) { if (data == list) return; data.clear(); data.addAll(list); notifyDataSetChanged() }
        override fun getItemId(position: Int) = data[position].id.hashCode().toLong()
        override fun getItemCount() = data.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(LayoutInflater.from(parent.context).inflate(R.layout.item_push_history, parent, false))
        override fun onBindViewHolder(holder: VH, position: Int) = holder.bind(data[position])
        inner class VH(itemView: View) : RecyclerView.ViewHolder(itemView) {
            fun bind(item: PushHistoryItem) {
                itemView.findViewById<TextView>(R.id.title).text = item.title.ifBlank { "消息" }
                itemView.findViewById<TextView>(R.id.content).text = item.content.ifBlank { "无正文" }
                val type = if (PushPayload.conversationFields(item.extras) != null) "可回复" else "通知"
                itemView.findViewById<TextView>(R.id.meta).text = "${fmt.format(Date(item.receivedAt))} · $type · ${if (item.read) "本机已读" else "未读"}"
                itemView.findViewById<TextView>(R.id.unreadBadge).visibility = if (item.read) View.GONE else View.VISIBLE
                itemView.setOnClickListener { onClick(item) }; itemView.setOnLongClickListener { onLongClick(item); true }
            }
        }
    }

    companion object { const val EXTRA_OPEN_ID = "open_id"; const val EXTRA_OPEN_URL = "open_url" }
}
