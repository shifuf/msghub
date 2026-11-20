const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata');
api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
const load = name => require(path.resolve(__dirname, '../apps/api/src', `${name}.ts`));
const secret = 'device-send-test-key-20261120-isolated';
const config = { get: () => secret };

function fixture(queued = false, registrationId = 'phone-a,phone-b') {
  const rows = new Map(); const writes = []; const sent = []; const jobs = [];
  const channel = { id: 'c1', type: 'JPUSH', enabled: true, config: { appKey: 'app-one', masterSecret: 'test-only', registrationId } };
  const prisma = { channel: { findUnique: async () => channel }, projectChannel: { findFirst: async () => null }, project: { findUnique: async () => ({ id: 'p1', enabled: true, unreadEmailFallbackEnabled: false }) }, messageLog: {
    create: async ({ data }) => { writes.push(structuredClone(data)); const row = { id: `notice-${rows.size + 1}`, ...data }; rows.set(row.id, row); return row; },
    update: async ({ where, data }) => { writes.push(structuredClone(data)); return Object.assign(rows.get(where.id), data); },
    updateMany: async ({ where, data }) => { const row = rows.get(where.id); if (!row || where.status && row.status !== where.status || where.deliveryStartedAt === null && row.deliveryStartedAt) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    findUnique: async ({ where }) => rows.get(where.id),
  } };
  const adapters = { get: () => ({ send: async (_cfg, payload) => { sent.push(structuredClone(payload)); return { success: true, response: { msg_id: 'provider-accepted' } }; } }) };
  const { MessagesService } = load('messages/messages.service');
  const service = new MessagesService(prisma, adapters, {}, {}, {}, config, { emitMessage() {} }, {}, {}, {}, { add: async (_name, data) => { jobs.push(structuredClone(data)); } });
  service.asyncEnabled = queued; service.scheduleUnreadEmailFallback = async () => {};
  return { service, prisma, adapters, rows, writes, sent, jobs, channel };
}

function assertReceiptCapabilities(payload, messageId, expectedRids) {
  const { verifyDeviceReceiptToken } = load('common/token.util');
  const tokens = expectedRids.length === 1 ? { [expectedRids[0]]: payload.extra.receivedToken } : JSON.parse(payload.extra.receivedTokens || 'null');
  assert.ok(tokens, 'push must carry receipt capabilities in a JPush scalar extra');
  assert.deepEqual(Object.keys(tokens), expectedRids);
  for (const rid of expectedRids) {
    assert.equal(verifyDeviceReceiptToken(tokens[rid], secret, undefined, { messageId, registrationId: rid })?.messageId, messageId);
    assert.equal(verifyDeviceReceiptToken(tokens[rid], secret, undefined, { registrationId: 'another-phone' }), null);
  }
}

test('synchronous JPush signs per-target receipts without persisting caller or generated receipt credentials', async () => {
  const f = fixture();
  await f.service.enqueueOrSend({ kind: 'push', projectId: 'p1', channelId: 'c1', channelType: 'JPUSH', source: 'ADMIN_SEND', content: 'Notice', extra: { receivedToken: 'untrusted-device-token', receivedTokens: 'untrusted-map' } });
  assertReceiptCapabilities(f.sent[0], 'notice-1', ['phone-a', 'phone-b']);
  assert.equal(typeof f.sent[0].extra.receivedTokens, 'string');
  assert.equal(JSON.stringify(f.writes).includes('receivedToken'), false, 'even the initial log write must exclude capabilities');
  const row = f.rows.get('notice-1'); assert.ok(row.providerAcceptedAt instanceof Date);
  assert.equal(row.deviceReceivedAt ?? null, null); assert.equal(row.deviceDisplayedAt ?? null, null); assert.equal(row.readAt ?? null, null);
});

test('queued pushes persist no receipt tokens and mint current credentials only inside the worker', async () => {
  const f = fixture(true, 'phone-a');
  await f.service.enqueueOrSend({ kind: 'push', projectId: 'p1', channelId: 'c1', channelType: 'JPUSH', source: 'ADMIN_SEND', content: 'Notice' });
  assert.equal(JSON.stringify(f.jobs).includes('receivedToken'), false); assert.equal(f.sent.length, 0);
  const { SendProcessor } = load('queue/send.processor'); const previous = process.env.UNSUBSCRIBE_SECRET; process.env.UNSUBSCRIBE_SECRET = secret;
  try {
    const worker = new SendProcessor(f.prisma, f.adapters, {}, { emitMessage() {} }, {});
    await worker.process({ data: f.jobs[0], opts: { attempts: 1 }, attemptsMade: 0 });
  } finally { if (previous === undefined) delete process.env.UNSUBSCRIBE_SECRET; else process.env.UNSUBSCRIBE_SECRET = previous; }
  assertReceiptCapabilities(f.sent[0], 'notice-1', ['phone-a']);
  assert.equal(JSON.stringify(f.writes).includes('receivedToken'), false);
  assert.ok(f.rows.get('notice-1').providerAcceptedAt instanceof Date);
});

test('admin channel test uses the same scoped receipts and provider acceptance stage', async () => {
  const f = fixture(false, 'phone-a'); const { ChannelsService } = load('channels/channels.service');
  await new ChannelsService(f.prisma, f.adapters, { emitMessage() {} }, { log: async () => {} }, config).test('c1');
  assertReceiptCapabilities(f.sent[0], 'notice-1', ['phone-a']);
  assert.equal(JSON.stringify(f.writes).includes('receivedToken'), false);
  assert.ok(f.rows.get('notice-1').providerAcceptedAt instanceof Date);
});

test('large JPush audiences retain their targets while reporting unavailable receipt capability', () => {
  const { addDeviceReceiptTokens } = load('adapters/jpush-receipts');
  const targets = Array.from({ length: 500 }, (_, i) => `phone-${i}`);
  const result = addDeviceReceiptTokens('notice-1', { _jpushAudience: { registration_id: targets }, receivedToken: 'untrusted' }, secret);
  assert.deepEqual(result._jpushAudience, { registration_id: targets });
  assert.equal(result.receivedToken, undefined); assert.equal(result.receivedTokens, undefined);
  assert.equal(result._deviceReceiptMode, 'unavailable_size');
});

test('alias and broadcast pushes do not manufacture individual device receipt credentials', () => {
  const { addDeviceReceiptTokens } = load('adapters/jpush-receipts');
  for (const audience of ['all', { alias: ['family'] }]) {
    const result = addDeviceReceiptTokens('notice-1', { _jpushAudience: audience, receivedTokens: 'untrusted' }, secret);
    assert.equal(result.receivedToken, undefined); assert.equal(result.receivedTokens, undefined);
    assert.equal(result._deviceReceiptMode, 'unavailable_audience');
  }
});

test('queue failover signs the new message and destination and records acceptance independently', async () => {
  const f = fixture(true, 'phone-a');
  await f.service.enqueueOrSend({ kind: 'push', projectId: 'p1', channelId: 'c1', channelType: 'JPUSH', source: 'ADMIN_SEND', content: 'Notice' });
  const { SendProcessor } = load('queue/send.processor'); const previous = process.env.UNSUBSCRIBE_SECRET; process.env.UNSUBSCRIBE_SECRET = secret;
  const adapters = { get: () => ({ send: async (cfg, payload) => { if (cfg.appKey === 'app-one') return { success: false, errorMessage: 'explicit rejection' }; f.sent.push(structuredClone(payload)); return { success: true }; } }) };
  try {
    const worker = new SendProcessor(f.prisma, adapters, { listFailoverChannels: async () => [{ id: 'backup', type: 'JPUSH', config: { appKey: 'backup-app', registrationId: 'backup-phone' } }] }, { emitMessage() {} }, { shouldSkipBackupAlert: async () => true });
    await assert.rejects(worker.process({ data: f.jobs[0], opts: { attempts: 1 }, attemptsMade: 0 }), /explicit rejection/);
  } finally { if (previous === undefined) delete process.env.UNSUBSCRIBE_SECRET; else process.env.UNSUBSCRIBE_SECRET = previous; }
  assertReceiptCapabilities(f.sent[0], 'notice-2', ['backup-phone']); assert.ok(f.rows.get('notice-2').providerAcceptedAt instanceof Date);
  assert.equal(f.rows.get('notice-2').toAddress, 'backup-phone'); assert.equal(f.rows.get('notice-2').payload.to, 'backup-phone'); assert.equal(f.sent[0].to, 'backup-phone');
  assert.equal(f.rows.get('notice-1').providerAcceptedAt ?? null, null); assert.equal(JSON.stringify(f.writes).includes('receivedToken'), false);
});

test('queue backup alerts also carry scoped receipts and never equate acceptance with display', async () => {
  const f = fixture(false, 'phone-a'); const { SendProcessor } = load('queue/send.processor'); const previous = process.env.UNSUBSCRIBE_SECRET; process.env.UNSUBSCRIBE_SECRET = secret;
  try { await new SendProcessor(f.prisma, f.adapters, {}, { emitMessage() {} }, {}).sendBackupPush('p1', f.channel, 'Failure alert', 'Notice'); }
  finally { if (previous === undefined) delete process.env.UNSUBSCRIBE_SECRET; else process.env.UNSUBSCRIBE_SECRET = previous; }
  assertReceiptCapabilities(f.sent[0], 'notice-1', ['phone-a']); assert.ok(f.rows.get('notice-1').providerAcceptedAt instanceof Date);
  assert.equal(JSON.stringify(f.writes).includes('receivedToken'), false); assert.equal(f.rows.get('notice-1').deviceDisplayedAt ?? null, null);
});
