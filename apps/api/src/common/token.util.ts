import { createHmac, timingSafeEqual } from 'crypto';

export type UnsubscribePayload = {
  email: string;
  projectId: string;
  exp: number; // unix sec
};

const WEAK_SECRETS = new Set([
  '',
  'msg-unsub',
  'msg-unsub-dev-only',
  'dev-secret-change-me',
  'change-me',
  'secret',
]);

/** 生产必须配置强密钥；弱密钥拒绝签发/验签 */
export function resolveUnsubscribeSecret(
  raw: string | undefined | null,
  opts?: { allowDevFallback?: boolean },
): string {
  const s = String(raw || '').trim();
  if (s && !WEAK_SECRETS.has(s) && s.length >= 16) return s;
  if (opts?.allowDevFallback && process.env.NODE_ENV !== 'production') {
    return 'msg-unsub-dev-only-not-for-prod';
  }
  throw new Error(
    '未配置安全的退订密钥：请设置 UNSUBSCRIBE_SECRET 或 JWT_SECRET（≥16 位，勿用默认值）',
  );
}

function b64url(buf: Buffer | string) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s: string) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

export function signUnsubscribeToken(
  payload: UnsubscribePayload,
  secret: string,
): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): UnsubscribePayload | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = b64url(createHmac('sha256', secret).update(body).digest());
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as UnsubscribePayload;
    if (!payload?.email || !payload?.projectId || !payload?.exp) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function maskEmail(email: string): string {
  const [u, d] = String(email).split('@');
  if (!d) return '***';
  const user = u.length <= 2 ? '*'.repeat(u.length) : `${u[0]}***${u[u.length - 1]}`;
  return `${user}@${d}`;
}

/** 从 handlebars 模板抽取 {{var}} 标识符（忽略 # / / else） */
export function extractTemplateVars(...sources: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([#/]?)([a-zA-Z_][\w]*)/g;
  for (const src of sources) {
    if (!src) continue;
    let m: RegExpExecArray | null;
    const s = String(src);
    while ((m = re.exec(s))) {
      if (m[1] === '/' || m[1] === '#') continue;
      const name = m[2];
      if (name === 'else' || name === 'this') continue;
      set.add(name);
    }
  }
  return [...set];
}

/** 可选变量：缺省不报错 */
export const OPTIONAL_TEMPLATE_VARS = new Set([
  'unsubscribeUrl',
  'ip',
  'time',
  'actionUrl',
  'verifyUrl',
  'resetUrl',
  'code',
  'host',
  'link',
  'location',
  'device',
  'remark',
  'note',
  'footer',
  'commit',
  'duration',
  'image',
  'icon',
  'subtitle',
  'group',
  'sound',
  'url',
  'level',
]);

export function missingTemplateVars(
  required: string[] | null | undefined,
  variables: Record<string, unknown> | null | undefined,
  opts?: { strictOptional?: boolean },
): string[] {
  if (!required?.length) return [];
  const vars = variables || {};
  return required.filter((k) => {
    if (!opts?.strictOptional && OPTIONAL_TEMPLATE_VARS.has(k)) return false;
    const v = vars[k];
    return v === undefined || v === null || v === '';
  });
}

export function normalizeErrorCluster(msg?: string | null): string {
  const s = String(msg || '').toLowerCase();
  if (!s) return 'unknown';
  if (/auth|login|password|credential|535|534|invalid.*(key|token)/i.test(s)) return 'auth';
  if (/timeout|etimedout|timed?\s*out/i.test(s)) return 'timeout';
  if (/\b429\b|rate.?limit|too many/i.test(s)) return 'rate_limit';
  if (/econnrefused|enotfound|eai_again|dns/i.test(s)) return 'network';
  if (/\b550\b|\b551\b|\b552\b|mailbox|bounce|undeliver/i.test(s)) return 'smtp_reject';
  if (/quota|daily.?limit|exceed/i.test(s)) return 'quota';
  if (/\b50[0-4]\b|unavailable|bad gateway/i.test(s)) return 'upstream_5xx';
  return 'unknown';
}

/** 客户端点击通知回执：HMAC(messageId)，无过期（消息本身可清理） */
export function signReadToken(messageId: string, secret: string): string {
  const body = b64url(messageId);
  const sig = b64url(createHmac('sha256', secret).update(`read:${messageId}`).digest());
  return `${body}.${sig}`;
}

export function verifyReadToken(
  messageId: string,
  token: string,
  secret: string,
): boolean {
  if (!messageId || !token || !secret) return false;
  const expect = signReadToken(messageId, secret);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expect);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
