import { createHmac, timingSafeEqual } from 'crypto';
import Handlebars from 'handlebars';

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
  if (opts?.allowDevFallback && process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'production') {
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
  return extractTemplatePaths(sources, false);
}

/** Conditional sections are optional; declarations are editor suggestions. */
export function extractRequiredTemplateVars(...sources: (string | null | undefined)[]): string[] {
  return extractTemplatePaths(sources, true);
}

function extractTemplatePaths(sources: (string | null | undefined)[], requiredOnly: boolean): string[] {
  const set = new Set<string>();
  const addPath = (node: any, context: boolean) => {
    if (node?.type !== 'PathExpression' || node.data || node.depth || context) return;
    const path = String(node.original || '');
    if (path && path !== 'this' && !path.startsWith('this.')) set.add(path);
  };
  const visit = (node: any, context = false) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MustacheStatement' || node.type === 'SubExpression' || node.type === 'BlockStatement') {
      if (requiredOnly && node.type === 'BlockStatement' && ['if', 'unless'].includes(node.path?.original)) return;
      const helper = node.type === 'BlockStatement' || (node.params?.length ?? 0) > 0 || (node.hash?.pairs?.length ?? 0) > 0;
      if (!helper) addPath(node.path, context);
      for (const param of node.params || []) {
        addPath(param, context);
        if (param.type === 'SubExpression') visit(param, context);
      }
      for (const pair of node.hash?.pairs || []) { addPath(pair.value, context); visit(pair.value, context); }
      const scoped = context || ['each', 'with'].includes(node.path?.original);
      if (node.program) visit(node.program, scoped);
      if (node.inverse) visit(node.inverse, context);
      return;
    }
    for (const item of node.body || []) visit(item, context);
  };
  for (const src of sources) {
    if (!src) continue;
    visit(Handlebars.parse(String(src)));
  }
  return [...set];
}

export function missingTemplateVars(
  required: string[] | null | undefined,
  variables: Record<string, unknown> | null | undefined,
): string[] {
  if (!required?.length) return [];
  const vars = variables || {};
  return required.filter((k) => {
    const v = k.split('.').reduce<unknown>((value, part) =>
      value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, part)
        ? (value as Record<string, unknown>)[part] : undefined, vars);
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
