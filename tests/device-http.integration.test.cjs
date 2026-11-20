const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata');
const compiled = process.env.AUDIT_COMPILED === 'true';
if (!compiled) api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
const load = name => require(path.resolve(__dirname, compiled ? '../apps/api/dist/src' : '../apps/api/src', `${name}.${compiled ? 'js' : 'ts'}`));
const databaseUrl = process.env.AUDIT_DATABASE_URL;
if (databaseUrl) { const u = new URL(databaseUrl); if (u.hostname !== '127.0.0.1' || u.port !== '56487' || u.pathname !== '/msghub_audit') throw Error('Only isolated audit database permitted'); }

test('real device HTTP pairing, rotation, revocation and monotonic target-scoped receipts', { skip: !databaseUrl, timeout: 300000 }, async t => {
  process.env.DATABASE_URL = databaseUrl; process.env.APP_ENV = 'development'; process.env.JWT_SECRET = 'Conversation-http-regression-secret-2026'; process.env.UNSUBSCRIBE_SECRET = process.env.JWT_SECRET;
  process.env.REDIS_HOST = '127.0.0.1'; process.env.REDIS_PORT = '56488';
  const { Module, ValidationPipe } = api('@nestjs/common'); const { ConfigModule } = api('@nestjs/config'); const { NestFactory } = api('@nestjs/core');
  const { PrismaModule } = load('prisma/prisma.module'); const { PrismaService } = load('prisma/prisma.service'); const { AuthModule } = load('auth/auth.module');
  const { DevicesModule } = load('devices/devices.module'); const { AllExceptionsFilter } = load('common/http-exception.filter'); const tokens = load('common/token.util');
  class DeviceHttpModule {} Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, DevicesModule] })(DeviceHttpModule);
  const app = await NestFactory.create(DeviceHttpModule, { logger: ['error'], abortOnError: false }); app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })); app.useGlobalFilters(new AllExceptionsFilter());
  const db = app.get(PrismaService); const prefix = `device-audit-${randomUUID()}`; const appKey = prefix; const channels = []; const messages = [];
  let admin, bearer, deviceId;
  try {
    for (let i = 0; i < 2; i++) channels.push(await db.channel.create({ data: { name: `${prefix}-${i}`, type: 'JPUSH', config: { appKey, masterSecret: 'test-only', registrationId: 'existing-phone' } } }));
    admin = await db.adminUser.create({ data: { username: prefix, passwordHash: await api('bcryptjs').hash('Audit-password-2026!', 4) } });
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const request = async (route, body, token, method) => { const r = await fetch(base + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') }; };
    const login = await request('/api/admin/auth/login', { username: prefix, password: 'Audit-password-2026!' }); const jwt = login.body.data.accessToken;
    const code = async () => { const r = await request('/api/admin/devices/pair-codes', { channelId: channels[0].id }, jwt); assert.equal(r.status, 201); assert.equal(r.cache, 'no-store'); return r.body.data.code; };
    const pair = pairingCode => request('/api/device/pair', { code: pairingCode, registrationId: `${prefix}-phone`, appKey, connected: true, notificationsEnabled: false, channelEnabled: false, appVersion: '2.2.3' });
    await t.test('admin access, malformed and wrong-application pairing cannot leak or consume a code', async () => {
      assert.equal((await request('/api/admin/devices')).status, 401); assert.equal((await request('/api/admin/devices/pair-codes', { channelId: channels[0].id })).status, 401);
      const c = await code(); assert.equal((await request('/api/device/pair', { code: c, registrationId: 'foreign', appKey: 'other-app' })).status, 401);
      assert.equal((await request('/api/device/pair', { code: c, registrationId: 'phone-a,phone-b', appKey })).status, 400);
      const expired = await code(); await db.devicePairingCode.updateMany({ where: { codeHash: tokens.hashDeviceCredential(expired) }, data: { expiresAt: new Date(0) } }); assert.equal((await pair(expired)).status, 401);
      const results = await Promise.all([pair(c), pair(c), pair(c)]); assert.equal(results.filter(r => r.status === 201).length, 1); assert.ok(results.filter(r => r.status !== 201).every(r => [401, 409].includes(r.status)));
      const enrolled = results.find(r => r.status === 201).body.data; bearer = enrolled.token; deviceId = enrolled.id;
      assert.equal((await db.jpushDevice.findUnique({ where: { id: deviceId } })).credentialHash, tokens.hashDeviceCredential(bearer));
      const listing = await request('/api/admin/devices', undefined, jwt); assert.equal(listing.status, 200); const device = listing.body.data.items.find(d => d.id === deviceId);
      assert.equal(device.notificationsEnabled, false); assert.equal(device.channelEnabled, false); assert.equal(device.targetedByEnabledChannel, true);
      assert.equal(JSON.stringify(device).includes(bearer), false); assert.notEqual(device.registrationId, enrolled.registrationId);
    });
    await t.test('RID rotation changes every same-app device channel without losing concurrently paired targets', async () => {
      // Also target the same phone through a disabled channel, which may later be enabled.
      await db.channel.update({ where: { id: channels[1].id }, data: { enabled: false, config: { appKey, masterSecret: 'test-only', registrationId: `other-phone,${prefix}-phone` } } });
      const body = { registrationId: `${prefix}-rotated`, appKey, connected: true, notificationsEnabled: true, channelEnabled: true };
      assert.equal((await request('/api/device/heartbeat', body)).status, 401); assert.equal((await request('/api/device/heartbeat', { ...body, appKey: 'other-app' }, bearer)).status, 401);
      assert.equal((await request('/api/device/heartbeat', body, bearer)).status, 201);
      for (const channel of channels) { const row = await db.channel.findUnique({ where: { id: channel.id } }); assert.ok(row.config.registrationId.includes(`${prefix}-rotated`)); assert.equal(row.config.registrationId.includes(`${prefix}-phone`), false); }
      const codes = await Promise.all([code(), code(), code()]);
      const paired = await Promise.all(codes.map((c, i) => request('/api/device/pair', { code: c, registrationId: `${prefix}-parallel-${i}`, appKey })));
      assert.ok(paired.every(r => r.status === 201), JSON.stringify(paired.map(r => r.status)));
      const cfg = (await db.channel.findUnique({ where: { id: channels[0].id } })).config; for (let i = 0; i < 3; i++) assert.ok(cfg.registrationId.includes(`${prefix}-parallel-${i}`));
    });
    await t.test('signed receipts reject another target and preserve first arrival and display through duplicate reports', async () => {
      const rid = `${prefix}-rotated`; const m = await db.messageLog.create({ data: { channelId: channels[0].id, channelType: 'JPUSH', source: 'ADMIN_TEST', status: 'SUCCESS', providerAcceptedAt: new Date(), payload: { extra: { _jpushAudience: { registration_id: [rid] }, _jpushAppKey: appKey } } } }); messages.push(m.id);
      const token = tokens.signDeviceReceiptToken(m.id, rid, Math.floor(Date.now() / 1000) + 60, process.env.JWT_SECRET);
      const body = { receivedToken: token, registrationId: rid, displayed: false };
      assert.equal((await request('/api/device/receipts', { ...body, registrationId: 'foreign' })).status, 401);
      assert.equal((await request('/api/device/receipts', { ...body, receivedToken: tokens.signDeviceReceiptToken(m.id, 'foreign', Math.floor(Date.now() / 1000) + 60, process.env.JWT_SECRET), registrationId: 'foreign' })).status, 401);
      assert.equal((await request('/api/device/receipts', { ...body, displayed: 'true' })).status, 400);
      assert.equal((await request('/api/device/receipts', body, bearer)).status, 201); let stored = await db.messageLog.findUnique({ where: { id: m.id } }); assert.ok(stored.deviceReceivedAt); assert.equal(stored.deviceDisplayedAt, null); assert.equal(stored.readAt, null);
      const receivedAt = stored.deviceReceivedAt.toISOString(); assert.equal((await request('/api/device/receipts', { ...body, displayed: true }, bearer)).body.data.displayed, true);
      const first = await db.deviceReceipt.findUnique({ where: { messageId_registrationId: { messageId: m.id, registrationId: rid } } });
      await request('/api/device/receipts', { ...body, displayed: true }, bearer);
      assert.equal((await request('/api/device/receipts', body, bearer)).body.data.displayed, true);
      const last = await db.deviceReceipt.findUnique({ where: { messageId_registrationId: { messageId: m.id, registrationId: rid } } });
      assert.equal(last.displayedAt.toISOString(), first.displayedAt.toISOString()); stored = await db.messageLog.findUnique({ where: { id: m.id } }); assert.equal(stored.deviceReceivedAt.toISOString(), receivedAt); assert.equal(stored.readAt, null);
    });
    await t.test('revoked device credentials cannot heartbeat and never become active through stale writes', async () => {
      const result = await request(`/api/admin/devices/${deviceId}`, undefined, jwt, 'DELETE'); assert.equal(result.status, 200);
      assert.equal((await request('/api/device/heartbeat', { appKey, registrationId: `${prefix}-rotated`, connected: true }, bearer)).status, 401);
      assert.ok((await db.jpushDevice.findUnique({ where: { id: deviceId } })).revokedAt);
    });
    await t.test('device history filters every original target and does not borrow another phone display evidence', async () => {
      const { MessagesService } = load('messages/messages.service'); const rid = `${prefix}-history-second`;
      const m = await db.messageLog.create({ data: { channelId: channels[0].id, channelType: 'JPUSH', source: 'ADMIN_TEST', title: prefix, status: 'SUCCESS', toAddress: 'first-phone', providerAcceptedAt: new Date(), deviceReceivedAt: new Date(), deviceDisplayedAt: new Date(), payload: { extra: { _jpushAudience: { registration_id: ['first-phone', rid] }, _jpushAppKey: appKey, _deviceReceiptMode: 'signed' } } } }); messages.push(m.id);
      await db.deviceReceipt.create({ data: { messageId: m.id, registrationId: 'first-phone', displayedAt: new Date() } });
      const result = await new MessagesService(db).listDevicePushHistory({ registrationId: rid });
      const row = result.items.find(item => item.id === m.id); assert.ok(row, 'second RID must match the original audience');
      assert.equal(row.registrationId, rid); assert.ok(row.providerAcceptedAt); assert.equal(row.deviceReceivedAt, null); assert.equal(row.deviceDisplayedAt, null);
      const all = await new MessagesService(db).listDevicePushHistory({ q: prefix }); const aggregate = all.items.find(item => item.id === m.id);
      assert.equal(aggregate.targetDeviceCount, 2); assert.equal(aggregate.receivedDeviceCount, 1); assert.equal(aggregate.displayedDeviceCount, 1);
    });
    await t.test('multi-target receipts require paired identity and reject a peer capability from the same payload', async () => {
      const c = await code(); const enrolled = await pair(c); assert.equal(enrolled.status, 201); const identity = enrolled.body.data;
      const rid = `${prefix}-phone`; const peerRid = `${prefix}-peer`;
      const m = await db.messageLog.create({ data: { channelId: channels[0].id, channelType: 'JPUSH', source: 'ADMIN_TEST', status: 'SUCCESS', payload: { extra: { _jpushAudience: { registration_id: [rid, peerRid] }, _jpushAppKey: appKey } } } }); messages.push(m.id);
      const bodyFor = target => ({ receivedToken: tokens.signDeviceReceiptToken(m.id, target, Math.floor(Date.now() / 1000) + 60, process.env.JWT_SECRET), registrationId: target, displayed: true });
      assert.equal((await request('/api/device/receipts', bodyFor(peerRid))).status, 401);
      assert.equal((await request('/api/device/receipts', bodyFor(peerRid), identity.token)).status, 401);
      assert.equal((await request('/api/device/receipts', bodyFor(rid), identity.token)).status, 201);
      assert.equal(await db.deviceReceipt.count({ where: { messageId: m.id, registrationId: peerRid } }), 0);
      await request(`/api/admin/devices/${identity.id}`, undefined, jwt, 'DELETE');
      assert.equal((await request('/api/device/receipts', bodyFor(rid), identity.token)).status, 401);
    });
    await t.test('alias channel stale RID never counts as targeted device coverage', async () => {
      const rid = `${prefix}-coverage`; const paired = await request('/api/device/pair', { code: await code(), appKey, registrationId: rid }); assert.equal(paired.status, 201);
      await db.channel.update({ where: { id: channels[0].id }, data: { config: { appKey, masterSecret: 'test-only', registrationId: rid, audienceMode: 'alias', alias: 'family' } } });
      const result = await request('/api/admin/devices', undefined, jwt); assert.equal(result.body.data.items.find(row => row.id === paired.body.data.id).targetedByEnabledChannel, false);
    });
  } finally {
    await db.messageLog.deleteMany({ where: { id: { in: messages } } }); await db.devicePairingCode.deleteMany({ where: { appKey } }); await db.jpushDevice.deleteMany({ where: { appKey } });
    await db.activityLog.deleteMany({ where: { OR: [{ resourceId: { in: [...channels.map(c => c.id), deviceId || ''] } }, { resourceName: { startsWith: prefix } }] } });
    await db.channel.deleteMany({ where: { id: { in: channels.map(c => c.id) } } }); if (admin) await db.adminUser.delete({ where: { id: admin.id } }); await app.close();
  }
});
