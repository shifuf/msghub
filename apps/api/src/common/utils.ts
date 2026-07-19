import { createHash, randomBytes } from 'crypto';

export function ok<T>(data: T) {
  return { success: true as const, data, error: null };
}

export function fail(code: string, message: string, status = 400) {
  return { success: false as const, data: null, error: { code, message }, _status: status };
}

export function maskSecret(value: string | null | undefined, keep = 4): string {
  if (!value) return '';
  if (value.length <= keep * 2) return '****';
  return `${value.slice(0, keep)}****${value.slice(-keep)}`;
}

export function maskChannelConfig(
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sensitiveKeys = [
    'sendKey',
    'token',
    'secret',
    'botToken',
    'pass',
    'webhook',
    'webhookUrl',
    'url',
    'deviceKey',
    'appToken',
    'hmacSecret',
    'masterSecret',
    'appKey',
  ];
  const out: Record<string, unknown> = { ...config };
  for (const k of sensitiveKeys) {
    if (typeof out[k] === 'string') {
      out[k] = maskSecret(out[k] as string);
    }
  }
  if (type === 'WEBHOOK' && out.headers && typeof out.headers === 'object') {
    out.headers = { ...(out.headers as object), Authorization: '****' };
  }
  return out;
}

export function generateApiKey(): string {
  return `msg_${randomBytes(24).toString('base64url')}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function apiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12);
}


/** 去掉 HTML / 压缩空白，避免 503 页面整段进日志 */
export function sanitizeErrorMessage(raw?: string | null, max = 300): string | null {
  if (raw == null) return null;
  let s = String(raw);
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '请求失败';
  const m = s.match(/\b(50[0-4]|40[0-4]|401|403)\b(?:\s+([A-Za-z][A-Za-z ]{2,40}))?/i);
  if (m) {
    const code = m[1];
    const phrase = (m[2] || '').trim();
    if (phrase) return `${code} ${phrase}`.slice(0, max);
    if (/unavailable/i.test(s)) return `${code} Service Temporarily Unavailable`;
    return `${code} Error`;
  }
  if (s.length > max) return s.slice(0, max - 1) + '…';
  return s;
}

/** 宽松邮箱格式：本地部@域名，至少一级点分域名 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email?: string | null): boolean {
  if (!email) return false;
  const v = String(email).trim();
  if (v.length < 5 || v.length > 254) return false;
  return EMAIL_RE.test(v);
}
