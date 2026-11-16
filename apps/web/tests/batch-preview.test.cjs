const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');

function setup(previewResponse) {
  const { descriptor } = parse(fs.readFileSync(path.join(__dirname, '../src/views/MessagesView.vue'), 'utf8'));
  const compiled = compileScript(descriptor, { id: 'messages' }).content;
  const exports = {}; const sent = []; let confirmation; const previews = [];
  vm.runInNewContext(ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, {
    exports, console,
    require: (id) => id === 'vue' ? { ...vue, onMounted() {} }
      : id === 'vue-router' ? { useRoute: () => ({ query: {} }), useRouter: () => ({}) }
      : id === 'naive-ui' ? { useMessage: () => ({ success() {}, error() {}, warning() {} }), useDialog: () => ({ warning: (data) => { confirmation = data; } }) }
      : id === '@/api' ? { messagesApi: { batchPreview: async (data) => { previews.push(data); return previewResponse; }, batch: async (data) => { sent.push(data); return { success: 1, failed: 0, total: 1 }; }, list: async () => ({ items: [], total: 0 }) } }
      : id === '@/utils/labels' ? { CHANNEL_TYPES: [], CHANNEL_TYPE_LABELS: {}, STATUS_LABELS: {}, SOURCE_LABELS: {}, formatTime() {}, statusTagType() {}, formatErrorMessage() {} }
      : {},
  });
  const instance = exports.default.setup({}, { expose() {} });
  instance.batchForm.projectId = 'p1';
  return { instance, sent, previews, confirmation: () => confirmation };
}

const validPreview = { projectId: 'p1', valid: true, items: [{ channelId: 'c1', channelType: 'JPUSH', valid: true }], duplicates: [], estimatedSendAttempts: 1, smtpQuota: null };

test('preflight never sends and actual batch waits for explicit confirmation', async () => {
  const ctx = setup(validPreview);
  await ctx.instance.previewBatch();
  assert.equal(ctx.sent.length, 0); assert.equal(ctx.confirmation(), undefined);
  await ctx.instance.doBatch();
  assert.equal(ctx.sent.length, 0); assert.equal(ctx.previews.length, 2);
  assert.match(ctx.confirmation().content, /1 个渠道/);
  await ctx.confirmation().onPositiveClick();
  assert.equal(ctx.sent.length, 1); assert.equal(ctx.sent[0].projectId, 'p1');
  await ctx.confirmation().onPositiveClick();
  assert.equal(ctx.sent.length, 1);
});
test('editing after preflight invalidates preview and refuses stale confirmation', async () => {
  const ctx = setup(validPreview);
  await ctx.instance.doBatch();
  ctx.instance.batchForm.title = 'changed';
  assert.equal(ctx.instance.batchPreviewResult.value, null);
  await ctx.confirmation().onPositiveClick();
  assert.equal(ctx.sent.length, 0); assert.equal(ctx.instance.batchPreviewStale.value, true);
});
test('invalid preview displays errors and never offers send confirmation', async () => {
  const ctx = setup({ ...validPreview, valid: false, estimatedSendAttempts: 0, items: [{ channelId: 'smtp', channelType: 'SMTP', valid: false, errorMessage: 'SMTP 需要有效收件人 to' }] });
  await ctx.instance.doBatch();
  assert.equal(ctx.sent.length, 0); assert.equal(ctx.confirmation(), undefined);
  assert.equal(ctx.instance.batchPreviewResult.value.items[0].errorMessage, 'SMTP 需要有效收件人 to');
});
