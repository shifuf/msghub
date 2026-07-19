/** 运行环境与默认配置解析 */

export type AppEnv = 'development' | 'production';

export function resolveAppEnv(): AppEnv {
  const raw = String(
    process.env.APP_ENV || process.env.NODE_ENV || '',
  )
    .trim()
    .toLowerCase();
  if (raw === 'production' || raw === 'prod') return 'production';
  if (raw === 'development' || raw === 'dev') return 'development';
  // Docker 镜像默认 NODE_ENV=production
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

export function isProduction(): boolean {
  return resolveAppEnv() === 'production';
}

/** API 监听端口：显式 PORT 优先；否则 3010（避开常见 3000 占用） */
export function resolvePort(): number {
  const n = Number(process.env.PORT);
  if (Number.isFinite(n) && n > 0) return n;
  return 3010;
}

/**
 * 站点对外根地址（邮件退订链接等）。
 * 优先 SITE_URL；兼容旧 PUBLIC_BASE_URL / APP_URL。
 * 开发环境未配置时回落 http://localhost:5173；生产未配置则返回空串（生成相对路径）。
 */
export function resolveSiteUrl(): string {
  const raw =
    process.env.SITE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_URL ||
    '';
  const s = String(raw).trim().replace(/\/+$/, '');
  if (s) return s;
  if (!isProduction()) return 'http://localhost:5173';
  return '';
}

/** CORS：开发放行本机前端；生产反射请求 Origin（同源反代下最稳） */
export function resolveCorsOrigin():
  | boolean
  | string[]
  | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean | string) => void) => void) {
  const explicit = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;

  if (!isProduction()) {
    return [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:8185',
      'http://127.0.0.1:8185',
    ];
  }
  // 反射 Origin；无 Origin 的服务端调用放行
  return true;
}

export function resolveRedis() {
  return {
    host: process.env.REDIS_HOST || (isProduction() ? 'redis' : '127.0.0.1'),
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

export function resolveThrottle() {
  return {
    ttl: Number(process.env.THROTTLE_TTL || 60000),
    limit: Number(process.env.THROTTLE_LIMIT || (isProduction() ? 120 : 300)),
  };
}

export function resolveAsyncSend(): boolean {
  if (process.env.ASYNC_SEND === 'false') return false;
  if (process.env.ASYNC_SEND === 'true') return true;
  return true;
}

export function resolveSendMaxAttempts(): number {
  return Math.max(1, Number(process.env.SEND_MAX_ATTEMPTS || 3));
}

export function resolveAdminPath(): string {
  let p = String(process.env.ADMIN_PATH || '/admin').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  return p || '/admin';
}
