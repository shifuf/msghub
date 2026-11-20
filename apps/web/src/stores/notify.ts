import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { conversationsApi, dashboardApi, messagesApi, realtimeApi } from '@/api';
import { useAuthStore } from './auth';

export type NotifyItem = {
  id: string; title?: string; content?: string; status: string; channelType?: string;
  createdAt: string; updatedAt?: string; readAt?: string | null; archivedAt?: string | null;
  errorMessage?: string; project?: { id: string; name: string } | null;
  channel?: { id: string; name: string; type: string } | null; read?: boolean;
};

export type ConversationEventData = {
  kind: 'reply' | 'read' | 'status';
  messageId: string;
  replyId?: string;
  author?: 'admin' | 'device';
  reader?: 'admin' | 'device';
  count?: number;
  status?: 'open' | 'closed';
  createdAt?: string;
  deliveryStatus?: string;
};

export const useNotifyStore = defineStore('notify', () => {
  const items = ref<NotifyItem[]>([]);
  const pending = ref(0);
  const failed24h = ref(0);
  const connected = ref(false);
  const freshQueue = ref<NotifyItem[]>([]);
  const serverUnread = ref<number | null>(null);
  const conversationUnread = ref<number | null>(null);
  const conversationEvent = ref<(ConversationEventData & { sequence: number }) | null>(null);
  const unreadCount = computed(() => serverUnread.value ?? items.value.filter(i => !i.read).length);
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let cursor: string | undefined;
  let since: string | undefined;
  let generation = 0;
  let syncing: Promise<void> | null = null;
  const seenTransitions = new Map<string, string>();
  let conversationSequence = 0;
  let conversationSyncTimer: ReturnType<typeof setTimeout> | null = null;

  async function refreshConversationUnread() {
    const current = generation;
    try {
      const data: any = await conversationsApi.list({ status: 'all', page: 1, pageSize: 1 });
      if (current !== generation) return;
      if (typeof data.unreadCount === 'number') conversationUnread.value = data.unreadCount;
    } catch { /* Keep the last known count; periodic sync recovers after reconnect. */ }
  }

  function handleConversationEvent(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const data = value as ConversationEventData;
    if (!data.messageId || !['reply', 'read', 'status'].includes(data.kind)) return;
    conversationEvent.value = { ...data, sequence: ++conversationSequence };
    if (conversationSyncTimer) clearTimeout(conversationSyncTimer);
    conversationSyncTimer = setTimeout(() => {
      conversationSyncTimer = null;
      void refreshConversationUnread();
    }, 200);
  }

  function alert(item: NotifyItem) {
    freshQueue.value = [...freshQueue.value, { ...item }];
    try {
      if (typeof window === 'undefined' || !('Notification' in window)
        || localStorage.getItem('msg_desktop_notify') !== '1'
        || Notification.permission !== 'granted') return;
      if (item.status !== 'FAILED' && item.channelType) return;
      const notification = new Notification(item.title || (item.status === 'FAILED' ? '发送失败' : '站内通知'), {
        body: `${item.project?.name || '系统'} · ${item.errorMessage || item.content || '收到一条新消息'}`.slice(0, 200),
        tag: `msg-${item.status}-${item.id}`,
      });
      notification.onclick = () => { window.focus(); notification.close(); };
    } catch { /* Desktop notifications are optional. */ }
  }

  function upsertMessage(msg: NotifyItem, notify = false) {
    if (!msg?.id) return;
    const existing = items.value.find(i => i.id === msg.id);
    if (existing?.updatedAt && msg.updatedAt && msg.updatedAt < existing.updatedAt) return;
    const oldStatus = seenTransitions.get(msg.id) ?? existing?.status;
    const merged = { ...existing, ...msg };
    merged.read = !!merged.readAt;
    if (msg.archivedAt) items.value = items.value.filter(i => i.id !== msg.id);
    else if (existing) Object.assign(existing, merged);
    else items.value = [merged, ...items.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    seenTransitions.set(msg.id, msg.status);
    if (seenTransitions.size > 5000) seenTransitions.delete(seenTransitions.keys().next().value!);
    if (notify && !merged.read && !merged.archivedAt && oldStatus !== msg.status) alert(merged);
  }

  function counts(data: any) {
    pending.value = data.pending ?? pending.value;
    failed24h.value = data.failed24h ?? failed24h.value;
    if (typeof data.unreadCount === 'number') serverUnread.value = data.unreadCount;
  }

  async function bootstrap() {
    const current = generation;
    const data: any = await dashboardApi.notifications({ limit: 100 });
    if (current !== generation) return;
    items.value = [];
    for (const item of data.items || []) upsertMessage(item);
    cursor = data.nextCursor;
    since = data.serverTime;
    counts(data);
    await refreshConversationUnread();
  }

  function synchronize() {
    if (syncing) return syncing;
    const current = generation;
    syncing = (async () => {
      if (!cursor && !since) { await bootstrap(); return; }
      let more = true;
      let watermark: string | undefined;
      while (more && current === generation) {
        const data: any = await dashboardApi.notifications({ cursor, since: cursor ? undefined : since, limit: 100 });
        if (current !== generation) return;
        watermark ||= data.serverTime;
        for (const item of data.items || []) upsertMessage(item, true);
        counts(data);
        more = !!data.hasMore;
        if (more && (!data.nextCursor || data.nextCursor === cursor)) throw new Error('通知同步游标未前进');
        cursor = data.nextCursor || undefined;
        if (!more && watermark) since = new Date(new Date(watermark).getTime() - 1000).toISOString();
      }
      if (current === generation) await refreshConversationUnread();
    })().finally(() => { syncing = null; });
    return syncing;
  }

  function disconnectSse() { es?.close(); es = null; connected.value = false; }
  function retry(current: number) {
    if (current !== generation) return;
    disconnectSse();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { void connectSse(current); }, 5000);
  }
  async function connectSse(current: number) {
    disconnectSse();
    if (!useAuthStore().token || current !== generation) return;
    try {
      const result: any = await realtimeApi.ticket();
      if (current !== generation) return;
      const source = new EventSource(`/api/admin/realtime/stream?ticket=${encodeURIComponent(result.ticket)}`);
      es = source;
      source.addEventListener('message', (event) => {
        if (current !== generation) return;
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          if (payload.type === 'message') upsertMessage(payload.data, true);
          else if (payload.type === 'conversation') handleConversationEvent(payload.data);
        } catch { /* Polling reconciles malformed or missed events. */ }
      });
      source.onopen = async () => {
        try { await synchronize(); if (es === source) connected.value = true; }
        catch { retry(current); }
      };
      source.onerror = () => retry(current);
    } catch { retry(current); }
  }

  function consumeFresh() { const list = freshQueue.value.slice(); freshQueue.value = []; return list; }
  async function markRead(id: string) {
    const result: any = await messagesApi.markRead([id]);
    const item = items.value.find(i => i.id === id);
    if (item && !item.read) {
      item.readAt = result?.readAt || new Date().toISOString(); item.read = true;
      if (serverUnread.value !== null) serverUnread.value = Math.max(0, serverUnread.value - 1);
    }
  }
  async function markAllRead() {
    const ids = items.value.filter(i => !i.read).map(i => i.id);
    if (!ids.length) return;
    const result: any = await messagesApi.markRead(ids);
    for (const item of items.value) if (ids.includes(item.id)) { item.readAt = result?.readAt || new Date().toISOString(); item.read = true; }
    if (serverUnread.value !== null) serverUnread.value = Math.max(0, serverUnread.value - ids.length);
    freshQueue.value = [];
  }
  async function start() {
    stop();
    const current = generation;
    try { await bootstrap(); } catch { /* Polling retries bootstrap. */ }
    if (current !== generation) return;
    // Reconcile even while SSE is connected to recover missed cross-instance events.
    pollTimer = setInterval(() => { void synchronize().catch(() => {}); }, 12000);
    await connectSse(current);
  }
  function stop() {
    generation++;
    disconnectSse();
    if (pollTimer) clearInterval(pollTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pollTimer = null; reconnectTimer = null; syncing = null;
    cursor = undefined; since = undefined; freshQueue.value = []; seenTransitions.clear();
    if (conversationSyncTimer) clearTimeout(conversationSyncTimer);
    conversationSyncTimer = null;
    items.value = []; serverUnread.value = null; conversationUnread.value = null; conversationEvent.value = null;
  }
  return { items, pending, failed24h, unreadCount, conversationUnread, conversationEvent, connected, freshQueue, consumeFresh, markRead, markAllRead, start, stop, bootstrap, refreshConversationUnread };
});
