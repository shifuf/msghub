import { lookup } from 'dns/promises';
import { isIP } from 'net';

const DEFAULT_TIMEOUT = 15000;

export function isPrivateHostname(hostname: string): boolean {
  const h = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  return isPrivateIp(h);
}

export function isPrivateIp(ip: string): boolean {
  const h = String(ip || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === '::1' || h === '::' || h === '0.0.0.0') return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p.some((n) => !Number.isFinite(n) || n > 255)) return true;
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
  }

  if (h.includes(':')) {
    const bare = h.split('%')[0];
    if (bare === '::1') return true;
    if (bare.startsWith('fc') || bare.startsWith('fd')) return true;
    if (bare.startsWith('fe80')) return true;
    if (bare.startsWith('ff')) return true;
    if (bare.startsWith('::ffff:')) {
      return isPrivateIp(bare.slice('::ffff:'.length));
    }
  }
  return false;
}

/**
 * 出站 URL 安全校验：协议 + 主机名黑名单 + DNS 解析后 IP。
 * allowPrivate：自建 Bark/Gotify 等局域网场景。
 */
export async function assertSafeOutboundUrl(
  url: string,
  opts?: { allowHttp?: boolean; allowPrivate?: boolean },
) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL 无效');
  }
  const allowHttp = !!opts?.allowHttp;
  const allowPrivate = !!opts?.allowPrivate;
  if (allowHttp) {
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('仅支持 HTTP/HTTPS');
    }
  } else if (parsed.protocol !== 'https:') {
    throw new Error('仅支持 HTTPS');
  }

  const host = parsed.hostname;
  if (!allowPrivate && isPrivateHostname(host)) {
    throw new Error('禁止请求内网地址（SSRF 防护）');
  }

  const bareHost = host.replace(/^\[|\]$/g, '');
  if (!allowPrivate && !isIP(bareHost)) {
    try {
      const results = await lookup(host, { all: true, verbatim: true });
      if (!results?.length) throw new Error('DNS 解析失败');
      for (const r of results) {
        if (isPrivateIp(r.address)) {
          throw new Error(`禁止请求内网地址（解析到 ${r.address}）`);
        }
      }
    } catch (e: any) {
      if (String(e?.message || '').includes('禁止请求')) throw e;
      throw new Error(`DNS 解析失败: ${e?.message || e}`);
    }
  }
}

/** 通用 JSON 请求；默认不跟随跳转 */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}
