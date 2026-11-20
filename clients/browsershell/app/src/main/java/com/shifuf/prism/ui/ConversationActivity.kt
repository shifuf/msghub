package com.shifuf.prism.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Typeface
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.FileObserver
import android.view.Gravity
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.widget.doAfterTextChanged
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.MainActivity
import com.shifuf.prism.R
import com.shifuf.prism.push.ConversationReply
import com.shifuf.prism.push.PendingReply
import com.shifuf.prism.push.PushPayload
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class ConversationActivity : PrismActivity() {
    private lateinit var model: ConversationViewModel
    private lateinit var original: TextView
    private lateinit var status: TextView
    private lateinit var retry: MaterialButton
    private lateinit var input: EditText
    private lateinit var send: MaterialButton
    private lateinit var recycler: RecyclerView
    private lateinit var adapter: ReplyAdapter
    private var observer: FileObserver? = null
    private var renderingDraft = false
    private var draftHydrated = false
    private var originalText = ""
    private var compactLayout = false
    private var contentRoot: View? = null
    private val visibleFrame = Rect()
    private val viewportListener = ViewTreeObserver.OnGlobalLayoutListener { updateViewport() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_conversation)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = "消息会话"
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }
        original = findViewById(R.id.conversationOriginal)
        status = findViewById(R.id.conversationStatus)
        retry = findViewById(R.id.conversationRetry)
        input = findViewById(R.id.conversationInput)
        input.isEnabled = false
        send = findViewById(R.id.conversationSend)
        recycler = findViewById(R.id.recycler)
        model = ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                ConversationViewModel(intent.getStringExtra(EXTRA_HISTORY_ID).orEmpty()) as T
        })[ConversationViewModel::class.java]
        adapter = ReplyAdapter { model.send(retry = true) }
        recycler.layoutManager = LinearLayoutManager(this).apply { stackFromEnd = true }
        recycler.adapter = adapter
        input.doAfterTextChanged { if (!renderingDraft) model.updateDraft(it?.toString().orEmpty()) }
        send.setOnClickListener {
            model.send()
            // Clear only for this explicit accepted send action. Status/poll collectors must
            // never write an older draft snapshot into the active IME editing buffer.
            if (model.state.value.sending && model.state.value.draft.isEmpty()) applyDraft("")
        }
        retry.setOnClickListener {
            if (model.state.value.pending != null) model.send(retry = true)
            else lifecycleScope.launch { model.refresh() }
        }
        original.setOnClickListener { showOriginal() }
        val inset = dp(UiLayoutPolicy.contentInset(resources.configuration.screenWidthDp))
        listOf(R.id.conversationStatusBar, R.id.conversationComposer).forEach { id ->
            findViewById<View>(id).apply { setPadding(inset, paddingTop, inset, paddingBottom) }
        }
        (original.layoutParams as ViewGroup.MarginLayoutParams).apply { marginStart = inset; marginEnd = inset }
        contentRoot = findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        contentRoot?.viewTreeObserver?.addOnGlobalLayoutListener(viewportListener)
        status.ellipsize = android.text.TextUtils.TruncateAt.END
        status.setOnClickListener {
            AlertDialog.Builder(this).setTitle("会话状态").setMessage(status.text).setPositiveButton("关闭", null).show()
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { model.state.collect { render(it) } }
                launch {
                    while (!model.state.value.initialized) delay(100)
                    while (true) { model.refresh(); delay(12000) }
                }
            }
        }
    }

    override fun onPostCreate(savedInstanceState: Bundle?) {
        super.onPostCreate(savedInstanceState)
        findViewById<MaterialToolbar>(R.id.toolbar).setTitleTextAppearance(this, R.style.PrismConversationToolbarTitle)
        updateViewport()
    }

    private fun updateViewport() {
        val root = contentRoot ?: return
        root.getWindowVisibleDisplayFrame(visibleFrame)
        val imeVisible = ViewCompat.getRootWindowInsets(root)?.isVisible(WindowInsetsCompat.Type.ime()) == true
        val usableHeight = minOf(visibleFrame.height(), root.height - root.paddingTop - root.paddingBottom)
        val keyboardOcclusion = root.rootView.height - visibleFrame.bottom > dp(120)
        val compact = imeVisible || keyboardOcclusion || usableHeight in 1 until dp(420)
        if (compactLayout == compact) return
        compactLayout = compact
        original.visibility = if (compact) View.GONE else View.VISIBLE
        status.maxLines = if (compact) 2 else 6
        status.setPadding(status.paddingLeft, dp(if (compact) 4 else 12), status.paddingRight, dp(if (compact) 4 else 12))
        input.maxLines = if (compact) 3 else 5
    }

    private fun applyDraft(value: String) {
        if (input.text.toString() == value) return
        renderingDraft = true
        input.setText(value)
        input.setSelection(input.length())
        renderingDraft = false
    }

    override fun onDestroy() {
        contentRoot?.viewTreeObserver?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(viewportListener)
        super.onDestroy()
    }

    override fun onStart() {
        super.onStart()
        observer = BrowserApp.instance.pushHistory.observe {
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) lifecycleScope.launch { model.refresh() }
        }
    }

    override fun onStop() { observer?.stopWatching(); observer = null; super.onStop() }

    private fun render(state: ConversationScreenState) {
        if (!state.initialized) { status.text = "正在打开消息…"; send.isEnabled = false; return }
        val item = state.item
        val hasConversation = item?.let { PushPayload.conversationFields(it.extras) } != null
        val title = state.conversation?.title ?: item?.title.orEmpty()
        originalText = state.conversation?.content ?: item?.content.orEmpty()
        original.text = "$title\n${originalText.ifBlank { "无正文" }}"
        original.contentDescription = "$title，点按查看完整消息"
        findViewById<View>(R.id.conversationComposer).visibility = if (hasConversation) View.VISIBLE else View.GONE
        status.text = when {
            item == null -> state.error ?: "消息不存在"
            !hasConversation -> "${state.receipt}\n此历史通知不含会话凭证，暂不支持回复。新版本平台发送的消息可开启会话。"
            state.sending -> "正在发送…\n${state.receipt}"
            state.error != null -> "${state.error}\n${state.receipt}"
            state.pending != null -> "上次回复尚未确认，点按重试\n${state.receipt}"
            state.conversation?.canReply == false -> "此会话已关闭回复\n${state.receipt}"
            state.loading && state.conversation == null -> "正在加载会话…\n${state.receipt}"
            state.conversation != null -> "${state.receipt} · 前台自动刷新\n显示最近 100 条回复"
            else -> "等待加载会话"
        }
        status.setTextColor(getColor(if (state.error != null) R.color.via_danger else R.color.via_text_secondary))
        retry.visibility = if (hasConversation && !state.sending && (state.error != null || state.pending != null)) View.VISIBLE else View.GONE
        if (!draftHydrated) {
            applyDraft(state.draft)
            draftHydrated = true
        }
        input.isEnabled = hasConversation && state.conversation?.canReply != false
        send.isEnabled = state.conversation?.canReply == true && state.draft.isNotBlank() && !state.sending && state.pending == null
        send.text = if (state.sending) "发送中" else "发送"
        val nearBottom = !recycler.canScrollVertically(1)
        val changed = adapter.submit(state.conversation?.replies.orEmpty(), state.pending, state.sending)
        if (changed && nearBottom && adapter.itemCount > 0) recycler.scrollToPosition(adapter.itemCount - 1)
    }

    private fun showOriginal() {
        val item = model.state.value.item ?: return
        AlertDialog.Builder(this).setTitle(model.state.value.conversation?.title ?: item.title)
            .setMessage(originalText.ifBlank { "无正文" }).setPositiveButton("关闭", null)
            .setNeutralButton("复制内容") { _, _ ->
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("消息", originalText))
                Toast.makeText(this, "已复制", Toast.LENGTH_SHORT).show()
            }.show()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "刷新").setIcon(R.drawable.ic_refresh).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(0, 2, 1, "查看完整消息")
        menu.add(0, 3, 2, "打开消息链接")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        1 -> { lifecycleScope.launch { model.refresh() }; true }
        2 -> { showOriginal(); true }
        3 -> {
            val url = model.state.value.item?.let { PushPayload.openUrl(it.extras) }
            if (url == null) Toast.makeText(this, "此消息没有可打开的链接", Toast.LENGTH_SHORT).show()
            else startActivity(Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(MainActivity.EXTRA_OPEN_URL, url))
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    private class ReplyAdapter(private val retry: () -> Unit) : RecyclerView.Adapter<ReplyAdapter.Holder>() {
        data class Row(val id: String, val content: String, val device: Boolean, val meta: String, val failed: Boolean = false)
        private var rows = emptyList<Row>()
        private val format = DateTimeFormatter.ofPattern("MM-dd HH:mm").withZone(ZoneId.systemDefault())
        fun submit(replies: List<ConversationReply>, pending: PendingReply?, sending: Boolean): Boolean {
            val next = replies.map { reply ->
                val time = runCatching { format.format(Instant.parse(reply.createdAt)) }.getOrDefault(reply.createdAt)
                val label = if (reply.author == "device") { if (reply.readAt != null) "管理员已读" else "已发送" } else "管理员"
                Row(reply.id, reply.content, reply.author == "device", "$time · $label")
            } + listOfNotNull(pending?.let { Row(it.clientId, it.content, true, if (sending) "发送中…" else "发送未确认 · 点按重试", !sending) })
            if (rows == next) return false
            rows = next; notifyDataSetChanged(); return true
        }
        override fun getItemCount() = rows.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val context = parent.context
            fun dp(n: Int) = (n * context.resources.displayMetrics.density).toInt()
            val root = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                setPadding(0, dp(5), 0, dp(9))
            }
            val bubble = TextView(context).apply { textSize = 16f; setTextIsSelectable(true); setPadding(dp(16), dp(12), dp(16), dp(12)); setLineSpacing(dp(3).toFloat(), 1f) }
            val meta = TextView(context).apply { textSize = 12f; setPadding(dp(4), dp(7), dp(4), dp(2)); minHeight = dp(24) }
            root.addView(bubble); root.addView(meta)
            return Holder(root, bubble, meta)
        }
        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(rows[position])
        inner class Holder(val root: LinearLayout, val bubble: TextView, val meta: TextView) : RecyclerView.ViewHolder(root) {
            fun bind(row: Row) {
                val context = root.context
                val dp = context.resources.displayMetrics.density
                root.gravity = if (row.device) Gravity.END else Gravity.START
                bubble.maxWidth = ((context.resources.displayMetrics.widthPixels - 64 * dp) * .87f).toInt().coerceAtMost((640 * dp).toInt())
                bubble.text = row.content
                bubble.setTextColor(context.getColor(R.color.via_text))
                bubble.background = GradientDrawable().apply {
                    cornerRadius = 18 * dp
                    setColor(context.getColor(if (row.device) R.color.via_accent_soft else R.color.via_card))
                }
                bubble.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                meta.text = row.meta
                meta.setTextColor(context.getColor(if (row.failed) R.color.via_danger else R.color.via_text_secondary))
                meta.setTypeface(null, if (row.failed) Typeface.BOLD else Typeface.NORMAL)
                meta.isClickable = row.failed; meta.isFocusable = row.failed
                meta.minHeight = if (row.failed) (48 * dp).toInt() else (24 * dp).toInt()
                meta.setOnClickListener(if (row.failed) View.OnClickListener { retry() } else null)
                meta.contentDescription = if (row.failed) "发送未确认，重试此回复" else row.meta
            }
        }
    }

    companion object { const val EXTRA_HISTORY_ID = "history_id" }
}
