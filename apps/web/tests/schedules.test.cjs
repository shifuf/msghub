const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');

function setup() {
  const source = fs.readFileSync(path.join(__dirname, '../src/views/SchedulesView.vue'), 'utf8');
  const { descriptor } = parse(source);
  const output = ts.transpileModule(compileScript(descriptor, { id: 'schedules' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const result = {}; let confirmation; const resolutions = [];
  vm.runInNewContext(output, { exports: result, console,
    require: (id) => id === 'vue' ? { ...vue, onMounted: () => {} }
      : id === 'naive-ui' ? { useMessage: () => ({ success() {}, error() {} }), useDialog: () => ({ warning: (data) => { confirmation = data; } }) }
      : id === '@/api' ? { schedulesApi: { resolve: async (id, data) => { resolutions.push({ id, ...data }); }, list: async () => ({ items: [], total: 0 }) } }
      : { formatTime: () => '', CHANNEL_TYPE_LABELS: {} },
  });
  const instance = result.default.setup({}, { expose() {} });
  return { instance, confirmation: () => confirmation, resolutions };
}
test('uncertain schedule requires confirmation before retry and records explicit duplicate acknowledgement', async () => {
  const ctx = setup();
  ctx.instance.resolveUncertain({ id: 's1', title: 'Alert' }, 'retry');
  assert.equal(ctx.resolutions.length, 0);
  assert.match(ctx.confirmation().content, /可能已经发送成功/);
  assert.match(ctx.confirmation().positiveText, /重复风险/);
  await ctx.confirmation().onPositiveClick();
  assert.deepEqual(ctx.resolutions, [{ id: 's1', action: 'retry', acknowledgeDuplicateRisk: true }]);
});
test('verified delivered action does not request another send', async () => {
  const ctx = setup();
  ctx.instance.resolveUncertain({ id: 's2' }, 'delivered');
  assert.equal(ctx.resolutions.length, 0);
  await ctx.confirmation().onPositiveClick();
  assert.deepEqual(ctx.resolutions, [{ id: 's2', action: 'delivered' }]);
});
