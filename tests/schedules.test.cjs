const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
api('reflect-metadata');
const { SchedulesService } = require('../apps/api/src/schedules/schedules.service.ts');
const { DeliveryUncertainError } = require('../apps/api/src/common/delivery.util.ts');

function fixture(overrides = {}, send = async () => ({ success: true, messageId: 'm1' })) {
  const row = { id: 's1', projectId: 'p1', status: 'PENDING', cron: 'daily', timezone: 'Asia/Shanghai', runAt: new Date(Date.now() - 3 * 86400000), kind: 'push', variables: {}, attempt: 0, ...overrides };
  const executions = [];
  const matches = (value, where) => Object.entries(where).every(([key, wanted]) => {
    if (key === 'OR') return wanted.some(clause => matches(value, clause));
    if (wanted && typeof wanted === 'object' && !(wanted instanceof Date)) {
      if ('in' in wanted) return wanted.in.includes(value[key]);
      if ('lte' in wanted) return value[key] <= wanted.lte;
      if ('lt' in wanted) return value[key] != null && value[key] < wanted.lt;
      if (key === 'schedule') return matches(row, wanted);
    }
    return value[key] === wanted;
  });
  const assign = (target, data) => { for (const [key, value] of Object.entries(data)) if (value !== undefined) target[key] = value?.increment ? (target[key] || 0) + value.increment : value; };
  const db = {
    project: { findUnique: async () => ({ id: 'p1', name: 'test', enabled: true }) },
    scheduledMessage: {
      findUnique: async ({ where }) => where.id === row.id ? structuredClone(row) : null,
      findMany: async ({ where } = {}) => !where || matches(row, where) ? [structuredClone(row)] : [],
      updateMany: async ({ where, data }) => { if (!matches(row, where)) return { count: 0 }; assign(row, data); return { count: 1 }; },
      create: async ({ data }) => { assign(row, data); return structuredClone(row); },
    },
    scheduleExecution: {
      create: async ({ data }) => { executions.push(structuredClone(data)); return structuredClone(data); },
      updateMany: async ({ where, data }) => { let count = 0; for (const execution of executions) if (matches(execution, where)) { assign(execution, data); count++; } return { count }; },
      findMany: async ({ where }) => structuredClone(executions.filter(execution => matches(execution, where)).reverse()),
      count: async ({ where }) => executions.filter(execution => matches(execution, where)).length,
    },
    $transaction: async (fn) => fn(db),
  };
  return { row, executions, service: new SchedulesService(db, { sendPush: send }), db };
}

test('daily definite rejection preserves failed execution and schedules the next occurrence', async () => {
  const ctx = fixture({}, async () => ({ success: false, status: 'FAILED', messageId: 'rejected1', errorMessage: 'provider rejected' }));
  await ctx.service.executeOne('s1');
  assert.equal(ctx.row.status, 'PENDING');
  assert.ok(ctx.row.runAt.getTime() > Date.now());
  assert.equal(ctx.executions.length, 1);
  assert.equal(ctx.executions[0].status, 'FAILED');
  assert.equal(ctx.executions[0].messageId, 'rejected1');
  assert.equal(ctx.executions[0].error, 'provider rejected');
  assert.ok(ctx.executions[0].finishedAt instanceof Date);
  assert.equal(ctx.row.executionKey, null);
  assert.equal(ctx.row.leaseUntil, null);
});

test('daily definite exception continues its recurrence and records failure', async () => {
  const ctx = fixture({}, async () => { throw new Error('invalid recipient'); });
  await ctx.service.executeOne('s1');
  assert.equal(ctx.row.status, 'PENDING');
  assert.equal(ctx.executions[0].status, 'FAILED');
  assert.equal(ctx.executions[0].error, 'invalid recipient');
});

test('unknown delivery is not rescheduled and its history remains uncertain on a later tick', async () => {
  let sends = 0;
  const ctx = fixture({}, async () => { sends++; throw new DeliveryUncertainError('maybe1'); });
  const dueAt = ctx.row.runAt.getTime();
  await ctx.service.executeOne('s1');
  await ctx.service.tick();
  assert.equal(sends, 1);
  assert.equal(ctx.row.status, 'UNCERTAIN');
  assert.equal(ctx.row.runAt.getTime(), dueAt);
  assert.equal(ctx.executions[0].status, 'UNCERTAIN');
  assert.equal(ctx.executions[0].messageId, 'maybe1');
});

