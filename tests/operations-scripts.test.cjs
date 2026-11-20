const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const localTools = path.join(root, 'data/backups/.ops-tools');
const ageTools = path.join(localTools, 'age');
const gitBin = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin' : '/usr/bin';
const toolsAvailable = fs.existsSync(path.join(localTools, 'jq.exe')) && fs.existsSync(path.join(ageTools, 'age.exe'));
const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function fixture(t) {
  const backupsRoot = path.join(root, 'data/backups');
  const dir = path.join(backupsRoot, `shell-test-${randomUUID()}`);
  assert.ok(dir.startsWith(backupsRoot + path.sep));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tmp'));
  fs.writeFileSync(path.join(dir, '.env'), 'JWT_SECRET=fixture-secret\nTOTP_ENCRYPTION_KEY=fixture-totp\n');
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const driver = path.join(dir, 'fake-tools.cjs');
  fs.writeFileSync(driver, `
const fs=require('node:fs'),path=require('node:path');const {spawnSync}=require('node:child_process');
const [tool,...args]=process.argv.slice(2),root=process.env.FAKE_TOOLS_ROOT;
fs.appendFileSync(path.join(root,'tools.jsonl'),JSON.stringify({tool,args})+'\\n');
function run(name,argv=[]){return handle(name,argv);}
function handle(name,a){
 if(name==='su-exec'){fs.appendFileSync(path.join(root,'tools.jsonl'),JSON.stringify({tool:a[1],args:a.slice(2)})+'\\n');return handle(a[1],a.slice(2));}
 if(name==='age-keygen'){if(a.includes('-o')){fs.writeFileSync(a[a.indexOf('-o')+1],'fixture-private-identity\\n');return 0;}process.stdout.write('age1fixturepublic\\n');return 0;}
 if(name==='age'){if(a.includes('-r')){const output=a[a.indexOf('-o')+1],input=a.at(-1);fs.writeFileSync(output,'fixture-age\\n'+fs.readFileSync(input).toString('base64'));return 0;}if(a.includes('-d')){const input=a.at(-1),encoded=fs.readFileSync(input,'utf8').replace(/^fixture-age\\n/,'');process.stdout.write(Buffer.from(encoded,'base64'));return 0;}}
 if(name==='pg_dump'){if(a.includes('--version'))return 0;if(process.env.FAKE_DUMP_FAIL){process.stderr.write('password fixture-secret');return 1;}process.stdout.write('fixture-postgres-custom-dump');return 0;}
 if(name==='pg_isready'){return process.env.FAKE_PG_DOWN?1:0;}
 if(name==='redis-cli'&&a.includes('-s')&&a.includes('ping')&&process.env.FAKE_REDIS_LOADING){const file=path.join(root,'redis-pings');const count=fs.existsSync(file)?Number(fs.readFileSync(file)):0;fs.writeFileSync(file,String(count+1));if(count<2){process.stdout.write('LOADING fixture RDB\\n');return 0;}}
 if(name==='redis-cli'){if(a.includes('--version'))return 0;if(a.includes('--rdb')){if(process.env.FAKE_REDIS_FAIL)return 1;fs.writeFileSync(a[a.indexOf('--rdb')+1],'REDIS0009fixture');return 0;}if(a.includes('-s')&&process.env.FAKE_REJECT_LIVE_AUTH&&process.env.REDISCLI_AUTH)return 1;if(a.includes('shutdown')){try{fs.unlinkSync(a[a.indexOf('-s')+1]);}catch{}return 0;}if(a.includes('ping')){process.stdout.write('PONG\\n');return process.env.FAKE_REDIS_DOWN?1:0;}if(a.includes('dbsize')){process.stdout.write('12\\n');return 0;}}
 if(name==='initdb'){const dir=a[a.indexOf('-D')+1];fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'initialized'),'ok');return 0;}
 if(name==='pg_ctl'){const dir=a[a.indexOf('-D')+1];if(a.includes('start')){fs.writeFileSync(path.join(dir,'postmaster.pid'),'fixture');return process.env.FAKE_PG_START_FAIL?1:0;}if(a.includes('stop')){if(process.env.FAKE_PG_STOP_FAIL)return 1;try{fs.unlinkSync(path.join(dir,'postmaster.pid'));}catch{}return 0;}if(a.includes('status'))return fs.existsSync(path.join(dir,'postmaster.pid'))?0:1;}
 if(name==='createdb')return 0;
 if(name==='pg_restore')return process.env.FAKE_REJECT_LIVE_AUTH && process.env.PGPASSWORD ? 1 : 0;
 if(name==='psql'){process.stdout.write(a.at(-1).includes('migration_name')?'20261120000000_operations\\n':'12\\n');return 0;}
 if(name==='redis-check-rdb'){if(process.env.FAKE_REDIS_VERIFY_FAIL)return 1;return fs.readFileSync(a[0]).toString().startsWith('REDIS0009')?0:1;}
 if(name==='redis-server'){const socket=a[a.indexOf('--unixsocket')+1];fs.writeFileSync(socket,'socket');if(a[a.indexOf('--daemonize')+1]==='no'){const timer=setInterval(()=>{if(!fs.existsSync(socket))clearInterval(timer);},25);}return 0;}
 if(name==='flock')return process.env.FAKE_LOCK_FAIL?1:0;
 if(name==='chown')return 0;
 if(name==='fake-lock')return 0;
 process.stderr.write('unexpected tool '+name);return 127;
}
process.exitCode=handle(tool,args);
`);
  const env = { ...process.env, PATH: [shellPath(path.join(dir, 'bin')), shellPath(localTools), shellPath(ageTools), gitBin, '/bin', '/mingw64/bin'].join(':'), PROJECT_ROOT: shellPath(dir), BACKUP_KEY_FILE: shellPath(path.join(dir, 'identity.txt')), FAKE_TOOLS_ROOT: shellPath(dir), FAKE_TOOL_DIR: shellPath(path.join(dir, 'bin')), FAKE_TOOL_DRIVER: shellPath(driver), NODE_BINARY: shellPath(process.execPath), PGHOST: 'postgres', PGPORT: '5432', PGUSER: 'msg', PGDATABASE: 'msg_notify', PGPASSWORD: 'fixture-db-password', REDIS_HOST: 'redis', REDIS_PORT: '6379', REDISCLI_AUTH: 'fixture-redis-password' };
  const wrapper = `#!/bin/sh\nexec "$NODE_BINARY" "$FAKE_TOOL_DRIVER" "$TOOL_NAME" "$@"\n`;
  const commands = ['age', 'age-keygen', 'pg_dump', 'pg_isready', 'redis-cli', 'su-exec', 'initdb', 'pg_ctl', 'createdb', 'pg_restore', 'psql', 'redis-check-rdb', 'redis-server', 'flock', 'chown'];
  for (const command of commands) fs.writeFileSync(path.join(dir, 'bin', command), wrapper.replace('"$TOOL_NAME"', JSON.stringify(command)), { mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'identity.txt'), 'fixture-private-identity\n');
  env.TMPDIR = shellPath(path.join(dir, 'tmp'));
  const run = (script, args = [], extra = {}) => spawnSync(bash, ['-c', 'export PATH="$FAKE_TOOL_DIR:$PATH"; exec "$@"', '--', shellPath(path.join(root, 'scripts', script)), ...args], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000 });
  const commandsRead = () => fs.existsSync(path.join(dir, 'tools.jsonl')) ? fs.readFileSync(path.join(dir, 'tools.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { dir, run, commands: commandsRead };
}

test('full backup encrypts database, Redis and deployment environment while exposing only a safe manifest', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const id = randomUUID();
  const result = ctx.run('backup-full.sh', [id]);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const archive = path.join(ctx.dir, 'data/backups/archives', id);
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json')));
  assert.equal(manifest.status, 'complete'); assert.equal(manifest.encrypted, true); assert.equal(manifest.consistency, 'online-non-atomic');
  assert.equal(result.stdout.includes('fixture-secret'), false);
  assert.equal(JSON.stringify(manifest).includes('fixture-secret'), false);
  const encrypted = fs.readFileSync(path.join(archive, 'backup.tar.age'));
  assert.equal(encrypted.includes(Buffer.from('fixture-secret')), false);
  assert.equal(encrypted.includes(Buffer.from('fixture-db-password')), false);
  const calls = ctx.commands();
  assert.ok(calls.some(c => c.tool === 'pg_dump' && c.args.includes('--dbname=msg_notify')));
  assert.ok(calls.some(c => c.tool === 'redis-cli' && c.args.includes('--rdb')));
  assert.ok(!calls.some(c => c.tool === 'docker'));
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, 'data/backups/.work')), []);
  assert.equal(fs.statSync(path.join(archive, 'backup.tar.age')).mode & 0o777, process.platform === 'win32' ? fs.statSync(path.join(archive, 'backup.tar.age')).mode & 0o777 : 0o600);
});

