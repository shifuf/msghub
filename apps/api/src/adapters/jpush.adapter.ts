import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
  requireString,
} from './adapter.interface';
import { assertSafeOutboundUrl, fetchJson } from './http.util';

const JPUSH_PUSH_URL = 'https://api.jpush.cn/v3/push';

/**
 * 极光推送（JPush）Android
 * 文档：https://docs.jiguang.cn/jpush/server/push/rest_api_v3_push
 *
 * 渠道配置：
 * - appKey / masterSecret（必填，服务端密钥勿泄露）
 * - registrationId（默认按 RID 发送，可多条逗号分隔）
 * - alias（可选，audienceMode=alias 时用）
 * - audienceMode: registration_id | alias | all（默认 registration_id）
 * - timeToLive 秒（默认 86400）
 * - apnsProduction（iOS 用，默认 false）
 */
@Injectable()
export class JpushAdapter implements ChannelAdapter {
  readonly type = ChannelType.JPUSH;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'appKey');
    requireString(config, 'masterSecret');
    const mode = this.audienceMode(config);
    if (mode === 'registration_id') {
      const rid =
        typeof config.registrationId === 'string'
          ? config.registrationId.trim()
          : '';
      if (!rid) {
        throw new Error('JPUSH 配置缺少 registrationId（按 Registration ID 发送）');
      }
    } else if (mode === 'alias') {
      const alias =
        typeof config.alias === 'string' ? config.alias.trim() : '';
      if (!alias) throw new Error('JPUSH 配置缺少 alias');
    }
  }

  private audienceMode(config: Record<string, unknown>): string {
    const m =
      typeof config.audienceMode === 'string'
        ? config.audienceMode.trim().toLowerCase()
        : 'registration_id';
    if (m === 'alias' || m === 'all' || m === 'registration_id') return m;
    return 'registration_id';
  }

  private basicAuth(config: Record<string, unknown>): string {
    const appKey = requireString(config, 'appKey');
    const secret = requireString(config, 'masterSecret');
    return Buffer.from(`${appKey}:${secret}`, 'utf8').toString('base64');
  }

  private buildAudience(
    config: Record<string, unknown>,
    extra: Record<string, unknown>,
  ): unknown {
    const mode = this.audienceMode(config);
    // 单次发送可被 extra 覆盖 RID / alias
    if (mode === 'all' && !extra.registrationId && !extra.alias) {
      return 'all';
    }
    const ridRaw =
      (typeof extra.registrationId === 'string' && extra.registrationId) ||
      (typeof config.registrationId === 'string' && config.registrationId) ||
      '';
    const aliasRaw =
      (typeof extra.alias === 'string' && extra.alias) ||
      (typeof config.alias === 'string' && config.alias) ||
      '';

    if (mode === 'alias' || (!ridRaw && aliasRaw)) {
      const list = String(aliasRaw)
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.length) throw new Error('JPUSH alias 为空');
      return { alias: list };
    }

    const list = String(ridRaw)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) throw new Error('JPUSH registrationId 为空');
    return { registration_id: list };
  }

  async send(
    config: Record<string, unknown>,
    payload: SendPayload,
  ): Promise<SendResult> {
    try {
      this.validateConfig(config);
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }

    try {
      await assertSafeOutboundUrl(JPUSH_PUSH_URL);
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }

    const title = payload.title || '通知';
    const content = (payload.content || payload.html || '').toString();
    const extra = (payload.extra || {}) as Record<string, unknown>;

    let audience: unknown;
    try {
      audience = this.buildAudience(config, extra);
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }

    const extras: Record<string, string> = {};
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null) continue;
      if (k === 'registrationId' || k === 'alias' || k === 'variables') continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        extras[k] = String(v);
      }
    }
    // 点击打开 URL
    if (typeof extra.url === 'string' && extra.url.startsWith('http')) {
      extras.url = extra.url;
    }

    const ttl =
      typeof config.timeToLive === 'number' && config.timeToLive > 0
        ? Math.floor(config.timeToLive)
        : typeof extra.timeToLive === 'number'
          ? Math.floor(extra.timeToLive as number)
          : 86400;

    const body = {
      platform: 'android',
      audience,
      notification: {
        android: {
          alert: content || title,
          title,
          extras,
          priority: 1,
          alert_type: 7,
        },
      },
      // 只发 notification，避免再发 custom message 导致手机端重复记 2~3 条历史
      // （自定义 message 会再弹本地通知 + 历史）
      options: {
        apns_production: config.apnsProduction === true,
        time_to_live: Math.min(Math.max(ttl, 60), 864000),
      },
    };

    try {
      const res = await fetchJson(JPUSH_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Basic ${this.basicAuth(config)}`,
        },
        body: JSON.stringify(body),
      });
      const data = res.data as { msg_id?: string; error?: { code?: number; message?: string } } | null;
      if (!res.ok || (data && data.error)) {
        return {
          success: false,
          response: res.data,
          errorMessage:
            data?.error?.message ||
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
      title: '【测试】极光推送',
      content: '这是一条来自消息推送平台的 JPush 测试通知。',
      extra: { test: true },
    });
  }
}
