const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');
function setup(storage = new Map(), result = { id: 'r1', deliveryStatus: 'FAILED', deliveryError: 'channel disabled' }) {
  const { descriptor } = parse(fs.readFileSync(path.join(__dirname, '../src/components/MessageConversation.vue'), 'utf8'));
  const script = compileScript(descriptor, { id: 'conversation' }).content;
  const exports = {}; const sends = []; const historyRequests = []; const updates = []; let fail = true;
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, {
    exports, console, sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, crypto: require('node:crypto').webcrypto, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, setInterval: () => 1, clearInterval() {},
    require: id => id === 'vue' ? { ...vue, onMounted() {}, onUnmounted() {} } : id === '@/api' ? { messagesApi: {
      conversation: async (messageId, params) => {
        historyRequests.push({ messageId, params });
        const replies = params?.before ? [{ id: 'r1', author: 'device', content: 'oldest' }] : [{ id: 'r2', author: 'device', content: 'middle' }, { id: 'r3', author: 'admin', content: 'latest' }];
        return { canReply: true, replies, status: 'open', hasOlder: !params?.before, nextCursor: params?.before ? null : 'r2' };
      },
      reply: async (id, payload) => { sends.push({ id, payload: { ...payload } }); if (fail) throw new Error('offline'); return result; },
    }, conversationsApi: { update: async (id, data) => { updates.push({ id, data: { ...data } }); return { messageId: id, status: data.status, closedAt: data.status === 'closed' ? '2026-11-20T00:00:00.000Z' : null }; } } } : id === '@/stores/notify' ? { useNotifyStore: () => ({ conversationEvent: null }) } : {},
  });
  const component = exports.default.setup({ messageId: 'm1' }, { expose() {} });
  return { component, sends, updates, historyRequests, online: () => { fail = false; } };
}
test('failed admin submission retains text and retry UUID; saved failed push is distinguished from network failure', async () => {
  const { component, sends, online } = setup();
  await component.refresh(); component.draft.value = '  reply  ';
  await component.send(); assert.equal(component.draft.value, '  reply  '); assert.match(component.error.value, /offline/);
  online(); await component.send();
  assert.equal(sends.length, 2); assert.equal(sends[0].payload.clientId, sends[1].payload.clientId);
  assert.equal(sends[1].payload.content, 'reply'); assert.equal(component.draft.value, '');
  assert.match(component.notice.value, /channel disabled/);
});
test('ambiguous submission keeps its UUID and content until confirmed', async () => {
  const { component, sends } = setup(); await component.refresh();
  component.draft.value = 'one'; await component.send(); component.draft.value = 'two'; await component.send();
  assert.equal(sends[0].payload.clientId, sends[1].payload.clientId); assert.equal(sends[1].payload.content, 'one');
});

test('closing and reopening preserves failed draft and original submission UUID', async () => {
  const storage = new Map(); const first = setup(storage); await first.component.refresh();
  first.component.draft.value = 'preserve me'; await first.component.send();
  const second = setup(storage); await second.component.refresh();
  assert.equal(second.component.draft.value, 'preserve me'); await second.component.send();
  assert.equal(first.sends[0].payload.clientId, second.sends[0].payload.clientId);
});

test('pending provider submission is not announced as accepted', async () => {
  const { component, online } = setup(new Map(), { id: 'r1', deliveryStatus: 'PENDING', deliveryError: null }); await component.refresh(); online();
  component.draft.value = 'pending';

  await component.send(); assert.match(component.notice.value, /处理中/); assert.doesNotMatch(component.notice.value, /已受理/);
});

test('admin history uses a bounded first page and appends older replies from the continuation cursor', async () => {
  const { component, historyRequests } = setup();
  await component.refresh();
  assert.equal(JSON.stringify(historyRequests), JSON.stringify([{ messageId: 'm1', params: { limit: 50 } }]));
  assert.equal(Array.from(component.conversation.value.replies, reply => reply.id).join(','), 'r2,r3');
  await component.loadOlder();
  assert.equal(JSON.stringify(historyRequests[1]), JSON.stringify({ messageId: 'm1', params: { before: 'r2', limit: 50 } }));
  assert.equal(Array.from(component.conversation.value.replies, reply => reply.id).join(','), 'r1,r2,r3');
  assert.equal(component.conversation.value.hasOlder, false);
});

test('conversation close and reopen persist the thread status', async () => {
  const { component, updates } = setup(); await component.refresh();
  await component.toggleStatus();
  assert.deepEqual(updates[0], { id: 'm1', data: { status: 'closed' } });
  assert.equal(component.conversation.value.status, 'closed');
  await component.toggleStatus();
  assert.deepEqual(updates[1], { id: 'm1', data: { status: 'open' } });
  assert.equal(component.conversation.value.status, 'open');
});
