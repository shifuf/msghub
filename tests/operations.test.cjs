const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
api('reflect-metadata');

async function fixture(t) {
  const projectRoot = path.resolve(__dirname, '../data/backups', `ops-test-${randomUUID()}`);
  assert.ok(projectRoot.startsWith(path.resolve(__dirname, '../data/backups') + path.sep));
  t.after(async () => { await fs.rm(projectRoot, { recursive: true, force: true }); });
  await fs.mkdir(path.join(projectRoot, 'data/backups/control/jobs'), { recursive: true });
  const before = process.env.OPERATIONS_PROJECT_ROOT;
  process.env.OPERATIONS_PROJECT_ROOT = projectRoot;
  let service;
  try {
    const { OperationsService } = require('../apps/api/src/operations/operations.service.ts');
    service = new OperationsService({ $queryRaw: async () => [{ migration_name: '20261120000000_operations' }] });
  } finally { if (before === undefined) delete process.env.OPERATIONS_PROJECT_ROOT; else process.env.OPERATIONS_PROJECT_ROOT = before; }
  const control = path.join(projectRoot, 'data/backups/control');
  const json = (name, data) => fs.writeFile(path.join(control, name), JSON.stringify(data));
  const ready = () => json('runner-status.json', { status: 'ready', lastSeenAt: new Date().toISOString(), keyConfigured: true, secret: 'identity-secret' });
  return { service, control, json, ready, projectRoot };
}

test('full backups are disabled initially and cannot be started without explicit enablement', async t => {
  const ctx = await fixture(t);
  const status = await ctx.service.backupStatus();
  assert.equal(status.config.enabled, false);
  await assert.rejects(ctx.service.runBackup(), /未启用/);
  assert.deepEqual(await fs.readdir(path.join(ctx.control, 'jobs')), []);
});

test('enablement requires a fresh runner and encryption key; secret fields stay outside API responses', async t => {
  const ctx = await fixture(t);
  await assert.rejects(ctx.service.updateBackupConfig({ enabled: true }), /runner|运行器|密钥/);
  await ctx.ready();
  await ctx.service.updateBackupConfig({ enabled: true, intervalHours: 24, retentionCount: 14, verifyAfterBackup: true });
  const status = await ctx.service.backupStatus();
  assert.equal(status.config.enabled, true);
  assert.equal(status.runner.keyConfigured, true);
  assert.equal(JSON.stringify(status).includes('identity-secret'), false);
});

test('manual backup creates only a fixed-shape job request and rejects concurrent requests', async t => {
  const ctx = await fixture(t);
  await ctx.ready(); await ctx.service.updateBackupConfig({ enabled: true });
  const job = await ctx.service.runBackup();
  assert.equal(job.action, 'backup');
  assert.equal(job.status, 'pending');
  const requests = await fs.readdir(path.join(ctx.control, 'requests'));
  assert.deepEqual(requests, [`${job.id}.request`]);
  const body = JSON.parse(await fs.readFile(path.join(ctx.control, 'requests', requests[0]), 'utf8'));
  assert.deepEqual(body, { version: 1, id: job.id, action: 'backup' });
  await assert.rejects(ctx.service.runBackup(), /进行|执行|等待/);
});

test('verification rejects path traversal and targets only existing complete backup manifests', async t => {
  const ctx = await fixture(t);
  await ctx.ready(); await ctx.service.updateBackupConfig({ enabled: true });
  await assert.rejects(ctx.service.verifyBackup('../.env'), /ID|标识|无效/);
  const id = randomUUID();
  await assert.rejects(ctx.service.verifyBackup(id), /不存在|备份/);
  const directory = path.join(ctx.projectRoot, 'data/backups/archives', id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ id, status: 'complete', encrypted: true, createdAt: new Date().toISOString(), secret: 'database-password' }));
  const job = await ctx.service.verifyBackup(id);
  assert.equal(job.action, 'verify');
  assert.equal(job.backupId, id);
  const status = await ctx.service.backupStatus();
  assert.equal(JSON.stringify(status).includes('database-password'), false);
});

test('unsafe configuration fields and stale runner cannot start a job', async t => {
  const ctx = await fixture(t);
  await assert.rejects(ctx.service.updateBackupConfig({ enabled: false, command: 'rm -rf /' }), /字段|配置/);
  await assert.rejects(ctx.service.updateBackupConfig({ intervalHours: 0 }), /间隔|小时/);
  await ctx.ready(); await ctx.service.updateBackupConfig({ enabled: true });
  await ctx.json('runner-status.json', { status: 'ready', lastSeenAt: '2000-01-01T00:00:00Z', keyConfigured: true });
  await assert.rejects(ctx.service.runBackup(), /runner|运行器/);
});

test('version data reads container metadata and migration version while ignoring arbitrary deployment fields', async t => {
  const ctx = await fixture(t);
  const saved = { APP_COMMIT: process.env.APP_COMMIT, BUILD_TIME: process.env.BUILD_TIME };
  process.env.APP_COMMIT = '1234567890abcdef'; process.env.BUILD_TIME = '2026-11-20T00:00:00Z';
  t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  await ctx.json('deployments.json', [{ id: 'deploy1', commit: '1234567890abcdef', status: 'success', startedAt: '2026-11-20T00:00:00Z', finishedAt: '2026-11-20T00:01:00Z', env: 'jwt-secret' }]);
  const data = await ctx.service.version();
  assert.equal(data.appCommit, '1234567890abcdef');
  assert.equal(data.migrationVersion, '20261120000000_operations');
  assert.equal(data.deployments[0].status, 'success');
  assert.equal(JSON.stringify(data).includes('jwt-secret'), false);
});

test('symlinked control directory is refused before a job can escape project backups', async t => {
  const ctx = await fixture(t);
  const outside = path.join(ctx.projectRoot, 'outside'); await fs.mkdir(outside);
  assert.ok(ctx.control.startsWith(ctx.projectRoot + path.sep));
  await fs.rm(ctx.control, { recursive: true }); await fs.symlink(outside, ctx.control, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(ctx.service.updateBackupConfig({ enabled: false }), /链接|目录/);
  assert.deepEqual(await fs.readdir(outside), []);
});
