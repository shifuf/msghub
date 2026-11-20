const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');

const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata');
api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
const url = process.env.AUDIT_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '56487' || parsed.pathname !== '/msghub_audit') throw new Error('Only isolated audit database permitted');
}
const { PrismaClient } = api('@prisma/client');
const db = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const projects = [];
after(async () => {
  if (!db) return;
  await db.messageLog.deleteMany({ where: { projectId: { in: projects } } });
  await db.project.deleteMany({ where: { id: { in: projects } } });
  await db.$disconnect();
});

async function project() {
  const id = `conversation-retention-${randomUUID()}`;
  const row = await db.project.create({ data: { id, name: id, apiKeyHash: id, apiKeyPrefix: 'audit' } });
  projects.push(id);
  return row;
}

for (const operation of ['cleanup', 'clear']) {
  test(`${operation} preserves active conversations and closed threads with unresolved replies`, { skip: !db }, async () => {
    const { MessagesService } = require('../apps/api/src/messages/messages.service.ts');
    const owner = await project();
    const old = new Date('2020-01-01T00:00:00.000Z');
    const create = data => db.messageLog.create({ data: { projectId: owner.id, source: 'ADMIN_TEST', status: 'SUCCESS', channelType: 'JPUSH', createdAt: old, conversationActivityAt: old, ...data } });
    const open = await create({});
    const pending = await create({ conversationClosedAt: old });
    const uncertain = await create({ conversationClosedAt: old });
    const settled = await create({ conversationClosedAt: old });
    const unused = await create({ conversationActivityAt: null });
    const unknownDelivery = await create({ status: 'FAILED', conversationActivityAt: null, errorMessage: 'DELIVERY_UNKNOWN: worker interrupted' });
    const queued = await create({ status: 'PENDING', conversationActivityAt: null });
    for (const [message, deliveryStatus] of [[open, 'STORED'], [pending, 'PENDING'], [uncertain, 'UNCERTAIN'], [settled, 'ACCEPTED']]) {
      await db.messageReply.create({ data: { messageId: message.id, author: deliveryStatus === 'STORED' ? 'device' : 'admin', content: deliveryStatus, clientId: randomUUID(), deliveryStatus, createdAt: old } });
    }
    const service = new MessagesService(db);
    const options = { projectId: owner.id, before: '2021-01-01T00:00:00.000Z' };
    if (operation === 'cleanup') {
      const preview = await service.cleanup({ ...options, preview: true });
      assert.equal(preview.matched, 2, 'preview must exclude active and unresolved threads');
      assert.equal(await db.messageLog.count({ where: { projectId: owner.id } }), 7);
    }
    const result = await service[operation](options);
    assert.equal(result.deleted, 2, 'only settled closed threads and untouched notifications may be deleted');
    const remaining = await db.messageLog.findMany({ where: { projectId: owner.id }, select: { id: true } });
    assert.deepEqual(remaining.map(row => row.id).sort(), [open.id, pending.id, uncertain.id, unknownDelivery.id, queued.id].sort());
    assert.equal(await db.messageReply.count({ where: { messageId: { in: [open.id, pending.id, uncertain.id] } } }), 3);
    assert.equal(await db.messageReply.count({ where: { messageId: settled.id } }), 0, 'settled closed thread replies cascade with its root');
    assert.equal(await db.messageLog.findUnique({ where: { id: unused.id } }), null);
  });
}

