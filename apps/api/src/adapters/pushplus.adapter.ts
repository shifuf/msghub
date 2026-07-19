import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
  requireString,
} from './adapter.interface';
import { fetchJson } from './http.util';

@Injectable()
export class PushPlusAdapter implements ChannelAdapter {
  readonly type = ChannelType.PUSHPLUS;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'token');
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    const token = requireString(config, 'token');
    const template =
      typeof config.template === 'string' && config.template ? config.template : 'html';
    try {
      const res = await fetchJson('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          title: payload.title || '通知',
          content: payload.html || payload.content || '',
          template,
        }),
      });
      const data = res.data as { code?: number; msg?: string } | null;
      if (!res.ok || (data && typeof data.code === 'number' && data.code !== 200)) {
        return {
          success: false,
          response: res.data,
          errorMessage: data?.msg || res.text || `HTTP ${res.status}`,
        };
      }
      return { success: true, response: res.data };
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
  }

  test(config: Record<string, unknown>) {
    return this.send(config, {
      title: '【测试】连通性测试',
      content: '这是一条来自消息推送平台的测试消息。',
    });
  }
}
