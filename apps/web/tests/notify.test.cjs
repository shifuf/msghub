const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const pinia = require('pinia');
const vue = require('vue');

function setup({ rows = [], markFailure = false, pages } = {}) {
  pinia.setActivePinia(pinia.createPinia());
  const marked = []; const urls = []; const requests = [];
  let source;
  class EventSource {
    constructor(url) { urls.push(url); source = this; this.listeners = {}; }
    addEventListener(type, cb) { this.listeners[type] = cb; }
    close() {}
    emit(data) { this.listeners.message?.({ data: JSON.stringify({ type: 'message', data }) }); }
  }
  const api = {
    dashboardApi: { notifications: async (params) => {
      requests.push(params);
      return pages ? pages(params) : { items: rows, pending: 0, failed24h: 0, nextCursor: 'snapshot', hasMore: false };
    } },
    realtimeApi: { ticket: async () => ({ ticket: 'short-ticket', expiresIn: 30 }) },
    messagesApi: { markRead: async (ids) => { if (markFailure) throw Error('offline'); marked.push(...ids); return { readAt: '2026-11-17T10:00:00Z' }; } },
  };
  const exports = {};
  const sourceText = fs.readFileSync(path.join(__dirname, '../src/stores/notify.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, {
    exports, console, setTimeout, clearTimeout, setInterval, clearInterval, EventSource,
    localStorage: { getItem: () => null, setItem: () => {} },
    require: (id) => id === 'pinia' ? pinia : id === 'vue' ? vue : id === '@/api' ? api : { useAuthStore: () => ({ token: 'long-secret' }) },
  });
  return { store: exports.useNotifyStore(), marked, urls, requests, source: () => source };
}
const row = { id: 'm1', status: 'PENDING', channelType: 'JPUSH', createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T08:00:00Z', readAt: null };

test('server readAt controls badge after bootstrap', async () => {
  const { store } = setup({ rows: [{ ...row, readAt: '2026-11-17T09:00:00Z' }] });
  await store.bootstrap(); assert.equal(store.unreadCount, 0);
});
test('markRead persists receipt before changing badge', async () => {
  const { store, marked } = setup({ rows: [row] });
  await store.bootstrap(); await store.markRead('m1');
  assert.deepEqual(marked, ['m1']); assert.equal(store.unreadCount, 0);
});
test('failed receipt keeps item unread', async () => {
  const { store } = setup({ rows: [row], markFailure: true });
  await store.bootstrap(); await assert.rejects(async () => store.markRead('m1'), /offline/);
  assert.equal(store.unreadCount, 1);
});
test('pending to failed alerts once and SSE uses a short ticket', async () => {
  const ctx = setup({ rows: [row] });
  try {
    await ctx.store.start(); await new Promise(setImmediate);
    assert.match(ctx.urls[0], /ticket=short-ticket/); assert.ok(!ctx.urls[0].includes('long-secret'));
    ctx.source().emit({ ...row, status: 'FAILED', updatedAt: '2026-11-17T09:00:00Z' });
    ctx.source().emit({ ...row, status: 'FAILED', updatedAt: '2026-11-17T09:00:00Z' });
    assert.equal(ctx.store.consumeFresh().length, 1);
  } finally { ctx.store.stop(); }
});
test('reconnect catch-up drains all cursor pages including old message updates', async () => {
  const ctx = setup({ pages: ({ cursor }) => !cursor
    ? { items: [row], nextCursor: 'c1', hasMore: false }
    : cursor === 'c1' ? { items: [{ ...row, status: 'FAILED' }], nextCursor: 'c2', hasMore: true }
    : { items: [{ ...row, id: 'm2' }], nextCursor: 'c3', hasMore: false } });
  try {
    await ctx.store.start(); await new Promise(setImmediate);
    await ctx.source().onopen();
    assert.equal(ctx.store.items.find(x => x.id === 'm1').status, 'FAILED');
    assert.ok(ctx.store.items.some(x => x.id === 'm2'));
    assert.ok(ctx.requests.some(x => x.cursor === 'c2'));
  } finally { ctx.store.stop(); }
});

test('timestamp watermark is used when backend cursor is null', async () => {
  const ctx = setup({ pages: ({ since }) => !since
    ? { items: [row], nextCursor: null, hasMore: false, serverTime: '2026-11-17T09:00:00Z' }
    : { items: [{ ...row, status: 'FAILED', updatedAt: '2026-11-17T09:01:00Z' }], nextCursor: null, hasMore: false, serverTime: '2026-11-17T09:01:00Z' } });
  try {
    await ctx.store.start(); await ctx.source().onopen();
    assert.equal(ctx.store.items[0].status, 'FAILED');
    assert.equal(ctx.requests[1].since, '2026-11-17T09:00:00Z');
  } finally { ctx.store.stop(); }
});
