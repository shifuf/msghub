import { lookup } from 'dns/promises';
import { isIP } from 'net';
import * as ipaddr from 'ipaddr.js';
import { Agent, fetch as safeFetch } from 'undici';

const DEFAULT_TIMEOUT = 15000;
export type OutboundOptions = { allowHttp?: boolean; allowPrivate?: boolean; maxResponseBytes?: number };

export function isPrivateHostname(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return true;
  return isIP(host) !== 0 && isPrivateIp(host);
}

export function isPrivateIp(ip: string): boolean {
  const host = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (!ipaddr.isValid(host) || host.includes('%')) return true;
  let address = ipaddr.parse(host);
  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
    address = (address as ipaddr.IPv6).toIPv4Address();
  }
  // Reject loopback, RFC1918, link-local, reserved/documentation, multicast,
  // transition and unspecified ranges; only globally routed unicast is allowed.
  return address.range() !== 'unicast';
}

async function resolveSafeTarget(url: string, options: OutboundOptions = {}) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('URL 无效'); }
  if (parsed.protocol !== 'https:' && !(options.allowHttp && parsed.protocol === 'http:')) throw new Error('仅支持 HTTPS（自建渠道可显式允许 HTTP）');
  if (parsed.username || parsed.password) throw new Error('URL 不允许嵌入凭据');
  const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!options.allowPrivate && isPrivateHostname(host)) throw new Error('禁止请求内网地址（SSRF 防护）');
  const results = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!results.length) throw new Error('DNS 解析失败');
  if (!options.allowPrivate && results.some(result => isPrivateIp(result.address))) throw new Error('禁止请求内网地址（DNS 解析结果）');
  return { parsed, results };
}

export async function assertSafeOutboundUrl(url: string, options?: OutboundOptions) {
  await resolveSafeTarget(url, options);
}

/** Resolve once, pin the connection to the checked address, and preserve TLS hostname verification. */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT,
  options: OutboundOptions = {},
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const { results } = await resolveSafeTarget(url, options);
  const dispatcher = new Agent({ connect: { lookup: ((_host: string, lookupOptions: any, callback: any) => {
    const address = results.find(result => !lookupOptions.family || result.family === lookupOptions.family) || results[0];
    if (lookupOptions.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  }) as any } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await safeFetch(url, { ...init, signal: controller.signal, redirect: 'error', dispatcher } as any);
    const maximum = options.maxResponseBytes || 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maximum) throw new Error('渠道响应过大');
    const reader = response.body?.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > maximum) { await reader.cancel(); throw new Error('渠道响应过大'); }
        chunks.push(Buffer.from(value));
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    let data: unknown = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* preserve non-JSON response */ }
    return { ok: response.ok, status: response.status, data, text };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
    await dispatcher.destroy();
  }
}