test('verification restores on private sockets without forwarding live database credentials and removes its actual temporary directories', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const id = randomUUID(); assert.equal(ctx.run('backup-full.sh', [id]).status, 0);
  const result = ctx.run('verify-full.sh', [id], { FAKE_REJECT_LIVE_AUTH: '1' }); assert.equal(result.status, 0, result.stderr || result.error?.message);
  const manifest = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'data/backups/archives', id, 'manifest.json')));
  assert.equal(manifest.verification, 'passed'); assert.equal(manifest.restoredTables, 12);
  const calls = ctx.commands();
  const pgCtl = calls.find(c => c.tool === 'pg_ctl' && c.args.includes('start')) || calls.find(c => c.tool === 'su-exec' && c.args[1] === 'pg_ctl' && c.args.includes('start'));
  assert.ok(pgCtl.args[pgCtl.args.indexOf('-o') + 1]?.includes("listen_addresses=''"));
  assert.ok(calls.some(c => c.tool === 'pg_restore' && c.args.includes('--exit-on-error')));
  assert.ok(calls.some(c => c.tool === 'redis-check-rdb'));
  assert.ok(calls.some(c => c.tool === 'redis-server' && c.args.includes('--port') && c.args.includes('0') && c.args.includes('--unixsocket')));
  assert.ok(!calls.some(c => c.tool === 'docker'));
  const restorePg = ctx.commands().find(c => c.tool === 'su-exec' && c.args[1] === 'pg_ctl' && c.args.includes('start'));
  assert.ok(restorePg);
  const temporaryName = path.posix.basename(path.posix.dirname(restorePg.args[restorePg.args.indexOf('-D') + 1]));
  assert.match(temporaryName, /^msghub-verify-[a-f0-9]{32}$/, 'the private socket path must fit Linux sockaddr_un');
  assert.equal(fs.existsSync(restorePg.args[restorePg.args.indexOf('-D') + 1]), false);
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, 'tmp')), []);
});

