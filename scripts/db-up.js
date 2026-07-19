/**
 * 本机开发启动 postgres + redis。
 * - APP_ENV=production：不映射宿主机端口，与线上一致
 * - APP_ENV=development：临时映射 127.0.0.1:5432/6379，供本机 Nest 直连
 * 覆盖文件写在系统临时目录，不进仓库。
 */
const { writeFileSync, unlinkSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawnSync } = require('child_process');

const root = join(__dirname, '..');

function readAppEnv() {
  const fromProcess = String(process.env.APP_ENV || process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  if (fromProcess === 'production' || fromProcess === 'prod') return 'production';
  if (fromProcess === 'development' || fromProcess === 'dev') return 'development';

  for (const rel of ['.env', 'apps/api/.env']) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const m = text.match(/^\s*APP_ENV\s*=\s*([^\r\n#]+)/m);
    if (m) {
      const v = m[1].trim().toLowerCase();
      if (v === 'production' || v === 'prod') return 'production';
      if (v === 'development' || v === 'dev') return 'development';
    }
  }
  return 'development';
}

const appEnv = readAppEnv();
const isDev = appEnv === 'development';
const args = ['compose', '-f', 'docker-compose.yml'];

let override = null;
if (isDev) {
  override = join(tmpdir(), `msghub-dev-ports-${process.pid}.yml`);
  writeFileSync(
    override,
    `services:
  postgres:
    ports:
      - "127.0.0.1:5432:5432"
  redis:
    ports:
      - "127.0.0.1:6379:6379"
`,
    'utf8',
  );
  args.push('-f', override);
}

args.push('up', '-d', 'postgres', 'redis');

console.log(
  isDev
    ? '[db:up] APP_ENV=development → 临时映射 127.0.0.1:5432(postgres) / 6379(redis)'
    : '[db:up] APP_ENV=production → 不映射宿主机端口（容器内网）',
);

const result = spawnSync('docker', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: root,
});

if (override) {
  try {
    unlinkSync(override);
  } catch {
    /* ignore */
  }
}

if (isDev && (result.status === 0 || result.status === null)) {
  console.log(
    '[db:up] 本机连接示例:\n' +
      '  DATABASE_URL=postgresql://msg:msg123456@localhost:5432/msg_notify?schema=public\n' +
      '  REDIS_HOST=127.0.0.1  REDIS_PORT=6379',
  );
}

process.exit(result.status === null ? 1 : result.status);