test('reading a conversation marks only stale pending replies uncertain and same UUID never resends', { skip: !db }, async () => {
  const { ConversationsService } = require('../apps/api/src/messages/conversations.service.ts');
  const owner = await project();
  const message = await db.messageLog.create({ data: { projectId: owner.id, source: 'ADMIN_TEST', status: 'SUCCESS', channelType: 'JPUSH', conversationActivityAt: new Date(), conversationClosedAt: new Date() } });
  await db.messageLog.update({ where: { id: message.id }, data: { payload: { extra: { conversationId: message.id, _jpushAudience: { registration_id: ['audit-only'] }, _jpushAppKey: 'audit-only' } } } });
  const clientId = randomUUID();
  const stale = await db.messageReply.create({ data: { messageId: message.id, author: 'admin', content: 'ambiguous reply', clientId, deliveryStatus: 'PENDING', createdAt: new Date(Date.now() - 180000) } });
  const recent = await db.messageReply.create({ data: { messageId: message.id, author: 'admin', content: 'in flight', clientId: randomUUID(), deliveryStatus: 'PENDING' } });
  const accepted = await db.messageReply.create({ data: { messageId: message.id, author: 'admin', content: 'accepted', clientId: randomUUID(), deliveryStatus: 'ACCEPTED', createdAt: new Date(Date.now() - 180000) } });
  const service = new ConversationsService(db, { get() { throw new Error('An ambiguous reply must never send again'); } }, {}, { emit() {} });
  const conversation = await service.getAdmin(message.id);
  const byId = new Map(conversation.replies.map(reply => [reply.id, reply]));
  assert.equal(byId.get(stale.id).deliveryStatus, 'UNCERTAIN');
  assert.ok(byId.get(stale.id).deliveryError);
  assert.equal(byId.get(recent.id).deliveryStatus, 'PENDING');
  assert.equal(byId.get(accepted.id).deliveryStatus, 'ACCEPTED');
  const retried = await service.replyAdmin(message.id, { content: 'ambiguous reply', clientId });
  assert.equal(retried.id, stale.id);
  assert.equal(retried.deliveryStatus, 'UNCERTAIN');
  assert.equal(await db.messageReply.count({ where: { messageId: message.id } }), 3);
});

test('sensitive retention keeps open and unresolved conversations usable while redacting settled notices', { skip: !db }, async () => {
  const { RetentionService } = require('../apps/api/src/site/retention.service.ts');
  const { ConversationsService } = require('../apps/api/src/messages/conversations.service.ts');
  const { signConversationToken } = require('../apps/api/src/common/token.util.ts');
  const owner = await project();
  const old = new Date('2020-01-01T00:00:00.000Z');
  const roots = [];
  for (const [status, closed] of [['STORED', false], ['PENDING', true], ['UNCERTAIN', true], ['ACCEPTED', true]]) {
    const root = await db.messageLog.create({ data: { projectId: owner.id, source: 'ADMIN_TEST', status: 'SUCCESS', channelType: 'JPUSH', templateCode: 'login', title: 'Original title', content: 'Original notice', createdAt: old, conversationActivityAt: old, conversationClosedAt: closed ? old : null } });
    await db.messageLog.update({ where: { id: root.id }, data: { payload: { extra: { conversationId: root.id, _jpushAudience: { registration_id: ['audit-only'] }, _jpushAppKey: 'audit-only' } } } });
    await db.messageReply.create({ data: { messageId: root.id, author: status === 'STORED' ? 'device' : 'admin', content: status, clientId: randomUUID(), deliveryStatus: status } });
    roots.push(root);
  }
  // Keep policy configuration local and scope all real message queries to this
  // test project, without changing global settings used by other audit tests.
  const scoped = {
    systemSetting: { findMany: async () => [{ key: 'sensitiveRetentionDays', value: '1' }] },
    scheduledMessage: { findMany: args => db.scheduledMessage.findMany({ ...args, where: { AND: [args.where, { projectId: owner.id }] } }) },
    messageLog: {
      findMany: args => db.messageLog.findMany({ ...args, where: { AND: [args.where, { projectId: owner.id }] } }),
      updateMany: args => db.messageLog.updateMany({ ...args, where: { AND: [args.where, { projectId: owner.id }] } }),
    },
    idempotencyRecord: { deleteMany: async () => ({ count: 0 }) },
  };
  await new RetentionService(scoped).run();
  for (const root of roots.slice(0, 3)) {
    const saved = await db.messageLog.findUnique({ where: { id: root.id } });
    assert.equal(saved.content, 'Original notice', 'active or unresolved conversation content must survive');
    assert.equal(saved.payload.extra.conversationId, root.id, 'original target and conversation capability must survive');
  }
  const redacted = await db.messageLog.findUnique({ where: { id: roots[3].id } });
  assert.equal(redacted.content, '[已按保留策略脱敏]');
  assert.equal(redacted.payload.redacted, true);
  const secret = 'conversation-regression-secret-2026';
  const service = new ConversationsService(db, {}, { get: () => secret }, { emit() {} });
  const recovered = await service.getPublic(roots[0].id, signConversationToken(roots[0].id, secret));
  assert.equal(recovered.canReply, true);
  assert.equal(recovered.replies[0].content, 'STORED');
  const reply = await service.replyPublic(roots[0].id, signConversationToken(roots[0].id, secret), { content: 'continued after retention', clientId: randomUUID() });
  assert.equal(reply.deliveryStatus, 'STORED');
});
