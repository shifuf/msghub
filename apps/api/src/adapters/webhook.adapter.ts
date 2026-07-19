import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import Handlebars from 'handlebars';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
  requireString,
} from './adapter.interface';
import { assertSafeOutboundUrl, fetchJson } from './http.util';

@Injectable()
export class WebhookAdapter implements ChannelAdapter {
  readonly type = ChannelType.WEBHOOK;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'url');
    // 同步阶段只做基础校验；DNS 在 send 时再查
    let parsed: URL;
    try {
      parsed = new URL(requireString(config, 'url'));
    } catch {
      throw new Error('Webhook URL 无效');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Webhook 地址仅支持 HTTPS');
    }
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    const url = requireString(config, 'url');
    try {
      await assertSafeOutboundUrl(url);
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    }
    // 标准 Webhook 固定 POST
    const method = 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
      Object.assign(headers, config.headers as Record<string, string>);
    }
    // 接口凭证：以 Bearer 写入 Authorization，供对方校验
    const secret =
      (typeof config.secret === 'string' && config.secret.trim()) ||
      (typeof config.token === 'string' && config.token.trim()) ||
      '';
    if (secret && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${secret}`;
    }

    let body: string;
    if (typeof config.bodyTemplate === 'string' && config.bodyTemplate.trim()) {
      const tpl = Handlebars.compile(config.bodyTemplate);
      body = tpl({
        title: payload.title || '',
        content: payload.content || '',
        html: payload.html || '',
        to: payload.to || '',
        extra: payload.extra || {},
      });
    } else {
      body = JSON.stringify({
        title: payload.title,
        content: payload.content,
        html: payload.html,
        to: payload.to,
        extra: payload.extra,
      });
    }

    // 可选 HMAC 签名：timestamp.body
    const hmacSecret =
      typeof config.hmacSecret === 'string' ? config.hmacSecret.trim() : '';
    if (hmacSecret) {
      const timestamp = String(Date.now());
      const signMode =
        config.signMode === 'sha256_base64' ? 'sha256_base64' : 'sha256_hex';
      const hmac = createHmac('sha256', hmacSecret).update(`${timestamp}.${body}`);
      const signature =
        signMode === 'sha256_base64' ? hmac.digest('base64') : hmac.digest('hex');
      const sigHeader =
        (typeof config.hmacHeader === 'string' && config.hmacHeader.trim()) ||
        'X-Signature-256';
      headers['X-Timestamp'] = timestamp;
      headers[sigHeader] =
        signMode === 'sha256_hex' ? `sha256=${signature}` : signature;
    }

    try {
      const res = await fetchJson(url, {
        method,
        headers,
        body,
      });
      if (!res.ok) {
        return {
          success: false,
          response: res.data,
          errorMessage: res.text || `HTTP ${res.status}`,
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
