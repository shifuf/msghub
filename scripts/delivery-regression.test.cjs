const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata');
api('ts-node').register({ project: path.resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const load = (name) => require(path.resolve(__dirname, '../apps/api/src', `${name}.ts`));

test('cleanup refuses invalid dates before any deletion', async () => {
  const { MessagesService } = load('messages/messages.service');
  let deleted = false;
  const service = new MessagesService({ messageLog: { deleteMany: async () => { deleted = true; return { count: 0 }; } } });
  await assert.rejects(service.cleanup({ before: 'not-a-date' }), /before/);
  assert.equal(deleted, false);
});

test('CSV makes spreadsheet formula cells inert', async () => {
  const { MessagesService } = load('messages/messages.service');
  const service = new MessagesService({ messageLog: { findMany: async () => [{ id: 'm1', createdAt: new Date(), title: '=1+1' }] } });
  assert.match(await service.exportCsv({}), /'=1\+1/);
});

test('adapter exceptions become failed attempts', async () => {
  const { safeAdapterSend } = load('common/delivery.util');
  const result = await safeAdapterSend({ get: () => ({ send: async () => { throw new Error('invalid config'); } }) }, 'WEBHOOK', {}, {});
  assert.equal(result.success, false);
  assert.match(result.errorMessage, /invalid config/);
});

test('cancel cannot overwrite an already running task', async () => {
  const { SchedulesService } = load('schedules/schedules.service');
  const row = { id: 's1', status: 'RUNNING' };
  const service = new SchedulesService({ scheduledMessage: {
    findUnique: async () => ({ ...row, status: 'PENDING' }),
    updateMany: async ({ where, data }) => { if (row.status !== where.status) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    update: async ({ data }) => Object.assign(row, data),
  } }, {});
  await assert.rejects(service.cancel('s1'));
  assert.equal(row.status, 'RUNNING');
});

test('overdue daily task skips missed occurrences', async () => {
  const { SchedulesService } = load('schedules/schedules.service');
  const row = { id: 's1', status: 'PENDING', projectId: 'p1', kind: 'push', cron: 'daily', runAt: new Date(Date.now() - 4 * 86400000), variables: {} };
  const service = new SchedulesService({ scheduledMessage: {
    findUnique: async () => ({ ...row }),
    updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; },
    update: async ({ data }) => Object.assign(row, data),
  } }, { sendPush: async () => ({ success: true }) });
  await service.executeOne('s1');
  assert.equal(row.status, 'PENDING');
  assert.ok(row.runAt.getTime() > Date.now());
});

test('template required variables include blocks and nested paths', () => {
  const { extractTemplateVars, missingTemplateVars } = load('common/token.util');
  const required = extractTemplateVars('{{#if user.active}}{{user.name}}{{/if}}{{#each items}}{{this.title}}{{/each}}');
  assert.ok(required.includes('user.active'));
  assert.ok(required.includes('user.name'));
  assert.ok(required.includes('items'));
  assert.deepEqual(missingTemplateVars(['user.name', 'code'], { user: { name: 'Ada' } }), ['code']);
});

test('expired running schedules become auditable uncertainty, never auto resend', async () => {
  const { SchedulesService } = load('schedules/schedules.service');
  const row = { id: 's1', status: 'RUNNING', leaseUntil: new Date(0) };
  const service = new SchedulesService({ scheduledMessage: {
    updateMany: async ({ where, data }) => { if (where.status === row.status) Object.assign(row, data); return { count: 1 }; },
    findMany: async () => [],
  } }, {});
  await service.tick();
  assert.equal(row.status, 'UNCERTAIN');
});

test('quota reservation serializes admission and log creation', async () => {
  const { EmailPolicyService } = load('email-policy/email-policy.service');
  let used = 0;
  let tail = Promise.resolve();
  const prisma = { $transaction: (fn) => {
    const current = tail.then(() => fn({
      $executeRaw: async () => 1,
      project: { findUnique: async () => ({ dailyEmailQuota: 1 }) },
      messageLog: { count: async () => used, create: async () => ({ id: `m${++used}` }) },
    })); tail = current.catch(() => {}); return current;
  } };
  const service = new EmailPolicyService(prisma);
  const outcomes = await Promise.allSettled([1, 2, 3].map(() => service.reserveEmailLog({ projectId: 'p1', channelType: 'SMTP', source: 'OPEN_API' })));
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(used, 1);
});

test('invalid stored timezone falls back to configured default', () => {
  const { QuietHoursService } = load('common/quiet-hours.service');
  assert.doesNotThrow(() => new QuietHoursService().shouldHold({ quietHoursEnabled: true, quietStart: '22:00', quietEnd: '08:00', quietTimezone: 'not-a-zone' }, 'normal'));
});

test('worker never resends a message with an unresolved delivery start', async () => {
  const { SendProcessor } = load('queue/send.processor');
  const row = { id: 'm1', status: 'PENDING', deliveryStartedAt: new Date(0) };
  let sends = 0;
  const prisma = { messageLog: { findUnique: async () => row, updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; }, update: async ({ data }) => Object.assign(row, data) }, channel: { findUnique: async () => ({ type: 'BARK', enabled: true }) } };
  const worker = new SendProcessor(prisma, { get: () => ({ send: async () => { sends++; return { success: true }; } }) }, {}, { emitMessage() {} }, {});
  await worker.process({ data: { messageId: 'm1', channelId: 'c1', kind: 'email' }, attemptsMade: 1, opts: {} });
  assert.equal(sends, 0);
  assert.equal(row.status, 'FAILED');
  assert.match(row.errorMessage, /UNKNOWN/);
});

test('SMTP fallback acceptance does not mark the source as read', async () => {
  const { MessagesService } = load('messages/messages.service');
  const row = { id: 'm1', projectId: 'p1', title: 'notice', status: 'SUCCESS', channelType: 'BARK', payload: {}, readAt: null };
  const prisma = { messageLog: { findUnique: async () => row, update: async ({ data }) => Object.assign(row, data) }, project: { findUnique: async () => ({ id: 'p1', unreadEmailFallbackEnabled: true }) }, scheduledMessage: { updateMany: async () => ({ count: 1 }) } };
  const service = new MessagesService(prisma, {}, {}, {}, {}, {}, { emitMessage() {} }, { resolveAdminEmail: async () => 'test@example.invalid' });
  service.sendEmail = async () => ({ success: true, status: 'SUCCESS', messageId: 'email1' });
  await service.executeUnreadEmailFallback({ id: 's1', projectId: 'p1', messageId: 'm1', variables: {} });
  assert.equal(row.readAt, null);
  assert.equal(row.payload.emailFallback.emailMessageId, 'email1');
});

test('project dispatch continues after a throwing first channel', async () => {
  const { MessagesService } = load('messages/messages.service');
  const tried = [];
  const service = new MessagesService({ project: { findUnique: async () => ({ id: 'p1' }) } }, {}, { listDispatchChannels: async () => [{ id: 'a', type: 'WEBHOOK' }, { id: 'b', type: 'BARK' }] }, {}, {}, {}, {}, {}, {}, { shouldHold: () => false, parsePriority: () => 'NORMAL' });
  service.enqueueOrSend = async ({ channelId }) => { tried.push(channelId); if (channelId === 'a') throw new Error('config'); return { success: true, status: 'SUCCESS', messageId: 'm2' }; };
  const result = await service.dispatchByProject({ projectId: 'p1', source: 'OPEN_API', title: 'hello' });
  assert.equal(result.success, true);
  assert.deepEqual(tried, ['a', 'b']);
});

test('cleanup excludes active schedule references and pending deliveries', async () => {
  const { MessagesService } = load('messages/messages.service');
  let where;
  const service = new MessagesService({ scheduledMessage: { findMany: async () => [{ messageId: 'protected' }] }, messageLog: { deleteMany: async (args) => { where = args.where; return { count: 1 }; } } });
  await service.cleanup({ before: '2025-01-01' });
  assert.deepEqual(where.status.in, ['SUCCESS', 'FAILED']);
  assert.deepEqual(where.id.notIn, ['protected']);
});

test('expired unfinished idempotency reservations are never automatically reclaimed', async () => {
  const { IdempotencyService } = load('common/idempotency.service');
  const service = new IdempotencyService({ idempotencyRecord: { findUnique: async () => ({ id: 'i1', response: null, expiresAt: new Date(0) }) } });
  assert.deepEqual(await service.begin({ projectId: 'p1', key: 'k', ttlMin: 1 }), { hit: false, inFlight: true });
});

test('stale idempotency owner cannot commit a replacement reservation', async () => {
  const { IdempotencyService } = load('common/idempotency.service');
  let row = { owner: 'new', response: null };
  const service = new IdempotencyService({ idempotencyRecord: { updateMany: async ({ where, data }) => { if (where.owner !== row.owner) return { count: 0 }; Object.assign(row, data); return { count: 1 }; } } });
  await assert.rejects(service.commit({ projectId: 'p1', key: 'k', owner: 'old', response: { ok: true }, ttlMin: 1 }), /ownership/);
  assert.equal(row.response, null);
});

test('passive channel health never sends test notifications', async () => {
  const { ChannelHealthService } = load('channels/channel-health.service');
  let sends = 0;
  const service = new ChannelHealthService({ channel: { findUnique: async () => ({ id: 'c1', type: 'BARK', config: {} }), update: async () => ({}) } }, { get: () => ({ validateConfig() {}, test: async () => { sends++; return { success: true }; } }) }, {}, {});
  const result = await service.probeOne('c1');
  assert.equal(sends, 0);
  assert.equal(result.deliveryVerified, false);
});

test('a successful external send followed by failed persistence never invokes failover', async () => {
  const { MessagesService } = load('messages/messages.service');
  const { DeliveryUncertainError } = load('common/delivery.util');
  let sends = 0;
  let failovers = 0;
  const prisma = { messageLog: {
    create: async ({ data }) => ({ id: 'm1', ...data }),
    findUnique: async () => ({ id: 'm1' }),
    update: async ({ data }) => { if (data.status === 'SUCCESS') throw new Error('database lost'); return { id: 'm1', ...data }; },
  }, channel: { findUnique: async () => ({ id: 'c1', enabled: true, type: 'BARK' }) } };
  const service = new MessagesService(prisma, { get: () => ({ send: async () => { sends++; return { success: true }; } }) }, {}, {}, {}, { get: () => 'a-secure-test-secret-of-32-characters' }, { emitMessage() {} });
  service.tryFailoverChannels = async () => { failovers++; };
  await assert.rejects(service.enqueueOrSend({ projectId: 'p1', channelId: 'c1', channelType: 'BARK', kind: 'push', source: 'OPEN_API', title: 'test', forceSync: true }), DeliveryUncertainError);
  assert.equal(sends, 1);
  assert.equal(failovers, 0);
});

test('queue outage keeps a durable pending message without synchronously sending', async () => {
  const { MessagesService } = load('messages/messages.service');
  let sends = 0;
  const row = { id: 'm1' };
  const prisma = { messageLog: { create: async ({ data }) => Object.assign(row, data), update: async ({ data }) => Object.assign(row, data), findUnique: async () => row } };
  const service = new MessagesService(prisma, { get: () => ({ send: async () => { sends++; return { success: true }; } }) }, {}, {}, {}, { get: () => 'a-secure-test-secret-of-32-characters' }, { emitMessage() {} }, {}, {}, {}, { add: async () => { throw new Error('redis offline'); } });
  service.asyncEnabled = true;
  const result = await service.enqueueOrSend({ projectId: 'p1', channelId: 'c1', channelType: 'BARK', kind: 'push', source: 'OPEN_API', title: 'test' });
  assert.equal(result.status, 'PENDING');
  assert.equal(row.payload._deliveryMode, 'queue');
  assert.equal(sends, 0);
});

test('missing all email template variables is rejected before send', async () => {
  const { MessagesService } = load('messages/messages.service');
  const service = new MessagesService({ project: { findUnique: async () => ({ enabled: true }) } }, {}, { resolveChannel: async () => ({ type: 'SMTP' }) }, { resolve: async () => ({ code: 'verify', variables: ['code'], subject: '{{code}}', htmlBody: '{{code}}' }) }, {}, { get: () => '' }, {}, {}, { assertNotSuppressed: async () => {} });
  await assert.rejects(service.sendEmail({ projectId: 'p1', to: 'test@example.invalid', template: 'verify', source: 'OPEN_API' }), /缺少变量: code/);
});

test('manual queue retry resets a definite failure before requeueing', async () => {
  const { QueueAdminService } = load('queue/queue-admin.service');
  const row = { status: 'FAILED', deliveryStartedAt: null, errorMessage: 'rejected' };
  let retried = false;
  const service = new QueueAdminService({ getJob: async () => ({ data: { messageId: 'm1' }, getState: async () => 'failed', retry: async () => { assert.equal(row.status, 'PENDING'); retried = true; } }) }, { messageLog: { updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; } } });
  await service.retryFailed('send-m1');
  assert.equal(retried, true);
});

test('uncertain schedule retry requires explicit duplicate acknowledgement', async () => {
  const { SchedulesService } = load('schedules/schedules.service');
  const service = new SchedulesService({}, {});
  await assert.rejects(service.resolve('s1', { action: 'retry' }), /重复/);
});

test('device history leaves SMTP fallback source unread until actual read', async () => {
  const { MessagesService } = load('messages/messages.service');
  const row = { id: 'm1', readAt: null, payload: { emailFallback: { at: new Date().toISOString() } }, channelType: 'JPUSH' };
  const service = new MessagesService({ messageLog: { findMany: async () => [row], count: async () => 1 }, scheduledMessage: { findMany: async () => [] }, channel: { findMany: async () => [] } });
  const result = await service.listDevicePushHistory({});
  assert.equal(result.items[0].unread, true);
  assert.equal(result.items[0].readAt, null);
  assert.equal(result.items[0].readVia, null);
});

test('async failover binds its own read token, metadata and unread reminder', async () => {
  const { SendProcessor } = load('queue/send.processor');
  const { verifyReadToken } = load('common/token.util');
  const secret = 'isolated-test-secret-with-32-characters';
  const old = process.env.UNSUBSCRIBE_SECRET; process.env.UNSUBSCRIBE_SECRET = secret;
  try {
    const rows = new Map([['m1', { id: 'm1', projectId: 'p1', channelId: 'c1', channelType: 'BARK', source: 'OPEN_API', status: 'PENDING', priority: 'HIGH', eventCode: 'incident', dedupeKey: 'dedupe', payload: {} }]]);
    let delivered;
    let reminder;
    const prisma = { messageLog: {
      findUnique: async ({ where }) => rows.get(where.id),
      create: async ({ data }) => { const row = { id: 'fo1', ...data }; rows.set(row.id, row); return row; },
      update: async ({ where, data }) => Object.assign(rows.get(where.id), data),
      updateMany: async ({ where, data }) => { Object.assign(rows.get(where.id), data); return { count: 1 }; },
    }, channel: { findUnique: async () => ({ id: 'c1', type: 'BARK', enabled: true }) },
      project: { findUnique: async () => ({ enabled: true, unreadEmailFallbackEnabled: true, unreadEmailFallbackHours: 10 }) },
      scheduledMessage: { upsert: async ({ create }) => { reminder = create; return create; } },
    };
    const worker = new SendProcessor(prisma, { get: (type) => ({ send: async (_config, payload) => { if (type === 'BARK') return { success: false, errorMessage: 'rejected' }; delivered = payload; return { success: true }; } }) }, { listFailoverChannels: async () => [{ id: 'c2', type: 'GOTIFY', config: {} }] }, { emitMessage() {} }, { shouldSkipBackupAlert: async () => true });
    await assert.rejects(worker.process({ data: { messageId: 'm1', projectId: 'p1', channelId: 'c1', kind: 'push', payload: { title: 'incident', extra: { messageId: 'm1', readToken: 'old' } } }, attemptsMade: 0, opts: { attempts: 1 } }), /rejected/);
    assert.equal(delivered.extra.messageId, 'fo1');
    assert.equal(verifyReadToken('fo1', delivered.extra.readToken, secret), true);
    assert.equal(rows.get('fo1').payload.extra.messageId, 'fo1');
    assert.equal(rows.get('fo1').priority, 'HIGH');
    assert.equal(rows.get('fo1').eventCode, 'incident');
    assert.equal(rows.get('fo1').parentId, 'm1');
    assert.equal(reminder.messageId, 'fo1');
  } finally { if (old === undefined) delete process.env.UNSUBSCRIBE_SECRET; else process.env.UNSUBSCRIBE_SECRET = old; }
});

test('manual retry rejects an uncertain delivery without enqueuing', async () => {
  const { QueueAdminService } = load('queue/queue-admin.service');
  let retried = false;
  const service = new QueueAdminService({ getJob: async () => ({ data: { messageId: 'm1' }, getState: async () => 'failed', retry: async () => { retried = true; } }) }, { messageLog: { updateMany: async () => ({ count: 0 }) } });
  await assert.rejects(service.retryFailed('send-m1'), /结果未知/);
  assert.equal(retried, false);
});

test('failed queue removal rejects waiting and active jobs', async () => {
  const { QueueAdminService } = load('queue/queue-admin.service');
  for (const state of ['waiting', 'active', 'delayed', 'completed', 'paused']) {
    let removed = false;
    const service = new QueueAdminService({ getJob: async () => ({ getState: async () => state, remove: async () => { removed = true; } }) }, {});
    await assert.rejects(service.removeFailed('send-m1'), /失败/);
    assert.equal(removed, false);
  }
});

test('ambiguous Redis retry failure keeps durable pending state recoverable', async () => {
  const { QueueAdminService } = load('queue/queue-admin.service');
  const row = { status: 'FAILED', deliveryStartedAt: null };
  const service = new QueueAdminService({ getJob: async () => ({ data: { messageId: 'm1' }, getState: async () => 'failed', retry: async () => { throw new Error('Redis reply lost after retry accepted'); } }) }, { messageLog: { updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; } } });
  const result = await service.retryFailed('send-m1');
  assert.equal(row.status, 'PENDING');
  assert.equal(result.recoveryPending, true);
});

