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
export class TelegramAdapter implements ChannelAdapter {
  readonly type = ChannelType.TELEGRAM;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'botToken');
    requireString(config, 'chatId');
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    const botToken = requireString(config, 'botToken');
    const chatId = requireString(config, 'chatId');
    const title = payload.title || '通知';
    const body = payload.content || payload.html || '';
    const text = payload.title ? `*${escapeMd(title)}*\n\n${body}` : body;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
      const res = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
      const data = res.data as { ok?: boolean; description?: string } | null;
      if (!res.ok || !data?.ok) {
        return {
          success: false,
          response: res.data,
          errorMessage: data?.description || res.text || `HTTP ${res.status}`,
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

function escapeMd(s: string) {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
