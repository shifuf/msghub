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
 * Bark 推送：https://github.com/Finb/Bark
 * POST {server}/{deviceKey}  JSON: title/body + 可选参数
 */
@Injectable()
export class BarkAdapter implements ChannelAdapter {
  readonly type = ChannelType.BARK;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'deviceKey');
    if (typeof config.serverUrl === 'string' && config.serverUrl.trim()) {
      let u: URL;
      try {
        u = new URL(config.serverUrl.trim());
      } catch {
        throw new Error('Bark 服务器地址无效');
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('Bark 服务器仅支持 http/https');
      }
    }
  }

  private endpoint(config: Record<string, unknown>) {
    const deviceKey = requireString(config, 'deviceKey');
    const raw =
      typeof config.serverUrl === 'string' && config.serverUrl.trim()
        ? config.serverUrl.trim().replace(/\/+$/, '')
        : 'https://api.day.app';
    return `${raw}/${encodeURIComponent(deviceKey)}`;
  }

  async send(
    config: Record<string, unknown>,
    payload: SendPayload,
  ): Promise<SendResult> {
    this.validateConfig(config);
    const endpoint = this.endpoint(config);
    // 自定义 serverUrl 视为自建，允许局域网；官方 api.day.app 走完整 DNS 校验
    const isCustom =
      typeof config.serverUrl === 'string' && !!config.serverUrl.trim();
    try {
      await assertSafeOutboundUrl(endpoint, {
        allowHttp: true,
        allowPrivate: isCustom || config.allowPrivate === true,
      });
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
    const title = payload.title || '通知';
    const body = payload.content || payload.html || '';
    const extra = (payload.extra || {}) as Record<string, unknown>;

    const data: Record<string, unknown> = {
      title,
      body,
    };
    // 可选 Bark 字段：从渠道默认配置或本次 extra 透传
    for (const key of [
      'subtitle',
      'group',
      'sound',
      'icon',
      'image',
      'url',
      'level',
      'volume',
      'badge',
      'call',
      'isArchive',
      'copy',
      'autoCopy',
    ]) {
      const fromExtra = extra[key];
      const fromCfg = config[key];
      const v = fromExtra !== undefined ? fromExtra : fromCfg;
      if (v !== undefined && v !== null && v !== '') data[key] = v;
    }

    try {
      const res = await fetchJson(this.endpoint(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(data),
      }, undefined, { allowHttp: true, allowPrivate: isCustom || config.allowPrivate === true });
      const resp = res.data as { code?: number; message?: string } | null;
      if (!res.ok || (resp && typeof resp.code === 'number' && resp.code !== 200)) {
        return {
          success: false,
          response: res.data,
          errorMessage: resp?.message || res.text || `HTTP ${res.status}`,
        };
      }
      return { success: true, response: res.data };
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
  }

  test(config: Record<string, unknown>) {
    return this.send(config, {
      title: '【测试】Bark 连通性',
      content: '这是一条来自消息推送平台的测试消息。',
    });
  }
}
