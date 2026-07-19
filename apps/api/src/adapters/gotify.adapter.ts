import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
  requireString,
} from './adapter.interface';
import { assertSafeOutboundUrl, fetchJson } from './http.util';

/**
 * Gotify 推送：POST {serverUrl}/message?token={appToken}
 */
@Injectable()
export class GotifyAdapter implements ChannelAdapter {
  readonly type = ChannelType.GOTIFY;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'serverUrl');
    requireString(config, 'appToken');
    let u: URL;
    try {
      u = new URL(requireString(config, 'serverUrl'));
    } catch {
      throw new Error('Gotify 服务器地址无效');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('Gotify 服务器仅支持 http/https');
    }
  }

  private endpoint(config: Record<string, unknown>) {
    const base = requireString(config, 'serverUrl').replace(/\/+$/, '');
    const token = requireString(config, 'appToken');
    return `${base}/message?token=${encodeURIComponent(token)}`;
  }

  async send(
    config: Record<string, unknown>,
    payload: SendPayload,
  ): Promise<SendResult> {
    this.validateConfig(config);
    const endpoint = this.endpoint(config);
    // Gotify 多为自建，默认允许私网；可设 allowPrivate:false 强制公网校验
    try {
      await assertSafeOutboundUrl(endpoint, {
        allowHttp: true,
        allowPrivate: config.allowPrivate !== false,
      });
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
    const title = payload.title || '通知';
    const message = payload.content || payload.html || '';
    const extra = (payload.extra || {}) as Record<string, unknown>;

    let priority = 5;
    const p = extra.priority ?? config.priority;
    if (p !== undefined && p !== null && p !== '') {
      const n = Number(p);
      if (!Number.isNaN(n)) priority = Math.max(0, Math.min(10, Math.floor(n)));
    }

    const body: Record<string, unknown> = {
      title,
      message,
      priority,
    };
    // extras 可透传（Gotify 支持 extras 对象）
    const extras =
      (extra.extras && typeof extra.extras === 'object'
        ? extra.extras
        : config.extras && typeof config.extras === 'object'
          ? config.extras
          : null) as Record<string, unknown> | null;
    if (extras) body.extras = extras;

    try {
      const res = await fetchJson(this.endpoint(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = res.data as { error?: string; errorDescription?: string } | null;
        return {
          success: false,
          response: res.data,
          errorMessage:
            data?.errorDescription ||
            data?.error ||
            res.text ||
            `HTTP ${res.status}`,
        };
      }
      return { success: true, response: res.data };
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
  }

  test(config: Record<string, unknown>) {
    return this.send(config, {
      title: '【测试】Gotify 连通性',
      content: '这是一条来自消息推送平台的测试消息。',
    });
  }
}
