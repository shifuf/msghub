<template>
  <section class="conversation" aria-label="设备会话">
    <div class="conversation-heading">
      <div><h3>设备会话</h3><p>分页查看回复 · 每 10 秒刷新</p></div>
      <div class="conversation-actions">
        <span v-if="conversation" :class="['conversation-status', conversation.status === 'closed' ? 'status-closed' : 'status-open']">{{ conversation.status === 'closed' ? '已关闭' : '处理中' }}</span>
        <button v-if="conversation?.canReply" type="button" :disabled="loading || changingStatus" @click="toggleStatus">{{ changingStatus ? '处理中…' : conversation.status === 'closed' ? '重新打开' : '关闭会话' }}</button>
        <button type="button" :disabled="loading" @click="refresh">{{ loading ? '刷新中…' : '刷新' }}</button>
      </div>
    </div>
    <p v-if="error" role="alert" class="conversation-error">{{ error }}</p>
    <p v-if="notice" role="status" class="conversation-note">{{ notice }}</p>
    <template v-if="conversation">
      <div v-if="conversation.title || conversation.content" class="original-notice">
        <strong>{{ conversation.title || '原始通知' }}</strong>
        <p v-if="conversation.content">{{ conversation.content }}</p>
      </div>
      <p v-if="!conversation.canReply" class="conversation-note">这条旧通知没有会话凭证，请向设备发送新版通知后再回复。</p>
      <ol v-else class="conversation-history" aria-label="回复记录">
        <li v-if="!conversation.replies.length" class="conversation-empty">暂无回复。设备收到通知后可在消息详情中发起会话。</li>
        <li v-if="conversation.hasOlder" class="conversation-older"><button type="button" :disabled="loadingOlder" @click="loadOlder">{{ loadingOlder ? '加载中…' : '加载更早回复' }}</button></li>
        <li v-for="reply in conversation.replies" :key="reply.id" :class="['conversation-reply', { 'from-admin': reply.author === 'admin' }]">
          <div class="reply-meta">{{ reply.author === 'admin' ? '管理员' : '设备' }} · {{ time(reply.createdAt) }}</div>
          <p class="reply-content">{{ reply.content }}</p>
          <div class="reply-meta">{{ reply.readAt ? `对方已读 · ${time(reply.readAt)}` : '对方未读' }}<span v-if="reply.author === 'admin'"> · {{ deliveryLabel(reply.deliveryStatus) }}</span></div>
          <p v-if="reply.deliveryError" class="conversation-error">{{ reply.deliveryError }}</p>
        </li>
      </ol>
      <form v-if="conversation.canReply" class="conversation-form" @submit.prevent="send">
        <label for="conversation-draft">回复设备</label>
        <p v-if="conversation.status === 'closed' && !pending" class="conversation-note">会话已关闭。重新打开后可继续回复。</p>
        <textarea id="conversation-draft" v-model="draft" rows="3" maxlength="4000" :disabled="sending || !!pending || conversation.status === 'closed'" placeholder="输入回复，最多 4000 字" />
        <p v-if="pending">上次提交尚未确认。重试将核对同一条回复；确认后可继续编辑新回复。</p>
        <div class="conversation-heading"><span>{{ draft.trim().length }} / 4000</span><button type="submit" :disabled="sending || !draft.trim() || (conversation.status === 'closed' && !pending)">{{ sending ? '发送中…' : pending ? '重试发送' : conversation.status === 'closed' ? '会话已关闭' : '发送回复' }}</button></div>
        <p>推送受理表示极光接受请求，设备是否已读以会话回执为准。</p>
      </form>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { conversationsApi, messagesApi } from '@/api';
import { useNotifyStore } from '@/stores/notify';

const props = defineProps<{ messageId: string }>();
type Reply = { id: string; author: string; content: string; createdAt: string; readAt: string | null; deliveryStatus: string; deliveryError: string | null };
const conversation = ref<{ canReply: boolean; title?: string; content?: string; replies: Reply[]; status: 'open' | 'closed'; closedAt: string | null; hasOlder: boolean; nextCursor: string | null } | null>(null);
const loading = ref(false);
const loadingOlder = ref(false);
const changingStatus = ref(false);
const sending = ref(false);
const draft = ref('');
const error = ref('');
const notice = ref('');
const pending = ref<{ content: string; clientId: string } | null>(null);
const storageKey = `msghub:conversation-draft:${props.messageId}`;
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (saved && typeof saved.draft === 'string') draft.value = saved.draft.slice(0, 4000);
  if (saved?.pending && typeof saved.pending.content === 'string' && /^[0-9a-f-]{36}$/i.test(saved.pending.clientId)) pending.value = saved.pending;
} catch { /* Storage may be disabled; the current draft remains in memory. */ }
function saveDraft() {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ draft: draft.value, pending: pending.value })); }
  catch { /* Continue in memory without blocking reply submission. */ }
}
watch(draft, saveDraft, { flush: 'sync' });
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
const notify = useNotifyStore();
watch(() => notify.conversationEvent?.messageId === props.messageId ? notify.conversationEvent.sequence : null, sequence => { if (sequence) void refresh(); });

function time(value: string) { return new Date(value).toLocaleString(); }
function deliveryLabel(status: string) {
  return ({ PENDING: '推送处理中', ACCEPTED: '推送已受理', FAILED: '推送失败，回复已保存', UNCERTAIN: '送达待核实' } as Record<string, string>)[status] || '已保存';
}

