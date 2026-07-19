import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
  requireString,
} from './adapter.interface';
import { assertSafeOutboundUrl, fetchJson } from './http.util';

@Injectable()
export class DingTalkAdapter implements ChannelAdapter {
  readonly type = ChannelType.DINGTALK;

  validateConfig(config: Record<string, unknown>) {
    const webhook = requireString(config, 'webhook');
    let parsed: URL;
    try {
      parsed = new URL(webhook);
    } catch {
      throw new Error('钉钉 Webhook URL 无效');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('钉钉 Webhook 仅支持 HTTPS');
    }
  }

  private signUrl(webhook: string, secret?: string): string {
    if (!secret) return webhook;
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = encodeURIComponent(
      createHmac('sha256', secret).update(stringToSign).digest('base64'),
    );
    const sep = webhook.includes('?') ? '&' : '?';
    return `${webhook}${sep}timestamp=${timestamp}&sign=${sign}`;
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    const webhook = requireString(config, 'webhook');
    try {
      await assertSafeOutboundUrl(webhook);
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
    const secret = typeof config.secret === 'string' ? config.secret : undefined;
    const url = this.signUrl(webhook, secret);
    const title = payload.title || '通知';
    const text = payload.content || payload.html || '';
    try {
      const res = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            title,
            text: `### ${title}\n\n${text}`,
          },
        }),
      });
      const data = res.data as { errcode?: number; errmsg?: string } | null;
      if (!res.ok || (data && data.errcode !== 0)) {
        return {
          success: false,
          response: res.data,
          errorMessage: data?.errmsg || res.text || `HTTP ${res.status}`,
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
