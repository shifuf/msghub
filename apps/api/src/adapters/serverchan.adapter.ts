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
export class ServerChanAdapter implements ChannelAdapter {
  readonly type = ChannelType.SERVERCHAN;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'sendKey');
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    const sendKey = requireString(config, 'sendKey');
    const title = payload.title || '通知';
    const desp = payload.content || payload.html || '';
    const url = `https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`;
    try {
      const res = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, desp }),
      });
      const data = res.data as { code?: number; message?: string } | null;
      if (!res.ok || (data && typeof data.code === 'number' && data.code !== 0)) {
        return {
          success: false,
          response: res.data,
          errorMessage: data?.message || res.text || `HTTP ${res.status}`,
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
