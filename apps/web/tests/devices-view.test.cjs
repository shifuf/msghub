const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');

function setup() {
  const source = fs.readFileSync(path.join(__dirname, '../src/views/DevicesView.vue'), 'utf8');
  const { descriptor } = parse(source);
  const script = compileScript(descriptor, { id: 'devices-view' }).content;
  const exports = {};
  const calls = { pairing: [], revocations: [], loads: 0 };
  let dialogOptions;
  const channels = [
    { id: 'jpush-1', name: '测试手机', appFingerprint: 'fingerprint', deviceCount: 1 },
    { id: 'jpush-2', name: '备用手机', appFingerprint: 'fingerprint-2', deviceCount: 0 },
  ];
  const pairCode = { channelId: 'jpush-2', channelName: '备用手机', appFingerprint: 'fingerprint-2', code: '0123456789abcdef', expiresAt: '2026-11-20T12:10:00.000Z' };
  const devices = [{ id: 'device-1', name: '测试手机', appVersion: '2.2.3', online: true, notificationsEnabled: true, channelEnabled: true, jpushConnected: true, revokedAt: null, lastSeenAt: '2026-11-20T12:00:00.000Z', targetedByEnabledChannel: true }];
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, {
    exports, console, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    require: id => id === 'vue' ? { ...vue, onMounted() {}, onUnmounted() {} }
      : id === '@/api' ? { devicesApi: {
        list: async () => { calls.loads++; return { channels, items: devices }; },
        createPairingCode: async channelId => { calls.pairing.push(channelId); return pairCode; },
        revoke: async id => { calls.revocations.push(id); return { id, revoked: true }; },
      } }
        : id === 'naive-ui' ? { useMessage: () => ({ success() {}, error() {}, warning() {} }), useDialog: () => ({ warning: options => { dialogOptions = options; } }) }
          : id === '@/utils/labels' ? { formatTime: value => value || '-' }
            : {},
  });
  const component = exports.default.setup({}, { expose() {} });
  return { component, calls, devices, pairCode, channels, confirmRevoke: () => dialogOptions?.onPositiveClick?.() };
}

test('device enrollment issues a single-use code for the selected JPush channel only', async () => {
  const { component, calls, pairCode } = setup();
  await component.load();
  component.selectedChannelId.value = 'jpush-2';

  await component.issuePairingCode();

  assert.deepEqual(Array.from(calls.pairing), ['jpush-2']);
  assert.equal(component.pairingCode.value.code, pairCode.code);
  assert.equal(component.pairingCode.value.channelName, '备用手机');
  assert.equal(component.pairingCode.value.expiresAt, pairCode.expiresAt);
});

test('device revocation requires an explicit confirmation and refreshes reported health', async () => {
  const { component, calls, confirmRevoke } = setup();
  await component.load();

  component.requestRevoke({ id: 'device-1', name: '测试手机' });
  assert.deepEqual(Array.from(calls.revocations), []);
  await confirmRevoke();

  assert.deepEqual(Array.from(calls.revocations), ['device-1']);
  assert.equal(calls.loads, 2);
});

test('device management page is reachable in the authenticated admin navigation', () => {
  const router = fs.readFileSync(path.join(__dirname, '../src/router/index.ts'), 'utf8');
  const layout = fs.readFileSync(path.join(__dirname, '../src/layouts/AdminLayout.vue'), 'utf8');
  assert.match(router, /path:\s*'\/devices'[\s\S]{0,160}DevicesView\.vue/);
  assert.match(layout, /label:\s*'推送设备'[\s\S]{0,100}key:\s*'devices'/);
  assert.match(layout, /devices:\s*'\/devices'/);
});
