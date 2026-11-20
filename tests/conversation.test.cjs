const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata');
api('ts-node').register({ project: path.resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const load = name => require(path.resolve(__dirname, '../apps/api/src', `${name}.ts`));
const secret = 'conversation-regression-secret-2026';
const config = { get: () => secret };
const clientId = '10203040-1020-4020-8020-102030405060';

test('conversation credentials cannot substitute for read credentials or another message', () => {
  const tokens = load('common/token.util');
  assert.equal(typeof tokens.signConversationToken, 'function', 'independent conversation credentials must exist');
  const token = tokens.signConversationToken('m1', secret);
  assert.equal(tokens.verifyConversationToken('m1', token, secret), true);
  assert.equal(tokens.verifyConversationToken('m2', token, secret), false);
  assert.equal(tokens.verifyConversationToken('m1', tokens.signReadToken('m1', secret), secret), false);
  assert.equal(tokens.verifyReadToken('m1', token, secret), false);
});

test('explicit JPush RID overrides alias mode; all audience remains all despite a saved RID', () => {
  const { JpushAdapter } = load('adapters/jpush.adapter');
  const adapter = new JpushAdapter();
  assert.deepEqual(adapter.buildAudience({ audienceMode: 'alias', alias: 'old-alias' }, { registrationId: 'device-new' }), { registration_id: ['device-new'] });
  assert.equal(adapter.buildAudience({ audienceMode: 'all', registrationId: 'saved-rid' }, {}), 'all');
});

function fixture(options = {}) {
  const rows = [];
  const log = { id: 'm1', channelId: 'c1', channelType: 'JPUSH', title: 'Notice', content: 'Original', readAt: null, conversationClosedAt: null, conversationActivityAt: null,
    payload: { extra: { conversationId: 'm1', _jpushAudience: { registration_id: ['original-device'] }, _jpushAppKey: 'app-one' } }, ...options.log };
  const sent = [];
  const emitted = [];
  const prisma = {
    messageLog: { findUnique: async () => ({ ...log }), update: async ({ data }) => Object.assign(log, data), findMany: async () => [{ ...log }], count: async () => Number(log.conversationActivityAt !== null), },
    channel: { findUnique: async () => ({ id: 'c1', type: 'JPUSH', enabled: true, config: { appKey: 'app-one', masterSecret: 'hidden', registrationId: 'changed-device', audienceMode: 'registration_id' } }) },
    $queryRaw: async () => [{ id: 'm1' }],
    messageReply: {
      findUnique: async ({ where }) => rows.find(row => where.id ? row.id === where.id : row.messageId === where.messageId_author_clientId.messageId && row.author === where.messageId_author_clientId.author && row.clientId === where.messageId_author_clientId.clientId) || null,
      create: async ({ data }) => { if (rows.some(r => r.messageId === data.messageId && r.author === data.author && r.clientId === data.clientId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' }); const row = { id: `r${rows.length + 1}`, createdAt: new Date(), readAt: null, deliveryError: null, ...data }; rows.push(row); return { ...row }; },
      findMany: async args => {
        let result = rows.filter(row => row.messageId === args.where.messageId);
        const author = args.where.author;
        if (author) result = result.filter(row => row.author === author);
        if (args.where.readAt === null) result = result.filter(row => row.readAt === null);
        const olderThan = args.where.OR?.[0]?.createdAt?.lt;
        const olderId = args.where.OR?.[1]?.id?.lt;
        if (olderThan) result = result.filter(row => row.createdAt < olderThan || row.createdAt.getTime() === olderThan.getTime() && row.id < olderId);
        result.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        return result.slice(0, args.take).map(r => ({ ...r }));
      },
      updateMany: async ({ where, data }) => { let count = 0; for (const row of rows) { if (where.id?.in && !where.id.in.includes(row.id)) continue; if (typeof where.id === 'string' && row.id !== where.id) continue; if (where.author && row.author !== where.author) continue; if (where.readAt === null && row.readAt !== null) continue; Object.assign(row, data); count++; } return { count }; },
      count: async ({ where }) => where.author === 'device' && where.readAt === null ? rows.filter(row => row.author === 'device' && row.readAt === null).length : 0,
      groupBy: async ({ where }) => [{ messageId: 'm1', _count: { _all: rows.filter(row => row.messageId === 'm1' && row.author === 'device' && row.readAt === null).length } }],
      update: async ({ where, data }) => { const row = rows.find(r => r.id === where.id); Object.assign(row, data); return { ...row }; },
    },
  };
  let transaction = Promise.resolve();
  prisma.$transaction = async fn => {
    const previous = transaction;
    let release;
    transaction = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(prisma); } finally { release(); }
  };
  const { ConversationsService } = load('messages/conversations.service');
  const adapters = { get: () => ({ send: async (cfg, payload) => { sent.push({ cfg, payload }); return options.result || { success: true }; } }) };
  const realtime = { emit: (type, data) => emitted.push({ type, data }) };
  return { service: new ConversationsService(prisma, adapters, config, realtime), rows, log, sent, prisma, emitted };
}

test('public conversation rejects read token before revealing a title or writing a reply', async () => {
  const { signReadToken } = load('common/token.util');
  const { service, rows } = fixture();
  await assert.rejects(service.getPublic('m1', signReadToken('m1', secret)), error => error.getStatus() === 403);
  await assert.rejects(service.replyPublic('m1', signReadToken('m1', secret), { content: 'x', clientId }), error => error.getStatus() === 403);
  assert.equal(rows.length, 0);
});

test('device reply trims content, deduplicates UUID and rejects changed content for the same UUID', async () => {
  const { service, rows } = fixture();
  const token = load('common/token.util').signConversationToken('m1', secret);
  const first = await service.replyPublic('m1', token, { content: '  hello  ', clientId });
  const second = await service.replyPublic('m1', token, { content: 'hello', clientId });
  assert.equal(first.id, second.id); assert.equal(first.content, 'hello'); assert.equal(first.author, 'device'); assert.equal(rows.length, 1);
  await assert.rejects(service.replyPublic('m1', token, { content: 'changed', clientId }), error => error.getStatus() === 409);
  for (const content of ['   ', 'x'.repeat(4001)]) await assert.rejects(service.replyPublic('m1', token, { content, clientId }), error => error.getStatus() === 400);
  await assert.rejects(service.replyPublic('m1', token, { content: 'hello', clientId: 'bad' }), error => error.getStatus() === 400);
});

test('conversation fetch marks and emits only opposite-author read receipts for the visible page', async () => {
  const { service, rows, emitted } = fixture();
  for (let i = 0; i < 103; i++) rows.push({ id: `r${i}`, messageId: 'm1', author: i % 2 ? 'admin' : 'device', content: String(i), createdAt: new Date(i), readAt: null, deliveryStatus: 'STORED' });
  const token = load('common/token.util').signConversationToken('m1', secret);
  const result = await service.getPublic('m1', token);
  assert.equal(result.replies.length, 100); assert.equal(result.replies[0].id, 'r3');
  assert.equal(rows[1].readAt, null); assert.ok(rows[3].readAt); assert.equal(rows[4].readAt, null);
  assert.deepEqual(emitted[0].data, { kind: 'read', messageId: 'm1', reader: 'device', count: 50 });
  await service.getAdmin('m1'); assert.ok(rows[4].readAt);
  assert.equal(emitted[1].data.reader, 'admin');
  const count = emitted.length;
  await service.getAdmin('m1');
  assert.equal(emitted.length, count);
});

test('admin reply keeps original audience and conversation, duplicate request never pushes twice', async () => {
  const { service, sent } = fixture();
  const first = await service.replyAdmin('m1', { content: 'Answer', clientId });
  const second = await service.replyAdmin('m1', { content: 'Answer', clientId });
  assert.equal(first.id, second.id); assert.equal(first.deliveryStatus, 'ACCEPTED'); assert.equal(sent.length, 1);
  const { JpushAdapter } = load('adapters/jpush.adapter');
  assert.deepEqual(new JpushAdapter().buildAudience(sent[0].cfg, sent[0].payload.extra), { registration_id: ['original-device'] });
  assert.equal(sent[0].payload.extra.conversationId, 'm1'); assert.equal(sent[0].payload.extra.messageId, 'm1'); assert.equal(sent[0].payload.extra.replyId, first.id);
  assert.equal(load('common/token.util').verifyConversationToken('m1', sent[0].payload.extra.conversationToken, secret), true);
});

test('failed push persists the reply and exposes failure without reporting delivery', async () => {
  const { service, rows } = fixture({ result: { success: false, errorMessage: 'Invalid registration id' } });
  const reply = await service.replyAdmin('m1', { content: 'Answer', clientId });
  assert.equal(reply.deliveryStatus, 'FAILED'); assert.match(reply.deliveryError, /registration/); assert.equal(rows.length, 1);
});

test('legacy notifications cannot enable chat by guessing a message id', async () => {
  const { service } = fixture({ log: { payload: {} } });
  assert.equal((await service.getAdmin('m1')).canReply, false);
  await assert.rejects(service.replyAdmin('m1', { content: 'x', clientId }), error => error.getStatus() === 400);
});

test('normal and queued JPush capture all audience without leaking conversation token into log or queue', async () => {
  const { MessagesService } = load('messages/messages.service');
  for (const queued of [false, true]) {
    let row; let sent; let job;
    const prisma = { channel: { findUnique: async () => ({ id: 'c1', type: 'JPUSH', enabled: true, config: { appKey: 'app-one', audienceMode: 'all', registrationId: 'stale-rid' } }) }, messageLog: {
      create: async ({ data }) => (row = { id: 'notice1', ...data }), update: async ({ data }) => Object.assign(row, data), findUnique: async () => row,
    } };
    const service = new MessagesService(prisma, { get: () => ({ send: async (_cfg, payload) => { sent = payload; return { success: true }; } }) }, {}, {}, {}, config, { emitMessage() {} }, {}, {}, {}, { add: async (_name, data) => { job = data; } });
    service.asyncEnabled = queued;
    service.scheduleUnreadEmailFallback = async () => {};
    await service.enqueueOrSend({ kind: 'push', projectId: 'p1', channelId: 'c1', channelType: 'JPUSH', source: 'ADMIN_SEND', title: 'test', content: 'content' });
    assert.equal(row.payload.extra._jpushAudience, 'all'); assert.equal(row.toAddress, undefined);
    assert.equal(row.payload.extra.conversationId, 'notice1'); assert.equal(row.payload.extra.conversationToken, undefined);
    if (queued) assert.equal(job.payload.extra.conversationToken, undefined);
    else assert.equal(load('common/token.util').verifyConversationToken('notice1', sent.extra.conversationToken, secret), true);
  }
});

test('channel test sends alias snapshot and conversation capability but keeps token out of persisted logs', async () => {
  const { ChannelsService } = load('channels/channels.service'); let row; let sent;
  const prisma = { channel: { findUnique: async () => ({ id: 'c1', type: 'JPUSH', enabled: true, config: { appKey: 'app-one', audienceMode: 'alias', alias: 'family', registrationId: 'unused' } }) }, projectChannel: { findFirst: async () => null }, messageLog: {
    create: async ({ data }) => (row = { id: 'test1', ...data }), update: async ({ data }) => Object.assign(row, data),
  } };
  const service = new ChannelsService(prisma, { get: () => ({ send: async (_cfg, payload) => { sent = payload; return { success: true }; } }) }, { emitMessage() {} }, { log: async () => {} }, config);
  await service.test('c1');
  assert.equal(row.toAddress, 'family'); assert.deepEqual(row.payload.extra._jpushAudience, { alias: ['family'] });
  assert.equal(row.payload.extra.conversationToken, undefined);
  assert.equal(load('common/token.util').verifyConversationToken('test1', sent.extra.conversationToken, secret), true);
});

test('project simulate JPush uses tracked send path so read and chat ids exist before delivery', async () => {
  const { MessagesService } = load('messages/messages.service'); let tracked = 0; let direct = 0;
  const service = new MessagesService({ project: { findUnique: async () => ({ id: 'p1', name: 'test' }) }, messageLog: { create: async () => ({ id: 'bad' }) } }, { get: () => ({ test: async () => { direct++; return { success: true }; } }) }, { listBindings: async () => [{ enabled: true, channelId: 'c1', channel: { id: 'c1', enabled: true, type: 'JPUSH', name: 'test', config: {} } }] });
  service.enqueueOrSend = async options => { tracked++; assert.equal(options.forceSync, true); assert.equal(options.channelId, 'c1'); return { success: true, messageId: 'tracked1' }; };
  await service.simulateSend('p1', { title: 'test' });
  assert.equal(tracked, 1); assert.equal(direct, 0);
});

test('JPush refuses a changed application before any network call or disclosure', async () => {
  const { JpushAdapter } = load('adapters/jpush.adapter');
  const http = load('adapters/http.util'); const oldAssert = http.assertSafeOutboundUrl; const oldFetch = http.fetchJson; let networks = 0;
  http.assertSafeOutboundUrl = async () => { networks++; };
  http.fetchJson = async () => { networks++; return { ok: true, data: { msg_id: 'fake' } }; };
  try {
    const result = await new JpushAdapter().send({ appKey: 'different-app', masterSecret: 'secret', audienceMode: 'all' }, { content: 'private', extra: { _jpushAppKey: 'original-app', _jpushAudience: 'all', conversationToken: 'private-token' } });
    assert.equal(result.success, false); assert.match(result.errorMessage, /应用/); assert.equal(networks, 0);
  } finally { http.assertSafeOutboundUrl = oldAssert; http.fetchJson = oldFetch; }
});

test('tracked resend retains original alias, multiple RIDs and broadcast after channel edits', async () => {
  const { MessagesService } = load('messages/messages.service');
  for (const audience of [{ alias: ['family'] }, { registration_id: ['a', 'b'] }, 'all']) {
    const original = { id: 'original', projectId: 'p1', channelId: 'c1', channelType: 'JPUSH', readAt: null, title: 'original', content: 'body', toAddress: audience?.alias?.[0] || audience?.registration_id?.[0], payload: { extra: { _jpushAudience: audience, _jpushAppKey: 'original-app', conversationId: 'original' } } };
    let resent;
    const service = new MessagesService({ messageLog: { findUnique: async () => original }, project: { findUnique: async () => ({ enabled: true }) } }, {}, { resolveChannel: async () => ({ id: 'c1' }) });
    service.enqueueOrSend = async options => { resent = options; return {}; };
    service.sendPush = async options => { resent = options; return {}; };
    await service.resend('original');
    assert.deepEqual(resent.jpushTarget, { audience, appKey: 'original-app' });
    assert.equal(resent.extra?.registrationId, undefined);
  }
});

test('nullable message fields still return strings to device conversation parser', async () => {
  const { service } = fixture({ log: { title: null, content: null } });
  const result = await service.getPublic('m1', load('common/token.util').signConversationToken('m1', secret));
  assert.equal(result.title, ''); assert.equal(result.content, '');
});

test('tracked resend still rejects a disabled project or removed binding', async () => {
  const { MessagesService } = load('messages/messages.service');
  const original = { id: 'm1', projectId: 'p1', channelId: 'c1', channelType: 'JPUSH', payload: { extra: { _jpushAudience: 'all', _jpushAppKey: 'app' } } };
  let sent = 0;
  const service = new MessagesService({ messageLog: { findUnique: async () => original }, project: { findUnique: async () => ({ enabled: false }) } }, {}, { resolveChannel: async () => { throw new Error('binding disabled'); } });
  service.enqueueOrSend = async () => { sent++; return {}; };
  await assert.rejects(service.resend('m1'), /禁用/); assert.equal(sent, 0);
  service.prisma.project.findUnique = async () => ({ enabled: true });
  await assert.rejects(service.resend('m1'), /binding disabled/); assert.equal(sent, 0);
});

test('inbox filters eligible threads and reports unread device replies across the full history', async () => {
  const { service, log } = fixture();
  const unread = [{ id: 'device-unread', messageId: 'm1', author: 'device', readAt: null }];
  log.conversationActivityAt = new Date('2026-02-03T05:00:00.000Z');
  const query = [];
  service.prisma.messageLog.findMany = async args => { query.push(args); return [{ ...log, replies: [{ id: 'last', author: 'device', content: 'latest', createdAt: log.conversationActivityAt }] }]; };
  service.prisma.messageLog.count = async args => args.where?.replies?.some?.author === 'device' ? 1 : 1;
  service.prisma.messageReply.count = async args => args.where.author === 'device' && args.where.readAt === null ? unread.length : 0;
  service.prisma.messageReply.groupBy = async () => [{ messageId: 'm1', _count: { _all: 1 } }];
  service.prisma.messageReply.findMany = async () => [{ id: 'last', author: 'device', content: 'latest', createdAt: log.conversationActivityAt, readAt: null }];

  const result = await service.list({ status: 'open', unread: true, search: 'Notice', page: 1, pageSize: 20 });

  assert.equal(result.unreadCount, 1);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].messageId, 'm1');
  assert.equal(result.items[0].lastReply.content, 'latest');
  assert.equal(result.items[0].status, 'open');
  assert.deepEqual(query[0].where.AND[1].replies.some, { author: 'device', readAt: null });
  assert.deepEqual(query[0].orderBy, [{ conversationActivityAt: 'desc' }, { id: 'desc' }]);
});

test('admin history pages older replies and only marks the returned device replies read', async () => {
  const { service, rows, log } = fixture();
  for (let i = 0; i < 4; i++) rows.push({ id: `r${i + 1}`, messageId: 'm1', author: i === 2 ? 'admin' : 'device', content: `reply ${i + 1}`, createdAt: new Date(1000 * (i + 1)), readAt: null, deliveryStatus: 'STORED', deliveryError: null });
  const page = await service.getAdmin('m1', { limit: 2 });
  assert.deepEqual(page.replies.map(reply => reply.id), ['r3', 'r4']);
  assert.equal(page.hasOlder, true);
  assert.equal(page.nextCursor, 'r3');
  assert.ok(rows[3].readAt);
  assert.equal(rows[2].readAt, null);

  const older = await service.getAdmin('m1', { limit: 2, before: page.nextCursor });
  assert.deepEqual(older.replies.map(reply => reply.id), ['r1', 'r2']);
  assert.equal(older.hasOlder, false);
  assert.equal(older.nextCursor, null);
  assert.ok(rows[0].readAt);
  assert.equal(log.conversationActivityAt, null);
});

test('same UUID remains idempotent after close, changed UUID is rejected, and reopen enables replies', async () => {
  const { service, rows, log, sent, emitted } = fixture();
  const first = await service.replyAdmin('m1', { content: 'saved answer', clientId });
  const closed = await service.update('m1', { status: 'closed' });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedAt instanceof Date || typeof closed.closedAt === 'string', true);
  assert.equal((await service.replyAdmin('m1', { content: 'saved answer', clientId })).id, first.id);
  await assert.rejects(service.replyAdmin('m1', { content: 'new answer', clientId: '20203040-1020-4020-8020-102030405060' }), error => error.getStatus() === 409);
  await assert.rejects(service.replyPublic('m1', require('../apps/api/src/common/token.util.ts').signConversationToken('m1', secret), { content: 'device answer', clientId: '30203040-1020-4020-8020-102030405060' }), error => error.getStatus() === 409);
  assert.equal(sent.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(log.conversationClosedAt instanceof Date, true);
  assert.equal(emitted.filter(event => event.data.kind === 'status').length, 1);

  await service.update('m1', { status: 'open' });
  const reopenedReply = await service.replyAdmin('m1', { content: 'reopened', clientId: '40203040-1020-4020-8020-102030405060' });
  assert.equal(reopenedReply.content, 'reopened');
  assert.equal(rows.length, 2);
});

test('concurrent first replies with the same UUID create and push exactly once', async () => {
  const { service, rows, sent } = fixture();
  const result = await Promise.all(Array.from({ length: 12 }, () => service.replyAdmin('m1', { content: 'once only', clientId })));
  assert.equal(new Set(result.map(reply => reply.id)).size, 1);
  assert.equal(rows.length, 1);
  assert.equal(sent.length, 1);
});

test('reply insertion waits for the message row lock and fails when close committed first', async () => {
  const { service, rows, log } = fixture();
  log.conversationActivityAt = new Date();
  const close = service.update('m1', { status: 'closed' });
  const reply = service.replyPublic('m1', load('common/token.util').signConversationToken('m1', secret), { content: 'late response', clientId });
  const [closed, rejected] = await Promise.allSettled([close, reply]);
  assert.equal(closed.status, 'fulfilled');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reason.getStatus(), 409);
  assert.equal(log.conversationClosedAt instanceof Date, true);
  assert.equal(rows.length, 0);
});

test('reply commits inbox activity and event metadata only once after its idempotency record exists', async () => {
  const { service, log, emitted, prisma } = fixture();
  const result = await service.replyPublic('m1', require('../apps/api/src/common/token.util.ts').signConversationToken('m1', secret), { content: 'question', clientId });
  assert.equal(result.id, 'r1');
  assert.ok(log.conversationActivityAt instanceof Date);
  const event = emitted.find(item => item.data.kind === 'reply');
  assert.equal(event.type, 'conversation');
  assert.deepEqual(event.data, { kind: 'reply', messageId: 'm1', replyId: 'r1', author: 'device', createdAt: result.createdAt.toISOString(), deliveryStatus: 'STORED' });
  const previousCount = emitted.length;
  await service.replyPublic('m1', require('../apps/api/src/common/token.util.ts').signConversationToken('m1', secret), { content: 'question', clientId });
  assert.equal(emitted.length, previousCount);
  assert.equal((await prisma.messageLog.count()).valueOf(), 1);
});


test('queue generates original read and conversation capabilities immediately before delivery', async () => {
  const { SendProcessor } = load('queue/send.processor'); const previous = process.env.UNSUBSCRIBE_SECRET; process.env.UNSUBSCRIBE_SECRET = secret;
  const row = { id: 'q1', status: 'PENDING', payload: {}, readAt: null }; let sent;
  const prisma = { messageLog: { findUnique: async () => row, update: async ({ data }) => Object.assign(row, data), updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; } }, channel: { findUnique: async () => ({ id: 'c1', enabled: true, type: 'JPUSH', config: { appKey: 'app-one', audienceMode: 'registration_id', registrationId: 'changed' } }) } };
  const worker = new SendProcessor(prisma, { get: () => ({ send: async (_cfg, payload) => { sent = payload; return { success: true }; } }) }, {}, { emitMessage() {} }, {});
  try {
    await worker.process({ data: { messageId: 'q1', channelId: 'c1', kind: 'push', payload: { content: 'notice', extra: { _jpushAudience: { registration_id: ['original'] }, _jpushAppKey: 'app-one', conversationId: 'q1' } } }, attemptsMade: 0, opts: {} });
    assert.equal(row.status, 'SUCCESS'); assert.equal(row.payload.extra.conversationToken, undefined); assert.equal(row.payload.extra.conversationId, 'q1');
    assert.equal(load('common/token.util').verifyConversationToken('q1', sent.extra.conversationToken, secret), true);
    assert.deepEqual(sent.extra._jpushAudience, { registration_id: ['original'] });
  } finally { if (previous === undefined) delete process.env.UNSUBSCRIBE_SECRET; else process.env.UNSUBSCRIBE_SECRET = previous; }
});
