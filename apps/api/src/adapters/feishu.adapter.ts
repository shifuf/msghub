import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
  requireString,
} from './adapter.interface';
import { assertSafeOutboundUrl, fetchJson } from './http.util';

@Injectable()
export class FeishuAdapter implements ChannelAdapter {
  readonly type = ChannelType.FEISHU;

  validateConfig(config: Record<string, unknown>) {
    const webhook = requireString(config, 'webhook');
    let parsed: URL;
    try {
      parsed = new URL(webhook);
    } catch {
      throw new Error('飞书 Webhook URL 无效');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('飞书 Webhook 仅支持 HTTPS');
    }
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    const webhook = requireString(config, 'webhook');
    try {
      await assertSafeOutboundUrl(webhook);
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
    const title = payload.title || '通知';
    const text = [title, payload.content || payload.html || ''].filter(Boolean).join('\n');
    try {
      const res = await fetchJson(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msg_type: 'text',
          content: { text },
        }),
      });
      const data = res.data as { code?: number; StatusCode?: number; msg?: string } | null;
      const code = data?.code ?? data?.StatusCode;
      if (!res.ok || (code !== undefined && code !== 0)) {
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