test('removal racing with retry cannot erase the durable message or stable recovery job', async () => {
  const { QueueAdminService } = load('queue/queue-admin.service');
  const { MessagesService } = load('messages/messages.service');
  const row = { id: 'm1', status: 'PENDING', projectId: 'p1', channelId: 'c1', channelType: 'BARK', payload: { _deliveryMode: 'queue', title: 'keep' } };
  let present = true;
  let recovered;
  const queue = { getJob: async () => present ? { getState: async () => 'failed', remove: async () => { present = false; } } : null, add: async (_name, data, options) => { recovered = { data, options }; } };
  await new QueueAdminService(queue, {}).removeFailed('send-m1');
  const messages = new MessagesService({ messageLog: { findMany: async () => [row] } }, {}, {}, {}, {}, {}, {}, {}, {}, {}, queue);
  messages.lastRetentionAt = Date.now();
  await messages.recoverPending();
  assert.equal(row.status, 'PENDING');
  assert.equal(recovered.options.jobId, 'send-m1');
  assert.equal(recovered.data.messageId, 'm1');
});

test('batch preview deduplicates targets, validates SMTP recipient and never reserves quota', async () => {
  const { MessagesService } = load('messages/messages.service');
  let reserved = false;
  const service = new MessagesService({ project: { findUnique: async () => ({ enabled: true, dailyEmailQuota: 3 }) }, messageLog: { count: async () => 2 } }, {}, { resolveChannel: async (_id, selector) => ({ id: selector.channelId || 'mail', type: selector.channelId === 'push' ? 'BARK' : 'SMTP' }) }, {}, {}, {}, {}, {}, { isSuppressed: async () => ({ blocked: false }), reserveEmailLog: async () => { reserved = true; } });
  const result = await service.batchPreview({ projectId: 'p1', channelIds: ['mail', 'mail', 'push'], channelTypes: ['SMTP'], to: 'invalid', content: 'body' });
  assert.equal(result.duplicates.length, 2);
  assert.equal(result.items.find(i => i.channelId === 'mail').valid, false);
  assert.equal(result.estimatedSendAttempts, 1);
  assert.equal(result.smtpQuota.remaining, 1);
  assert.equal(result.smtpQuota.advisory, true);
  assert.equal(reserved, false);
});

