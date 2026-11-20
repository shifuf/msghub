<template>
  <section class="conversation-inbox">
    <div class="page-header inbox-title">
      <div>
        <div class="page-title">会话收件箱</div>
        <div class="page-subtitle">查看设备回复并直接继续处理</div>
      </div>
      <div class="inbox-total"><span v-if="unreadCount">{{ unreadCount }} 条设备未读</span><button type="button" :disabled="loading" @click="load">{{ loading ? '刷新中…' : '刷新' }}</button></div>
    </div>

    <p v-if="error" role="alert" class="inbox-error">{{ error }}</p>

    <div class="inbox-layout">
      <aside class="thread-panel" aria-label="会话列表">
        <div class="filter-row">
          <input v-model="filters.search" type="search" maxlength="128" placeholder="搜索标题或会话内容" aria-label="搜索会话" @keyup.enter="searchNow" />
          <select v-model="filters.status" aria-label="会话状态" @change="searchNow">
            <option value="open">处理中</option>
            <option value="closed">已关闭</option>
            <option value="all">全部状态</option>
          </select>
        </div>
        <label class="unread-filter"><input v-model="filters.unread" type="checkbox" @change="searchNow" />仅显示未读回复</label>

        <div v-if="loading && !items.length" class="thread-placeholder">正在加载会话…</div>
        <div v-else-if="!items.length" class="thread-placeholder">暂无会话。设备发来第一条回复后，会出现在这里。</div>
        <ul v-else class="thread-list">
          <li v-for="item in items" :key="item.messageId">
            <button type="button" class="thread-card" :class="{ selected: selectedId === item.messageId }" :aria-current="selectedId === item.messageId ? 'true' : undefined" @click="select(item.messageId)">
              <span class="thread-title-row"><strong>{{ item.title || '（无标题）' }}</strong><span v-if="item.unreadCount" class="thread-unread">{{ item.unreadCount }}</span></span>
              <span v-if="item.lastReply" class="thread-preview"><span>{{ item.lastReply.author === 'admin' ? '管理员' : '设备' }}：</span>{{ item.lastReply.content }}</span>
              <span class="thread-footer"><span>{{ item.status === 'closed' ? '已关闭' : '处理中' }}</span><time :datetime="item.activityAt">{{ formatTime(item.activityAt) }}</time></span>
            </button>
          </li>
        </ul>

        <div v-if="total > pageSize" class="page-controls" aria-label="会话分页">
          <button type="button" :disabled="loading || page <= 1" @click="changePage(page - 1)">上一页</button>
          <span>{{ page }} / {{ pageCount }}</span>
          <button type="button" :disabled="loading || page >= pageCount" @click="changePage(page + 1)">下一页</button>
        </div>
      </aside>

      <main class="detail-panel" aria-label="会话详情">
        <MessageConversation v-if="selectedId" :key="selectedId" :message-id="selectedId" />
        <div v-else class="detail-placeholder">选择一条会话以查看完整历史并回复设备。</div>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { conversationsApi } from '@/api';
import { useNotifyStore } from '@/stores/notify';
import { formatTime } from '@/utils/labels';
import MessageConversation from '@/components/MessageConversation.vue';

type ConversationListItem = {
  messageId: string;
  title: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  activityAt: string;
  unreadCount: number;
  lastReply: { id: string; author: string; content: string; createdAt: string } | null;
};

const route = useRoute();
const router = useRouter();
const notify = useNotifyStore();
const items = ref<ConversationListItem[]>([]);
const total = ref(0);
const unreadCount = ref<number | null>(notify.conversationUnread);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const error = ref('');
const selectedId = ref(typeof route.query.open === 'string' ? route.query.open : '');
const filters = reactive({ search: '', status: 'open' as 'open' | 'closed' | 'all', unread: false });
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
let timer: ReturnType<typeof setInterval> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let request = 0;

async function load() {
  const current = ++request;
  loading.value = true;
  error.value = '';
  try {
    const result: any = await conversationsApi.list({
      status: filters.status,
      ...(filters.unread ? { unread: true } : {}),
      ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      page: page.value,
      pageSize,
    });
    if (current !== request) return;
    items.value = result.items || [];
    total.value = result.total || 0;
    if (typeof result.unreadCount === 'number') unreadCount.value = result.unreadCount;
    const routeId = typeof route.query.open === 'string' ? route.query.open : '';
    if (routeId) selectedId.value = routeId;
    else if (items.value.length && !items.value.some(item => item.messageId === selectedId.value)) {
      selectedId.value = items.value[0].messageId;
    } else if (!items.value.length) {
      selectedId.value = '';
    }
  } catch (cause: any) {
    if (current === request) error.value = cause?.message || '会话列表加载失败';
  } finally {
    if (current === request) loading.value = false;
  }
}

