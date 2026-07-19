import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { dashboardApi } from '@/api';
import { useAuthStore } from './auth';

export type NotifyItem = {
  id: string;
  title?: string;
  content?: string;
  status: string;
  channelType?: string;
  createdAt: string;
  errorMessage?: string;
  project?: { id: string; name: string } | null;
  channel?: { id: string; name: string; type: string } | null;
  read?: boolean;
};

const READ_IDS_KEY = 'msg_notify_read_ids';
const DESKTOP_NOTIFY_KEY = 'msg_desktop_notify';

export const useNotifyStore = defineStore('notify', () => {
  const items = ref<NotifyItem[]>([]);
  const pending = ref(0);
  const failed24h = ref(0);
  const connected = ref(false);
  const freshQueue = ref<NotifyItem[]>([]);
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const unreadCount = computed(() => items.value.filter((i) => !i.read).length);

  function loadReadIds(): Set<string> {
    try {
      const raw = localStorage.getItem(READ_IDS_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function saveReadIds(ids: Set<string>) {
    localStorage.setItem(READ_IDS_KEY, JSON.stringify(Array.from(ids).slice(-200)));
  }

  function showDesktopNotification(item: NotifyItem) {
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (localStorage.getItem(DESKTOP_NOTIFY_KEY) !== '1') return;
      if (Notification.permission !== 'granted') return;

      const isFail = item.status === 'FAILED';
      const isInbox = !item.channelType && !item.channel;
      const title =
        item.title || (isFail ? '发送失败' : isInbox ? '站内通知' : '新消息');
      const body = [
        item.project?.name || '系统',
        isFail
          ? item.errorMessage || item.content || '消息发送失败'
          : item.content || '收到一条新消息',
      ]
        .filter(Boolean)
        .join(' · ');

      const n = new Notification(title, {
        body: body.slice(0, 200),
        tag: `msg-${item.status}-${item.id}`,
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        n.close();
      };
    } catch {
      /* ignore desktop notify errors */
    }
  }

  function upsertMessage(msg: any, opts: { notify?: boolean } = {}) {
    if (!msg?.id) return;
    const readIds = loadReadIds();
    const existing = items.value.find((i) => i.id === msg.id);
    if (existing) {
      Object.assign(existing, msg, { read: existing.read || readIds.has(msg.id) });
      return;
    }
    const item: NotifyItem = {
      ...msg,
      read: readIds.has(msg.id),
    };
    items.value = [item, ...items.value].slice(0, 50);
    if (opts.notify && !item.read) {
      freshQueue.value = [...freshQueue.value, item];
      // 发送失败或纯站内收件时弹出系统通知
      if (item.status === 'FAILED' || !item.channelType) {
        showDesktopNotification(item);
      }
    }
  }

  function handleSsePayload(raw: string) {
    try {
      const ev = JSON.parse(raw);
      if (ev.type === 'message' && ev.data) {
        upsertMessage(ev.data, { notify: true });
      }
    } catch {
      /* ignore */
    }
  }

  async function bootstrap() {
    try {
      const data: any = await dashboardApi.notifications({ limit: 20 });
      const readIds = loadReadIds();
      items.value = (data?.items || []).map((m: any) => ({
        ...m,
        read: readIds.has(m.id),
      }));
      pending.value = data?.pending ?? 0;
      failed24h.value = data?.failed24h ?? 0;
    } catch (e) {
      console.debug('notify bootstrap failed', e);
    }
  }

  function connectSse() {
    disconnectSse();
    const auth = useAuthStore();
    if (!auth.token) return;

    const url = `/api/admin/realtime/stream?token=${encodeURIComponent(auth.token)}`;
    es = new EventSource(url);

    es.addEventListener('ready', () => {
      connected.value = true;
    });
    es.addEventListener('message', (e) => handleSsePayload(e.data));
    es.addEventListener('ping', () => {
      connected.value = true;
    });
    // 默认 message 事件（未指定 event 字段时）
    es.onmessage = (e) => handleSsePayload(e.data);

    es.onerror = () => {
      connected.value = false;
      disconnectSse();
      // SSE 断开后降级为轮询，并尝试重连
      startPollFallback();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connectSse();
      }, 5000);
    };

    es.onopen = () => {
      connected.value = true;
      stopPollFallback();
    };
  }

  function disconnectSse() {
    if (es) {
      es.close();
      es = null;
    }
  }

  function startPollFallback() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const newest = items.value[0]?.createdAt;
        const data: any = await dashboardApi.notifications({
          since: newest,
          limit: 20,
        });
        pending.value = data?.pending ?? pending.value;
        failed24h.value = data?.failed24h ?? failed24h.value;
        for (const m of data?.items || []) {
          const known = items.value.some((i) => i.id === m.id);
          upsertMessage(m, { notify: known ? false : true });
        }
      } catch {
        /* ignore */
      }
    }, 12000);
  }

  function stopPollFallback() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function consumeFresh(): NotifyItem[] {
    if (!freshQueue.value.length) return [];
    const list = freshQueue.value.slice();
    freshQueue.value = [];
    return list;
  }

  function markRead(id: string) {
    const readIds = loadReadIds();
    readIds.add(id);
    saveReadIds(readIds);
    const it = items.value.find((i) => i.id === id);
    if (it) it.read = true;
  }

  function markAllRead() {
    const readIds = loadReadIds();
    for (const i of items.value) {
      i.read = true;
      readIds.add(i.id);
    }
    saveReadIds(readIds);
    freshQueue.value = [];
  }

  async function start() {
    stop();
    await bootstrap();
    connectSse();
  }

  function stop() {
    disconnectSse();
    stopPollFallback();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connected.value = false;
  }

  return {
    items,
    pending,
    failed24h,
    unreadCount,
    connected,
    freshQueue,
    consumeFresh,
    markRead,
    markAllRead,
    start,
    stop,
    bootstrap,
  };
});