test('partially started PostgreSQL is stopped before failed verification removes temporary data', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const id = randomUUID(); assert.equal(ctx.run('backup-full.sh', [id]).status, 0);
  const result = ctx.run('verify-full.sh', [id], { FAKE_PG_START_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.ok(ctx.commands().some(c => c.tool === 'pg_ctl' && c.args.includes('stop')));
  const manifest = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'data/backups/archives', id, 'manifest.json')));
  assert.equal(manifest.errorCode, 'VERIFY_DATABASE_START_FAILED');
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, 'tmp')), []);
});

test('failed process cleanup cannot mark restore verification passed or delete its owned directory', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const id = randomUUID(); assert.equal(ctx.run('backup-full.sh', [id]).status, 0);
  const result = ctx.run('verify-full.sh', [id], { FAKE_PG_STOP_FAIL: '1' });
  assert.notEqual(result.status, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'data/backups/archives', id, 'manifest.json')));
  assert.equal(manifest.verification, 'failed');
  assert.equal(manifest.errorCode, 'VERIFY_CLEANUP_FAILED');
  assert.equal(fs.readdirSync(path.join(ctx.dir, 'tmp')).length, 1);
});

test('verification waits until the private Redis finishes loading its RDB', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const id = randomUUID(); assert.equal(ctx.run('backup-full.sh', [id]).status, 0);
  const result = ctx.run('verify-full.sh', [id], { FAKE_REDIS_LOADING: '1' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.ok(ctx.commands().filter(c => c.tool === 'redis-cli' && c.args.includes('-s') && c.args.includes('ping')).length >= 3);
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, 'tmp')), []);
});

test('failed database dump leaves an error manifest without leaking diagnostics or credentials', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const id = randomUUID();
  const result = ctx.run('backup-full.sh', [id], { FAKE_DUMP_FAIL: '1' });
  assert.notEqual(result.status, 0); assert.equal(result.stderr.includes('fixture-secret'), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'data/backups/archives', id, 'manifest.json')));
  assert.equal(manifest.status, 'failed'); assert.equal(manifest.errorCode, 'DATABASE_DUMP_FAILED');
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, 'data/backups/.work')), []);
});

test('path traversal and shell metacharacters fail before any database call', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t);
  for (const id of ['../../.env', 'x;touch injected', '$(touch injected)']) assert.notEqual(ctx.run('backup-full.sh', [id]).status, 0);
  assert.deepEqual(ctx.commands(), []); assert.equal(fs.existsSync(path.join(ctx.dir, 'injected')), false);
});

test('Redis restore failure removes temporary PostgreSQL data and records failed verification', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const id = randomUUID(); assert.equal(ctx.run('backup-full.sh', [id]).status, 0);
  const result = ctx.run('verify-full.sh', [id], { FAKE_REDIS_VERIFY_FAIL: '1' }); assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, 'data/backups/.work')), []);
  const manifest = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'data/backups/archives', id, 'manifest.json')));
  assert.equal(manifest.verification, 'failed');
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, 'tmp')), []);
});

test('runner remains idle and does not snapshot services or modify archives when backups are disabled', { skip: !toolsAvailable }, t => {
  const ctx = fixture(t); const result = ctx.run('backup-runner.sh', ['--once']);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(ctx.commands().some(c => c.tool === 'pg_dump' || c.tool === 'redis-cli' && c.args.includes('--rdb')), false);
  const status = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'data/backups/control/runner-status.json')));
  assert.equal(status.status, 'ready'); assert.equal(status.keyConfigured, true);
});