function searchNow() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = undefined;
  page.value = 1;
  void load();
}
function changePage(value: number) {
  if (value < 1 || value > pageCount.value || value === page.value) return;
  page.value = value;
  void load();
}
function select(id: string) {
  selectedId.value = id;
  const query = { ...route.query, open: id };
  void router.replace({ query });
}

watch(() => notify.conversationEvent?.sequence, sequence => { if (sequence) void load(); });
watch(() => [filters.search, filters.status, filters.unread] as const, ([search, status, unread], previous) => {
  if (status !== previous?.[1] || unread !== previous?.[2]) {
    if (searchTimer) clearTimeout(searchTimer);
    searchNow();
    return;
  }
  if (searchTimer) clearTimeout(searchTimer);
  page.value = 1;
  searchTimer = setTimeout(() => { searchTimer = undefined; void load(); }, 250);
});
watch(() => notify.conversationUnread, value => { if (typeof value === 'number') unreadCount.value = value; });

onMounted(() => {
  void load();
  // Reconcile missed server events on the interval in addition to SSE updates.
  timer = setInterval(() => { if (!document.hidden) void load(); }, 10000);
});
onUnmounted(() => {
  request++;
  if (timer) clearInterval(timer);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<style scoped>
.conversation-inbox { display: grid; gap: 16px; }
.inbox-title { align-items: center; }
.inbox-total { display: flex; align-items: center; gap: 12px; color: #176b37; font-size: 13px; }
.inbox-total button, .page-controls button { border: 1px solid #aab5c3; background: var(--card-bg, #fff); border-radius: 8px; padding: 7px 11px; }
.inbox-total button:disabled, .page-controls button:disabled { opacity: .45; }
.inbox-layout { display: grid; grid-template-columns: minmax(280px, 390px) minmax(0, 1fr); gap: 16px; align-items: start; }
.thread-panel, .detail-panel { min-width: 0; border: 1px solid var(--border-color, #d9dde3); border-radius: 14px; background: var(--card-bg, #fff); }
.thread-panel { overflow: hidden; }
.filter-row { display: grid; grid-template-columns: minmax(0, 1fr) 128px; gap: 8px; padding: 12px 12px 8px; }
.filter-row input, .filter-row select { min-width: 0; border: 1px solid #aab5c3; background: transparent; border-radius: 8px; padding: 9px; color: inherit; font: inherit; }
.unread-filter { display: flex; align-items: center; gap: 8px; padding: 4px 14px 10px; color: #64748b; font-size: 12px; }
.unread-filter input { accent-color: #2563eb; }
.thread-list { list-style: none; margin: 0; padding: 0; max-height: min(68vh, 720px); overflow: auto; }
.thread-list li { margin: 0; }
.thread-card { display: grid; gap: 8px; width: 100%; padding: 13px 14px; text-align: left; border: 0; border-top: 1px solid var(--border-color, #e5e9ef); background: transparent; color: inherit; cursor: pointer; }
.thread-card:hover, .thread-card.selected { background: rgb(37 99 235 / 7%); }
.thread-title-row, .thread-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.thread-title-row strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.thread-unread { flex: 0 0 auto; min-width: 20px; border-radius: 999px; padding: 2px 6px; background: #2563eb; color: #fff; text-align: center; font-size: 11px; }
.thread-preview { overflow: hidden; color: #667085; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.thread-footer { color: #8a94a3; font-size: 11px; }
.page-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 12px; border-top: 1px solid var(--border-color, #e5e9ef); font-size: 12px; }
.page-controls button { padding: 6px 9px; }
.detail-panel { padding: 0 18px 16px; min-height: 300px; }
.detail-placeholder, .thread-placeholder { padding: 28px 18px; color: #8a94a3; text-align: center; font-size: 13px; }
.inbox-error { margin: 0; padding: 10px 12px; border-radius: 9px; background: rgb(220 38 38 / 8%); color: #c24141; }
@media (max-width: 800px) {
  .inbox-layout { grid-template-columns: 1fr; }
  .thread-list { max-height: 36vh; }
  .detail-panel { padding-inline: 12px; }
}
@media (max-width: 480px) {
  .inbox-title { align-items: flex-start; gap: 12px; }
  .inbox-total { flex-direction: column; align-items: flex-end; gap: 6px; font-size: 11px; }
  .filter-row { grid-template-columns: 1fr; }
}
</style>
