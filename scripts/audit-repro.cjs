/**
 * Isolated audit reproductions. No database connection or real notifications.
 * Run after generating Prisma Client and building API: node scripts/audit-repro.cjs
 * Historical baseline evidence only. Fixed behavior is covered by pnpm test.
 */
if (process.env.RUN_HISTORICAL_AUDIT !== '1') {
  console.log('Historical audit disabled after hardening. Run pnpm test for regression checks.');
  process.exit(0);
}
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
apiRequire('reflect-metadata');
const load = (name) => require(path.join(root, 'apps/api/dist/src', name));
const results = [];
async function check(name, run) {
  try {
    const evidence = await run();
    results.push({ name, reproduced: true, evidence });
  } catch (error) {
    results.push({ name, reproduced: false, error: error.message });
    process.exitCode = 1;
  }
}

(async () => {
  await check('IPv4-mapped IPv6 bypasses outbound private-address check', async () => {
    const { assertSafeOutboundUrl, isPrivateIp } = load('adapters/http.util.js');
    const url = 'https://[::ffff:127.0.0.1]/';
    const normalized = new URL(url).hostname;
    assert.equal(isPrivateIp(normalized), false);
    await assertSafeOutboundUrl(url); // Validation only, never makes HTTP request.
    return { normalized, acceptedDespiteLoopback: true };
  });

  await check('JWT strategy accepts a signed token without an admin identity', async () => {
    const { JwtStrategy } = load('auth/jwt.strategy.js');
    const strategy = new JwtStrategy({ get: () => 'isolated-audit-secret-123456' });
    const result = strategy.validate({});
    assert.equal(result.id, undefined);
    assert.ok(result);
    return { acceptsIdentityObjectWithoutSub: true };
  });

  await check('Structured API errors lose their code and message in the global filter', async () => {
    const { AllExceptionsFilter } = load('common/http-exception.filter.js');
    const { HttpException } = apiRequire('@nestjs/common');
    let response;
    const res = { status: () => res, json: (value) => { response = value; } };
    new AllExceptionsFilter().catch(new HttpException({ success: false, data: { messageId: 'm1' }, error: { code: 'RATE_LIMITED', message: 'project rate limit' } }, 429), { switchToHttp: () => ({ getResponse: () => res }) });
    assert.equal(typeof response.error.code, 'object');
    assert.equal(response.error.message, '服务器内部错误');
    assert.equal(response.data, null);
    return response;
  });

  await check('CSV export leaves formula cells executable', async () => {
    const { MessagesService } = load('messages/messages.service.js');
    const receiver = { buildListWhere: () => ({}), prisma: { messageLog: { findMany: async () => [{ id: 'm1', createdAt: new Date(), source: 'OPEN_API', status: 'SUCCESS', title: '=1+1', attempts: 1 }] } } };
    const csv = await MessagesService.prototype.exportCsv.call(receiver, {});
    assert.ok(csv.includes(',=1+1,'));
    return { exportedUnescapedFormula: '=1+1' };
  });

  await check('Invalid cleanup date removes the date restriction completely', async () => {
    const { MessagesService } = load('messages/messages.service.js');
    let deletionFilter;
    const receiver = { prisma: { messageLog: { deleteMany: async ({ where }) => { deletionFilter = where; return { count: 0 }; } } } };
    await MessagesService.prototype.cleanup.call(receiver, { before: 'not-a-date' });
    assert.deepEqual(deletionFilter, {});
    return { deletionFilter, wouldTargetAllMessages: true };
  });

  await check('Invalid configured timezone throws during message dispatch', async () => {
    const { QuietHoursService } = load('common/quiet-hours.service.js');
    assert.throws(() => new QuietHoursService().shouldHold({ quietHoursEnabled: true, quietStart: '22:00', quietEnd: '08:00', quietTimezone: 'not-a-timezone' }, 'normal'), RangeError);
    return { invalidTimezoneCausesRangeError: true };
  });

  await check('Schedule cancellation can race with an already claimed send', async () => {
    const { SchedulesService } = load('schedules/schedules.service.js');
    const row = { id: 's1', status: 'PENDING', projectId: 'p1', kind: 'push', title: 'audit', runAt: new Date(), variables: {} };
    let releaseRead;
    let signalRead;
    const readStarted = new Promise((resolve) => { signalRead = resolve; });
    const resumeRead = new Promise((resolve) => { releaseRead = resolve; });
    const prisma = { scheduledMessage: {
      findUnique: async () => {
        const snapshot = { ...row };
        if (snapshot.status === 'PENDING') { signalRead(); await resumeRead; }
        return snapshot;
      },
      updateMany: async ({ where, data }) => {
        if (row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ data }) => Object.assign(row, data),
    } };
    let sends = 0;
    const service = new SchedulesService(prisma, { sendPush: async () => { sends++; return { success: true }; } });
    const cancelling = service.cancel('s1');
    await readStarted;
    await service.executeOne('s1');
    releaseRead();
    await cancelling;
    assert.equal(sends, 1);
    assert.equal(row.status, 'CANCELLED');
    return { sends, displayedStatus: row.status };
  });

  await check('Overdue daily schedule keeps requeuing dates in the past', async () => {
    const { SchedulesService } = load('schedules/schedules.service.js');
    const row = { id: 's2', status: 'PENDING', projectId: 'p1', kind: 'push', title: 'audit', cron: 'daily', runAt: new Date(Date.now() - 4 * 86400000), variables: {} };
    const prisma = { scheduledMessage: {
      updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; },
      findUnique: async () => ({ ...row }),
      update: async ({ data }) => Object.assign(row, data),
    } };
    const service = new SchedulesService(prisma, { sendPush: async () => ({ success: true }) });
    await service.executeOne('s2');
    assert.equal(row.status, 'PENDING');
    assert.ok(row.runAt.getTime() < Date.now() - 2 * 86400000);
    return { nextRunStillOverTwoDaysLate: true };
  });

  await check('RUNNING schedules are not picked up after process restart', async () => {
    const { SchedulesService } = load('schedules/schedules.service.js');
    let queriedStatus;
    const service = new SchedulesService({ scheduledMessage: { findMany: async ({ where }) => { queriedStatus = where.status; return []; } } }, {});
    await service.tick();
    assert.equal(queriedStatus, 'PENDING');
    return { tickerOnlySelects: queriedStatus };
  });

  await check('Parallel email requests can exceed daily quota', async () => {
    const { EmailPolicyService } = load('email-policy/email-policy.service.js');
    let used = 0;
    const policy = new EmailPolicyService({ project: { findUnique: async () => ({ dailyEmailQuota: 1 }) }, messageLog: { count: async () => used } });
    await Promise.all([1, 2, 3].map(async () => { await policy.assertWithinDailyQuota('p1'); used++; }));
    assert.equal(used, 3);
    return { configuredQuota: 1, admittedConcurrentRequests: used };
  });

  await check('A throwing first adapter prevents project fallback', async () => {
    const { MessagesService } = load('messages/messages.service.js');
    let secondTried = false;
    let emailTried = false;
    let inboxTried = false;
    const service = new MessagesService(
      { project: { findUnique: async () => ({ id: 'p1' }) } }, {},
      { listDispatchChannels: async () => [{ id: 'first', type: 'WEBHOOK' }, { id: 'second', type: 'BARK' }] },
      {}, {}, {}, {}, { resolveAdminEmail: async () => { emailTried = true; return 'audit@example.invalid'; } }, {},
      { shouldHold: () => false }, {},
    );
    service.enqueueOrSend = async ({ channelId }) => {
      if (channelId === 'first') throw new Error('adapter config invalid');
      secondTried = true;
      return { success: true };
    };
    service.receiveInbox = async () => { inboxTried = true; return { success: true }; };
    await assert.rejects(service.dispatchByProject({ projectId: 'p1', title: 'audit', source: 'OPEN_API' }), /adapter config invalid/);
    assert.equal(secondTried || emailTried || inboxTried, false);
    return { secondTried, emailTried, inboxTried };
  });

  await check('Backup export drops fallback settings and selected schedule channel', async () => {
    const { BackupService } = load('backup/backup.service.js');
    const rows = {
      channel: [], project: [{ id: 'p1', name: 'audit', bindings: [], unreadEmailFallbackEnabled: true, unreadEmailFallbackHours: 60, unreadEmailTemplateCode: 'notice' }],
      emailTemplate: [], pushTemplate: [], systemSetting: [], emailSuppress: [], eventDefinition: [],
      scheduledMessage: [{ projectId: 'p1', channelId: 'c1', channelType: 'BARK', kind: 'push' }],
    };
    const prisma = Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, { findMany: async () => value }]));
    const exported = await new BackupService(prisma, {}).exportConfig();
    const missing = ['unreadEmailFallbackEnabled', 'unreadEmailFallbackHours', 'unreadEmailTemplateCode'].filter((key) => !(key in exported.projects[0]));
    assert.equal(missing.length, 3);
    assert.equal('channelId' in exported.schedules[0], false);
    assert.equal('channelType' in exported.schedules[0], false);
    return { missingProjectFields: missing, scheduleChannelLost: true };
  });

  await check('Notification read state ignores server readAt', async () => {
    const ts = apiRequire('typescript');
    const source = fs.readFileSync(path.join(root, 'apps/web/src/stores/notify.ts'), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
    const storage = new Map();
    const exports = {};
    const sandbox = { exports, console, setTimeout, clearTimeout, setInterval, clearInterval,
      localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
      require: (id) => {
        if (id === 'pinia') return { defineStore: (_id, setup) => setup };
        if (id === 'vue') return { ref: (value) => ({ value }), computed: (fn) => ({ get value() { return fn(); } }) };
        if (id === '@/api') return { dashboardApi: { notifications: async () => ({ items: [{ id: 'm1', status: 'SUCCESS', createdAt: new Date().toISOString(), readAt: new Date().toISOString() }] }) } };
        if (id === './auth') return { useAuthStore: () => ({ token: '' }) };
        throw new Error(`Unexpected dependency: ${id}`);
      },
    };
    vm.runInNewContext(output, sandbox);
    const store = exports.useNotifyStore();
    await store.bootstrap();
    assert.equal(store.unreadCount.value, 1);
    store.markRead('m1');
    assert.equal(store.unreadCount.value, 0);
    return { serverAlreadyReadButBadgeUnread: true, markReadOnlyUsesLocalStorage: storage.has('msg_notify_read_ids') };
  });

  console.log(JSON.stringify({ total: results.length, reproduced: results.filter((r) => r.reproduced).length, results }, null, 2));
})();
