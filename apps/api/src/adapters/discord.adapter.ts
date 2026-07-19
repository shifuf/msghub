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
export class DiscordAdapter implements ChannelAdapter {
  readonly type = ChannelType.DISCORD;

  validateConfig(config: Record<string, unknown>) {
    const url = this.webhookUrl(config);
    if (!url) throw new Error('缺少 webhookUrl');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Discord Webhook URL 无效');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Discord Webhook 仅支持 HTTPS');
    }
  }

  private webhookUrl(config: Record<string, unknown>) {
    return (
      (typeof config.webhookUrl === 'string' && config.webhookUrl.trim()) ||
      (typeof config.webhook === 'string' && config.webhook.trim()) ||
      ''
    );
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    const url = this.webhookUrl(config);
    try {
      await assertSafeOutboundUrl(url);
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
    const title = payload.title || '通知';
    const bodyText = payload.content || payload.html || '';
    const content =
      bodyText.length > 1800
        ? `**${title}**\n${bodyText.slice(0, 1800)}…`
        : `**${title}**\n${bodyText}`;
    try {
      const res = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.slice(0, 2000),
          // 禁止 @everyone/@here 及角色/用户 mention 轰炸
          allowed_mentions: { parse: [] },
          embeds: payload.title
            ? [
                {
                  title: String(payload.title).slice(0, 256),
                  description: (payload.content || payload.html || '').slice(0, 4000),
                },
              ]
            : undefined,
        }),
      });
      // Discord 成功常返回 204 无 body
      if (!res.ok && res.status !== 204) {
        return {
          success: false,
          response: res.data,
          errorMessage: res.text || `HTTP ${res.status}`,
        };
      }
      return { success: true, response: res.data ?? { status: res.status } };
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
