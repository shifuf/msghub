package com.shifuf.prism.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.push.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal data class ConversationScreenState(
    val initialized: Boolean = false,
    val item: PushHistoryItem? = null,
    val conversation: Conversation? = null,
    val draft: String = "",
    val pending: PendingReply? = null,
    val loading: Boolean = false,
    val sending: Boolean = false,
    val error: String? = null,
    val receipt: String = "",
)

internal class ConversationViewModel(private val historyId: String) : ViewModel() {
    private val app = BrowserApp.instance
    private val prefs = app.prefs
    private val client = ConversationClient(prefs)
    private val mutable = MutableStateFlow(ConversationScreenState())
    val state = mutable.asStateFlow()
    private val network = Mutex()
    private val persistence = Mutex()
    private var sessionFile: ConversationSessionFile? = null

    init {
        viewModelScope.launch {
            try {
            val item = withContext(Dispatchers.IO) { app.pushHistory.get(historyId) }
            if (item == null) {
                mutable.value = ConversationScreenState(initialized = true, error = "这条本机消息已被删除")
                return@launch
            }
            val credentials = PushPayload.conversationFields(item.extras)
            val session = withContext(Dispatchers.IO) {
                app.pushHistory.markRead(item.id)
                if (credentials != null) {
                    sessionFile = prefs.conversationSession(item.receiptBase, credentials.messageId)
                    sessionFile!!.read()
                } else ConversationSession()
            }
            val receipt = withContext(Dispatchers.IO) { MsgPlatformClient.receiptStatus(prefs, item.extras, item.receiptBase) }
            mutable.value = ConversationScreenState(initialized = true, item = item, draft = session.draft,
                pending = session.pending, receipt = receipt)
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) {
                mutable.value = ConversationScreenState(initialized = true, error = "无法读取本机消息，请检查存储空间后重新打开")
            }
        }
    }

    fun updateDraft(value: String) {
        if (!mutable.value.initialized || mutable.value.draft == value) return
        mutable.update { it.copy(draft = value.take(4000)) }
        viewModelScope.launch {
            try { persist() }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { mutable.update { it.copy(error = "草稿暂时无法保存，请检查存储空间") } }
        }
    }

    private suspend fun persist() = persistence.withLock {
        withContext(Dispatchers.IO) {
            val current = mutable.value
            sessionFile?.write(ConversationSession(current.draft, current.pending))
        }
    }

    suspend fun refresh() {
        val item = mutable.value.item ?: return
        val receipt = withContext(Dispatchers.IO) {
            MsgPlatformClient.receiptStatus(prefs, item.extras, item.receiptBase)
        }
        mutable.update { it.copy(receipt = receipt) }
        val credentials = PushPayload.conversationFields(item.extras) ?: return
        if (!network.tryLock()) return
        try {
            mutable.update { it.copy(loading = true) }
            val result = client.load(credentials, item.receiptBase)
            mutable.update { current ->
                val accepted = current.pending?.clientId?.let { id -> result.replies.any { it.clientId == id } } == true
                current.copy(conversation = result, receipt = receipt, loading = false, error = null,
                    pending = if (accepted) null else current.pending)
            }
            persist()
            // Replies are locally read only after the authenticated server conversation was successfully loaded.
            withContext(Dispatchers.IO) {
                app.pushHistory.all().filter {
                    !it.read && it.receiptBase == item.receiptBase &&
                        PushPayload.conversationFields(it.extras)?.messageId == credentials.messageId &&
                        PushPayload.replyId(it.extras) in result.replies.map { reply -> reply.id }
                }.forEach { app.pushHistory.markRead(it.id) }
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { mutable.update { it.copy(error = e.message ?: "无法加载会话，请重试", loading = false) } }
        finally { mutable.update { it.copy(loading = false) }; network.unlock() }
    }

    fun send(retry: Boolean = false) {
        val current = mutable.value
        val item = current.item ?: return
        val credentials = PushPayload.conversationFields(item.extras) ?: return
        if (current.sending || current.conversation?.canReply == false) return
        val pending = if (retry) current.pending ?: return else {
            if (current.pending != null || current.conversation?.canReply != true || current.draft.isBlank()) return
            PendingReply.create(current.draft)
        }
        mutable.update { it.copy(pending = pending, draft = if (retry) it.draft else "", sending = true, error = null) }
        viewModelScope.launch {
            try {
                // Make recovery durable before any request can reach the server.
                persist()
                network.withLock {
                    val reply = client.reply(credentials, item.receiptBase, pending)
                    mutable.update { state ->
                        val conversation = state.conversation
                        state.copy(pending = null, sending = false, error = null,
                            conversation = conversation?.copy(replies = (conversation.replies + reply).distinctBy { it.id }))
                    }
                    persist()
                }
                refresh()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                mutable.update { it.copy(sending = false, error = e.message ?: "发送未确认，内容已保留") }
            }
        }
    }
}
