import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
  requireString,
} from './adapter.interface';

@Injectable()
export class SmtpAdapter implements ChannelAdapter {
  readonly type = ChannelType.SMTP;

  validateConfig(config: Record<string, unknown>) {
    requireString(config, 'host');
    requireString(config, 'user');
    requireString(config, 'pass');
    requireString(config, 'from');
    if (config.port === undefined || config.port === null || config.port === '') {
      throw new Error('配置缺少必填字段: port');
    }
  }

  private createTransport(config: Record<string, unknown>) {
    const port = Number(config.port);
    const secure =
      typeof config.secure === 'boolean'
        ? config.secure
        : port === 465;
    return nodemailer.createTransport({
      host: requireString(config, 'host'),
      port,
      secure,
      auth: {
        user: requireString(config, 'user'),
        pass: requireString(config, 'pass'),
      },
    });
  }

  async send(config: Record<string, unknown>, payload: SendPayload): Promise<SendResult> {
    this.validateConfig(config);
    if (!payload.to) {
      return { success: false, errorMessage: '缺少收件人 to' };
    }
    const fromName =
      typeof config.fromName === 'string' && config.fromName ? config.fromName : undefined;
    const fromAddr = requireString(config, 'from');
    const from = fromName ? `"${fromName}" <${fromAddr}>` : fromAddr;
    const transporter = this.createTransport(config);
    try {
      const info = await transporter.sendMail({
        from,
        to: payload.to,
        subject: payload.title || '通知',
        text: payload.content,
        html: payload.html || payload.content,
      });
      return {
        success: true,
        response: { messageId: info.messageId, accepted: info.accepted },
      };
    } catch (e: any) {
      return { success: false, errorMessage: e?.message || String(e) };
    } finally {
      transporter.close();
    }
  }

  test(config: Record<string, unknown>) {
    const to =
      (typeof config.testTo === 'string' && config.testTo) ||
      (typeof config.user === 'string' ? config.user : undefined);
    return this.send(config, {
      to,
      title: '【测试】连通性测试',
      content: '这是一条来自消息推送平台的测试邮件。',
      html: '<p>这是一条来自消息推送平台的<strong>测试邮件</strong>。</p>',
    });
  }
}
