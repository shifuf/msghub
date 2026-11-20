const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const ts = require('typescript'); const vue = require('vue'); const { parse, compileScript } = require('vue/compiler-sfc');
function setup() {
  const { descriptor } = parse(fs.readFileSync(path.join(__dirname, '../src/views/DevicePushHistoryView.vue'), 'utf8'));
  const script = compileScript(descriptor, { id: 'history' }).content; const exports = {};
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, console, document: { hidden: false }, setInterval: () => 1, clearInterval() {},
    require: id => id === 'vue' ? { ...vue, onMounted() {}, onUnmounted() {} } : id === 'naive-ui' ? { useMessage: () => ({}) } : id === '@/utils/labels' ? { formatTime: value => value } : {},
  }); return exports.default.setup({}, { expose() {} });
}
test('history separates provider acceptance from unconfirmed device receipt and display', () => {
  const state = setup().deliveryState({ status: 'SUCCESS', providerAcceptedAt: 'accepted', deviceReceivedAt: null, deviceDisplayedAt: null, readAt: null, receiptSupport: 'signed' });
  assert.equal(state[0].label, '服务商已受理'); assert.equal(state[1].label, '设备接收待确认'); assert.equal(state[2].label, '系统显示待确认');
});
test('history exposes aggregate counts and tells legacy or broadcast users when receipt evidence is unavailable', () => {
  const c = setup(); const state = c.deliveryState({ providerAcceptedAt: 'accepted', deviceReceivedAt: 'arrived', deviceDisplayedAt: 'shown', targetDeviceCount: 2, receivedDeviceCount: 1, displayedDeviceCount: 1, receiptSupport: 'signed' });
  assert.equal(state[1].label, '设备收到 1/2'); assert.equal(state[2].label, '系统显示 1/2');
  assert.equal(c.deliveryState({ status: 'SUCCESS', receiptSupport: 'unknown' })[1].label, '历史记录无设备回执');
  assert.equal(c.deliveryState({ status: 'SUCCESS', receiptSupport: 'unavailable_audience' })[1].label, '当前目标不支持设备回执');
  assert.equal(c.deliveryState({ status: 'SUCCESS', targetDeviceCount: 20, receiptSupport: 'unavailable_size' })[1].label, '当前目标不支持设备回执');
});