async function refresh() {
  if (loading.value || disposed) return;
  loading.value = true;
  try {
    const result = await messagesApi.conversation(props.messageId, { limit: 50 });
    if (!disposed) {
      const previous = conversation.value;
      const merged = new Map([...(previous?.replies || []), ...result.replies].map(reply => [reply.id, reply]));
      result.replies = [...merged.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
      if (previous?.hasOlder && previous.nextCursor) { result.hasOlder = true; result.nextCursor = previous.nextCursor; }
      conversation.value = result;
    }
  } catch (cause: any) {
    if (!disposed) error.value = cause?.status === 404 ? '服务端尚未升级会话接口，或消息已被清理。' : cause?.message || '会话刷新失败';
  } finally { loading.value = false; }
}

async function loadOlder() {
  if (loadingOlder.value || loading.value || !conversation.value?.hasOlder || !conversation.value.nextCursor || disposed) return;
  loadingOlder.value = true;
  error.value = '';
  try {
    const result = await messagesApi.conversation(props.messageId, { before: conversation.value.nextCursor, limit: 50 });
    if (disposed || !conversation.value) return;
    const merged = new Map([...result.replies, ...conversation.value.replies].map(reply => [reply.id, reply]));
    conversation.value.replies = [...merged.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
    conversation.value.hasOlder = result.hasOlder;
    conversation.value.nextCursor = result.nextCursor;
  } catch (cause: any) {
    if (!disposed) error.value = cause?.message || '更早的回复加载失败';
  } finally { loadingOlder.value = false; }
}

async function toggleStatus() {
  if (changingStatus.value || !conversation.value) return;
  changingStatus.value = true;
  error.value = '';
  try {
    const status = conversation.value.status === 'closed' ? 'open' : 'closed';
    const result = await conversationsApi.update(props.messageId, { status });
    if (disposed) return;
    conversation.value.status = result.status;
    conversation.value.closedAt = result.closedAt;
    notice.value = result.status === 'closed' ? '会话已关闭。' : '会话已重新打开。';
  } catch (cause: any) {
    if (!disposed) error.value = cause?.message || '会话状态更新失败';
  } finally { changingStatus.value = false; }
}

async function send() {
  const content = pending.value?.content || draft.value.trim();
  if (sending.value || !content || content.length > 4000 || !conversation.value?.canReply) return;
  sending.value = true;
  error.value = '';
  notice.value = '';
  if (!pending.value) pending.value = { content, clientId: crypto.randomUUID() };
  saveDraft();
  try {
    const reply = await messagesApi.reply(props.messageId, pending.value);
    if (disposed) return;
    draft.value = '';
    pending.value = null;
    saveDraft();
    notice.value = reply.deliveryError ? `回复已保存。${reply.deliveryError}` : `回复已保存，${deliveryLabel(reply.deliveryStatus)}。`;
    await refresh();
  } catch (cause: any) {
    if (!disposed) error.value = `${cause?.message || '发送失败'}。文本已保留，可重试。`;
  } finally { sending.value = false; }
}

function updatePolling() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (!document.hidden && !disposed) {
    void refresh();
    timer = setInterval(() => { void refresh(); }, 10000);
  }
}
onMounted(() => { document.addEventListener('visibilitychange', updatePolling); updatePolling(); });
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', updatePolling); });
</script>

<style scoped>
.conversation { margin-top: 24px; border-top: 1px solid var(--border-color, #d9dde3); padding-top: 20px; }
.conversation-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.conversation-actions { display: flex; align-items: center; gap: 8px; }
.conversation-status { border-radius: 999px; padding: 3px 8px; font-size: 11px; }
.status-open { background: rgb(22 163 74 / 12%); color: #17803d; }
.status-closed { background: rgb(100 116 139 / 13%); color: #64748b; }
.conversation-older { display: flex; justify-content: center; margin: 12px 0; }
h3 { font-size: 17px; font-weight: 650; margin: 0; }
.conversation-heading p, .conversation-form > p, .reply-meta { font-size: 12px; opacity: .68; margin: 4px 0; }
button { border: 1px solid #8e9cb0; border-radius: 9px; padding: 7px 12px; flex-shrink: 0; }
button:disabled { opacity: .5; cursor: default; }
.conversation-history { list-style: none; padding: 0; max-height: 420px; overflow-y: auto; margin: 16px 0; }
.original-notice { margin: 14px 0; padding: 12px; border-radius: 11px; background: rgb(127 127 127 / 7%); overflow-wrap: anywhere; }
.original-notice p { white-space: pre-wrap; margin: 6px 0 0; font-size: 13px; }
.conversation-reply { margin: 10px 24px 10px 0; padding: 12px; border-radius: 14px; background: rgb(127 127 127 / 10%); overflow-wrap: anywhere; }
.from-admin { margin: 10px 0 10px 24px; background: rgb(55 126 246 / 12%); }
.reply-content { white-space: pre-wrap; margin: 5px 0 8px; }
.conversation-form { display: grid; gap: 8px; }
textarea { resize: vertical; width: 100%; border: 1px solid #8e9cb0; border-radius: 10px; background: transparent; padding: 10px; font: inherit; }
.conversation-error { color: #cf4141; font-size: 13px; overflow-wrap: anywhere; }
.conversation-note, .conversation-empty { font-size: 13px; opacity: .8; padding: 10px 0; }
@media (prefers-color-scheme: dark) { .conversation-error { color: #ff9c9c; } }
</style>
