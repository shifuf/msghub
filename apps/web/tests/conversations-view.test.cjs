const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');

function setup(results = [{ items: [], total: 0, page: 1, pageSize: 20, unreadCount: 0 }]) {
  const { descriptor } = parse(fs.readFileSync(path.join(__dirname, '../src/views/ConversationsView.vue'), 'utf8'));
  const script = compileScript(descriptor, { id: 'conversations-view' }).content;
  const exports = {};
  const requests = [];
  const routes = { query: {} };
  const notifications = vue.reactive({ conversationUnread: 0, conversationEvent: null });
  let index = 0;
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, {
    exports, console, document: { hidden: false }, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    require: id => id === 'vue' ? { ...vue, onMounted() {}, onUnmounted() {} }
      : id === 'vue-router' ? { useRoute: () => routes, useRouter: () => ({ replace: async value => { routes.query = value.query; } }) }
        : id === '@/api' ? { conversationsApi: { list: async params => { requests.push({ ...params }); return results[Math.min(index++, results.length - 1)]; } } }
          : id === '@/stores/notify' ? { useNotifyStore: () => notifications }
            : id === '@/utils/labels' ? { formatTime: value => value || '-' }
              : id === '@/components/MessageConversation.vue' ? { default: {} } : {},
  });
  const component = exports.default.setup({}, { expose() {} });
  return { component, requests, routes, notifications };
}

test('inbox sends status, search, unread and pagination filters and selects the first result', async () => {
  const first = { messageId: 'm1', title: 'First', status: 'open', closedAt: null, activityAt: '2026-11-20T10:00:00.000Z', unreadCount: 2, lastReply: null };
  const second = { messageId: 'm2', title: 'Second', status: 'open', closedAt: null, activityAt: '2026-11-19T10:00:00.000Z', unreadCount: 0, lastReply: null };
  const { component, requests, routes } = setup([
    { items: [first, second], total: 40, page: 1, pageSize: 20, unreadCount: 2 },
    { items: [first], total: 40, page: 1, pageSize: 20, unreadCount: 2 },
    { items: [second], total: 40, page: 2, pageSize: 20, unreadCount: 2 },
  ]);

  await component.load();
  assert.deepEqual(requests[0], { status: 'open', page: 1, pageSize: 20 });
  assert.equal(component.selectedId.value, 'm1');
  assert.equal(component.pageCount.value, 2);

  component.filters.search = 'First';
  component.filters.unread = true;
  component.filters.status = 'all';
  await vue.nextTick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests[1], { status: 'all', unread: true, search: 'First', page: 1, pageSize: 20 });

  component.select('m2');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(routes.query.open, 'm2');
  await component.changePage(2);
  assert.deepEqual(requests[2], { status: 'all', unread: true, search: 'First', page: 2, pageSize: 20 });
  assert.equal(component.selectedId.value, 'm2');
});

test('a new conversation event refreshes the list and keeps its authoritative unread count', async () => {
  const { component, requests, notifications } = setup([
    { items: [], total: 0, page: 1, pageSize: 20, unreadCount: 0 },
    { items: [], total: 0, page: 1, pageSize: 20, unreadCount: 1 },
  ]);
  await component.load();
  notifications.conversationUnread = 1;
  notifications.conversationEvent = { kind: 'reply', messageId: 'm2', author: 'device', sequence: 1 };
  await vue.nextTick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(component.unreadCount.value, 1);
});