test('explicit uncertain result is not treated as successful daily delivery', async () => {
  const ctx = fixture({}, async () => ({ success: false, status: 'UNCERTAIN', messageId: 'maybe2' }));
  await ctx.service.executeOne('s1');
  assert.equal(ctx.row.status, 'UNCERTAIN');
  assert.equal(ctx.executions[0].status, 'UNCERTAIN');
});

test('one-off definite failure remains terminal with execution history', async () => {
  const ctx = fixture({ cron: null }, async () => ({ success: false, errorMessage: 'rejected' }));
  await ctx.service.executeOne('s1');
  assert.equal(ctx.row.status, 'FAILED');
  assert.equal(ctx.executions[0].status, 'FAILED');
});

test('two claimants cannot send the same scheduled occurrence twice', async () => {
  let sends = 0;
  const ctx = fixture({}, async () => { sends++; return { success: true }; });
  await Promise.all([ctx.service.executeOne('s1'), ctx.service.executeOne('s1')]);
  assert.equal(sends, 1);
  assert.equal(ctx.executions.length, 1);
});

test('history pagination is tied to the requested schedule', async () => {
  const ctx = fixture();
  await ctx.service.executeOne('s1');
  const result = await ctx.service.history('s1', { page: 1, pageSize: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].scheduleId, 's1');
  await assert.rejects(ctx.service.history('missing', {}), /不存在/);
});

test('expired lease marks its execution uncertain without sending again', async () => {
  let sends = 0;
  const ctx = fixture({ status: 'RUNNING', executionKey: 'expired1', leaseUntil: new Date(0) }, async () => { sends++; return { success: true }; });
  ctx.executions.push({ id: 'expired1', scheduleId: 's1', status: 'RUNNING', startedAt: new Date(0) });
  await ctx.service.tick();
  assert.equal(sends, 0);
  assert.equal(ctx.row.status, 'UNCERTAIN');
  assert.equal(ctx.executions[0].status, 'UNCERTAIN');
});

test('confirming an uncertain daily execution schedules the next period without erasing uncertainty history', async () => {
  const ctx = fixture({}, async () => { throw new DeliveryUncertainError('maybe3'); });
  await ctx.service.executeOne('s1');
  await ctx.service.resolve('s1', { action: 'delivered' });
  assert.equal(ctx.row.status, 'PENDING');
  assert.ok(ctx.row.runAt.getTime() > Date.now());
  assert.equal(ctx.executions[0].status, 'UNCERTAIN');
});

test('create rejects an unsupported timezone and stores weekly recurrence in the selected timezone', async () => {
  const ctx = fixture();
  await assert.rejects(ctx.service.create({ projectId: 'p1', cron: 'weekly', timezone: 'bad/zone', runAt: '2035-01-01T00:00:00Z' }), /时区/);
  await ctx.service.create({ projectId: 'p1', cron: 'weekly', timezone: 'America/New_York', runAt: '2035-01-01T00:00:00Z' });
  assert.equal(ctx.row.cron, 'weekly');
  assert.equal(ctx.row.timezone, 'America/New_York');
});

test('recurrence uses local calendar dates across DST, weekends, year boundary and overdue occurrences', () => {
  const { nextScheduleRun } = require('../apps/api/src/schedules/recurrence.ts');
  const cases = [
    ['daily', 'Asia/Shanghai', '2026-12-31T01:00:00Z', '2026-12-31T01:00:00Z', '2027-01-01T01:00:00.000Z'],
    ['weekdays', 'Asia/Shanghai', '2026-11-20T01:00:00Z', '2026-11-20T01:00:00Z', '2026-11-23T01:00:00.000Z'],
    ['weekly', 'Asia/Shanghai', '2026-11-20T01:00:00Z', '2026-12-01T01:00:00Z', '2026-12-04T01:00:00.000Z'],
    ['daily', 'America/New_York', '2026-03-07T14:00:00Z', '2026-03-07T14:00:00Z', '2026-03-08T13:00:00.000Z'],
    ['daily', 'America/New_York', '2026-10-31T13:00:00Z', '2026-10-31T13:00:00Z', '2026-11-01T14:00:00.000Z'],
    ['daily', 'America/New_York', '2026-03-07T07:30:00Z', '2026-03-07T07:30:00Z', '2026-03-09T06:30:00.000Z'],
    ['daily', 'America/New_York', '2026-10-31T05:30:00Z', '2026-10-31T05:30:00Z', '2026-11-01T05:30:00.000Z'],
  ];
  for (const [cron, timezone, runAt, now, expected] of cases) assert.equal(nextScheduleRun(new Date(runAt), cron, timezone, new Date(now)).toISOString(), expected);
});