test('batch preview unresolved explicit channel types do not fall back to all bindings', async () => {
  const { MessagesService } = load('messages/messages.service');
  const service = new MessagesService({ project: { findUnique: async () => ({ enabled: true }) }, messageLog: { count: async () => 0 } }, {}, { resolveChannel: async () => { throw new Error('not bound'); }, listBindings: async () => { throw new Error('must not expand audience'); } }, {}, {}, {}, {}, {}, {});
  const result = await service.batchPreview({ projectId: 'p1', channelTypes: ['SMTP'], content: 'body' });
  assert.equal(result.items[0].valid, false);
  assert.equal(result.estimatedSendAttempts, 0);
});

test('dry run explicitly rejects event until event preview is supported', async () => {
  const { MessagesService } = load('messages/messages.service');
  await assert.rejects(new MessagesService({}).dryRun('p1', { event: 'incident', title: 'ignored' }), /event/);
});

test('production SMTP rejects missing or insecure SITE_URL before sending', async () => {
  const { MessagesService } = load('messages/messages.service');
  const keys = ['APP_ENV', 'NODE_ENV', 'SITE_URL', 'PUBLIC_BASE_URL', 'APP_URL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.APP_ENV = 'production'; process.env.NODE_ENV = 'production';
    delete process.env.SITE_URL; delete process.env.PUBLIC_BASE_URL; delete process.env.APP_URL;
    const service = new MessagesService({ project: { findUnique: async () => ({ enabled: true }) } }, {}, { resolveChannel: async () => ({ type: 'SMTP' }) }, {}, {}, { get: () => 'a-secure-test-secret-of-32-characters' }, {}, {}, { assertNotSuppressed: async () => {} });
    await assert.rejects(service.sendEmail({ projectId: 'p1', to: 'test@example.invalid', source: 'OPEN_API', content: 'body' }), /SITE_URL/);
    process.env.SITE_URL = 'http://example.com';
    await assert.rejects(service.sendEmail({ projectId: 'p1', to: 'test@example.invalid', source: 'OPEN_API', content: 'body' }), /HTTPS/);
    delete process.env.SITE_URL;
    service.emailPolicy.isSuppressed = async () => ({ blocked: false });
    service.prisma.messageLog = { count: async () => 0 };
    service.channels.resolveChannel = async () => ({ id: 'mail', type: 'SMTP' });
    const preview = await service.batchPreview({ projectId: 'p1', channelIds: ['mail'], to: 'test@example.invalid', content: 'body' });
    assert.equal(preview.items[0].valid, false);
    assert.match(preview.items[0].errorMessage, /SITE_URL/);
  } finally { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
});

test('login validates unconditional AST variables without requiring declared optional suggestions', async () => {
  const { MessagesService } = load('messages/messages.service');
  const Handlebars = api('handlebars');
  const template = { code: 'login', isSystem: true, variables: ['appName', 'code', 'expireMinutes', 'ip', 'time'], subject: '{{appName}}', htmlBody: '{{code}} {{expireMinutes}}{{#if ip}} {{ip}} {{time}}{{/if}}' };
  const service = new MessagesService({ project: { findUnique: async () => ({ enabled: true }) } }, {}, { resolveChannel: async () => ({ id: 'mail', type: 'SMTP' }) }, { resolve: async () => template, render: (source, vars) => Handlebars.compile(source)(vars) }, {}, {}, {}, {}, { assertNotSuppressed: async () => {} });
  let sends = 0;
  service.enqueueOrSend = async () => { sends++; return { success: true }; };
  service.quietHours = new (load('common/quiet-hours.service').QuietHoursService)();
  const variables = { appName: 'App', code: '123456', expireMinutes: 5, unsubscribeUrl: 'https://example.invalid/unsubscribe' };
  assert.equal((await service.sendEmail({ projectId: 'p1', source: 'OPEN_API', to: 'test@example.invalid', template: 'login', variables })).success, true);
  await assert.rejects(service.sendEmail({ projectId: 'p1', source: 'OPEN_API', to: 'test@example.invalid', template: 'login', variables: { ...variables, code: undefined } }), /缺少变量: code/);
  assert.equal(sends, 1);
});

test('required template paths omit optional sections while retaining nested mandatory paths', () => {
  const { extractRequiredTemplateVars } = load('common/token.util');
  assert.deepEqual(extractRequiredTemplateVars('{{user.name}}{{#if ip}}{{ip}}{{time}}{{/if}}{{#unless hidden}}{{note}}{{/unless}}'), ['user.name']);
});

test('built-in reset template accepts code or URL but rejects neither', async () => {
  const { MessagesService } = load('messages/messages.service');
  const template = { code: 'reset_password', isSystem: true, variables: ['username', 'code', 'resetUrl'], subject: '{{username}}', htmlBody: '{{#if code}}{{code}}{{/if}}{{#if resetUrl}}{{resetUrl}}{{/if}}' };
  const service = new MessagesService({ project: { findUnique: async () => ({ enabled: true }) } }, {}, { resolveChannel: async () => ({ id: 'mail', type: 'SMTP' }) }, { resolve: async () => template, render: () => 'rendered' }, {}, {}, {}, {}, { assertNotSuppressed: async () => {} });
  service.enqueueOrSend = async () => ({ success: true });
  service.quietHours = new (load('common/quiet-hours.service').QuietHoursService)();
  const base = { projectId: 'p1', source: 'OPEN_API', to: 'test@example.invalid', template: 'reset_password' };
  const variables = { username: 'Alice', unsubscribeUrl: 'https://example.invalid/unsubscribe' };
  await assert.rejects(service.sendEmail({ ...base, variables }), /code 或 resetUrl/);
  assert.equal((await service.sendEmail({ ...base, variables: { ...variables, code: '123456' } })).success, true);
  assert.equal((await service.sendEmail({ ...base, variables: { ...variables, resetUrl: 'https://example.invalid/reset' } })).success, true);
});

test('event creation translates only unique conflicts and preserves database outages', async () => {
  const { EventsService } = load('events/events.service');
  const outage = Object.assign(new Error('database unavailable'), { code: 'P1001' });
  const service = new EventsService({ eventDefinition: { create: async () => { throw outage; } } });
  await assert.rejects(service.create({ code: 'incident', name: 'Incident' }), error => error === outage);
  service.prisma.eventDefinition.create = async () => { throw { code: 'P2002' }; };
  await assert.rejects(service.create({ code: 'incident', name: 'Incident' }), /已存在/);
});
