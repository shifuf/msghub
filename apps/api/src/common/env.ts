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
 * 开发环境未配置时回落 http://localhost:5173；生产未配置则返回空串，外发邮件链接由调用方拒绝。
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

/** CORS：开发放行本机前端；生产同源或显式白名单。 */
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
  // Same-origin requests need no CORS headers. Explicitly opt in to other origins.
  return false;
}

export function validateSecurityEnvironment(env: Record<string, unknown>) {
  const production = ['production', 'prod'].includes(String(env.APP_ENV || env.NODE_ENV || '').toLowerCase());
  if (!production) return env;
  const secret = String(env.JWT_SECRET || '');
  if (secret.length < 32 || new Set(secret).size < 12 || /change.me|dev.secret|example|placeholder/i.test(secret)) {
    throw new Error('生产环境 JWT_SECRET 必须为至少 32 字符的非默认随机密钥');
  }
  const password = String(env.ADMIN_PASSWORD || '');
  if (password && (password.length < 12 || /^(ChangeMe@123456|admin|password|123456)$/i.test(password))) {
    throw new Error('生产环境 ADMIN_PASSWORD 必须为至少 12 字符的非默认密码');
  }
  return env;
}

export function resolveJwtSecret(config: { get<T = string>(key: string): T | undefined }): string {
  const secret = config.get<string>('JWT_SECRET');
  validateSecurityEnvironment({ APP_ENV: config.get('APP_ENV') || config.get('NODE_ENV'), JWT_SECRET: secret });
  return secret || 'dev-secret-change-me';
}

export function resolveJwtLifetime(value: unknown = '7d'): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(String(value));
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = match ? Number(match[1]) * multipliers[(match[2] || 's').toLowerCase()] : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 30 * 86400) throw new Error('JWT_EXPIRES_IN 必须为 1 秒至 30 天的有效时长（例如 7d）');
  return seconds;
}

export function resolveTrustProxy(): false | string[] {
  const raw = String(process.env.TRUST_PROXY || '').trim();
  if (!raw) return false;
  if (/^(true|\d+)$/i.test(raw)) throw new Error('TRUST_PROXY 必须列出实际可信代理 IP/CIDR，不能使用 true 或跳数');
  return raw.split(',').map(value => value.trim()).filter(Boolean);
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
