const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata'); api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
const load = name => require(path.resolve(__dirname, '../apps/api/src', name));
const databaseUrl = process.env.AUDIT_DATABASE_URL;
if (databaseUrl) { const u = new URL(databaseUrl); if (u.hostname !== '127.0.0.1' || u.port !== '56487' || u.pathname !== '/msghub_audit') throw Error('Only isolated audit database permitted'); }

test('real HTTP conversation rejects unauthorized access, preserves original target, deduplicates concurrently and cascades deletion', { skip: !databaseUrl, timeout: 300000 }, async () => {
  process.env.DATABASE_URL = databaseUrl; process.env.APP_ENV = 'development';
  process.env.JWT_SECRET = 'Conversation-http-regression-secret-2026'; process.env.UNSUBSCRIBE_SECRET = process.env.JWT_SECRET;
  const { Module, ValidationPipe } = api('@nestjs/common'); const { ConfigModule } = api('@nestjs/config'); const { NestFactory } = api('@nestjs/core');
  const { PrismaModule } = load('prisma/prisma.module.ts'); const { PrismaService } = load('prisma/prisma.service.ts');
  const { AuthModule } = load('auth/auth.module.ts'); const { AdapterRegistry } = load('adapters/adapters.registry.ts');
  const { ConversationsService } = load('messages/conversations.service.ts');
  const { RealtimeService } = load('realtime/realtime.service.ts');
  const { PublicConversationsController, AdminConversationInboxController, AdminConversationsController } = load('messages/conversations.controller.ts');
  const { AllExceptionsFilter } = load('common/http-exception.filter.ts'); const tokens = load('common/token.util.ts');
  const sent = []; let failPush = false;
  class HttpModule {}
  Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule],
    controllers: [PublicConversationsController, AdminConversationInboxController, AdminConversationsController],
    providers: [ConversationsService, { provide: RealtimeService, useValue: { emit() {} } }, { provide: AdapterRegistry, useValue: { get: () => ({ send: async (config, payload) => { sent.push({ config, payload }); return failPush ? { success: false, errorMessage: 'Provider unavailable' } : { success: true }; } }) } }],
  })(HttpModule);
  const app = await NestFactory.create(HttpModule, { logger: ['error'], abortOnError: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })); app.useGlobalFilters(new AllExceptionsFilter());
  const db = app.get(PrismaService); const prefix = `chat-audit-${randomUUID()}`; let channel, message, admin;
  try {
    channel = await db.channel.create({ data: { name: prefix, type: 'JPUSH', config: { appKey: 'original-app', masterSecret: 'test-only', registrationId: 'new-device' } } });
    message = await db.messageLog.create({ data: { source: 'ADMIN_TEST', status: 'SUCCESS', channelId: channel.id, channelType: 'JPUSH', title: prefix, content: 'Original notice' } });
    await db.messageLog.update({ where: { id: message.id }, data: { payload: { extra: { conversationId: message.id, _jpushAudience: { registration_id: ['original-device'] }, _jpushAppKey: 'original-app' } } } });
    admin = await db.adminUser.create({ data: { username: prefix, passwordHash: await api('bcryptjs').hash('Audit-password-2026!', 4) } });
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    const request = async (route, body, jwt) => {
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : route.startsWith('/api/admin/conversations/') ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
    };
    const publicBody = { messageId: message.id, token: tokens.signConversationToken(message.id, process.env.JWT_SECRET) };
    assert.equal((await request('/api/admin/conversations')).status, 401);
    assert.equal((await request(`/api/messages/${message.id}/conversation`)).status, 401);
    assert.equal((await request(`/api/admin/messages/${message.id}/reply`, { content: 'x', clientId: randomUUID() })).status, 401);
    const denied = await request('/api/public/messages/conversation', { ...publicBody, token: tokens.signReadToken(message.id, process.env.JWT_SECRET) });
    assert.equal(denied.status, 403); assert.equal(JSON.stringify(denied.body).includes('Private title'), false);
    assert.equal((await request('/api/public/messages/reply', { ...publicBody, content: '  ', clientId: randomUUID() })).status, 400);
    assert.equal((await request('/api/public/messages/reply', { ...publicBody, content: 'x', clientId: 'not-uuid' })).status, 400);
    const clientId = randomUUID();
    const submissions = await Promise.all(Array.from({ length: 5 }, () => request('/api/public/messages/reply', { ...publicBody, content: ' hello ', clientId })));
    assert.ok(submissions.every(r => r.status === 201), JSON.stringify(submissions));
    assert.equal(new Set(submissions.map(r => r.body.data.id)).size, 1); assert.equal(await db.messageReply.count({ where: { messageId: message.id } }), 1);
    assert.equal((await request('/api/public/messages/reply', { ...publicBody, content: 'changed', clientId })).status, 409);
    const login = await request('/api/admin/auth/login', { username: prefix, password: 'Audit-password-2026!' }); const jwt = login.body.data.accessToken;
    const inbox = await request(`/api/admin/conversations?status=open&unread=true&page=1&pageSize=20&search=${encodeURIComponent(prefix)}`, undefined, jwt);
    assert.equal(inbox.status, 200); assert.equal(inbox.body.data.unreadCount, 1); assert.equal(inbox.body.data.total, 1);
    assert.equal(inbox.body.data.items[0].messageId, message.id); assert.equal(inbox.body.data.items[0].lastReply.content, 'hello');
    const conversation = await request(`/api/messages/${message.id}/conversation`, undefined, jwt);
    assert.equal(conversation.status, 200); assert.equal(conversation.cache, 'no-store'); assert.equal(conversation.body.data.replies[0].content, 'hello'); assert.ok(conversation.body.data.replies[0].readAt);
    const adminClientId = randomUUID();
    const replies = await Promise.all(Array.from({ length: 5 }, () => request(`/api/admin/messages/${message.id}/reply`, { content: 'Answer', clientId: adminClientId }, jwt)));
    assert.ok(replies.every(r => r.status === 201)); assert.equal(new Set(replies.map(r => r.body.data.id)).size, 1); assert.equal(sent.length, 1);
    const newestPage = await request(`/api/admin/messages/${message.id}/conversation?limit=1`, undefined, jwt);
    assert.equal(newestPage.body.data.replies.length, 1); assert.equal(newestPage.body.data.hasOlder, true);
    const oldestPage = await request(`/api/admin/messages/${message.id}/conversation?limit=1&before=${newestPage.body.data.nextCursor}`, undefined, jwt);
    assert.equal(oldestPage.body.data.replies.length, 1); assert.equal(oldestPage.body.data.hasOlder, false);
    assert.notEqual(oldestPage.body.data.replies[0].id, newestPage.body.data.replies[0].id);
    const { JpushAdapter } = load('adapters/jpush.adapter.ts');
    assert.deepEqual(new JpushAdapter().buildAudience(sent[0].config, sent[0].payload.extra), { registration_id: ['original-device'] });
    assert.equal(sent[0].payload.extra.conversationToken, publicBody.token); assert.equal(sent[0].payload.extra.replyId, replies[0].body.data.id);
    const closed = await request(`/api/admin/conversations/${message.id}`, { status: 'closed' }, jwt);
    assert.equal(closed.status, 200); assert.equal(closed.body.data.status, 'closed'); assert.ok(closed.body.data.closedAt);
    const closedRetry = await request(`/api/admin/messages/${message.id}/reply`, { content: 'Answer', clientId: adminClientId }, jwt);
    assert.equal(closedRetry.status, 201); assert.equal(closedRetry.body.data.id, replies[0].body.data.id); assert.equal(sent.length, 1);
    assert.equal((await request(`/api/admin/messages/${message.id}/reply`, { content: 'new answer', clientId: randomUUID() }, jwt)).status, 409);
    assert.equal((await request('/api/public/messages/reply', { ...publicBody, content: 'late device reply', clientId: randomUUID() })).status, 409);
    const closedInbox = await request(`/api/admin/conversations?status=closed&page=1&pageSize=20&search=${encodeURIComponent(prefix)}`, undefined, jwt);
    assert.equal(closedInbox.body.data.total, 1); assert.equal(closedInbox.body.data.items[0].status, 'closed');
    const reopened = await request(`/api/admin/conversations/${message.id}`, { status: 'open' }, jwt);
    assert.equal(reopened.body.data.status, 'open'); assert.equal(reopened.body.data.closedAt, null);
    const reopenedReply = await request(`/api/admin/messages/${message.id}/reply`, { content: 'Reopened answer', clientId: randomUUID() }, jwt);
    assert.equal(reopenedReply.status, 201); assert.equal(sent.length, 2);
    const deviceRead = await request('/api/public/messages/conversation', publicBody);
    assert.equal(deviceRead.status, 201); assert.ok(deviceRead.body.data.replies.find(r => r.author === 'admin').readAt);
    assert.equal(JSON.stringify(deviceRead.body).includes(publicBody.token), false);
    failPush = true;
    const failed = await request(`/api/messages/${message.id}/reply`, { content: 'Saved answer', clientId: randomUUID() }, jwt);
    assert.equal(failed.body.data.deliveryStatus, 'FAILED'); assert.match(failed.body.data.deliveryError, /unavailable/);
    assert.equal(await db.messageReply.count({ where: { messageId: message.id } }), 4);
    await db.messageLog.delete({ where: { id: message.id } });
    assert.equal(await db.messageReply.count({ where: { messageId: message.id } }), 0);
    assert.equal((await request('/api/public/messages/conversation', publicBody)).status, 404);
  } finally {
    if (message) await db.messageLog.deleteMany({ where: { id: message.id } });
    if (channel) await db.channel.delete({ where: { id: channel.id } });
    if (admin) await db.adminUser.delete({ where: { id: admin.id } });
    await app.close();
  }
});
