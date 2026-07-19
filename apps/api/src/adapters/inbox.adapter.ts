import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  ChannelAdapter,
  SendPayload,
  SendResult,
} from './adapter.interface';

/** 站内渠道：不外发，仅由消息日志 + SSE 弹窗承接 */
@Injectable()
export class InboxAdapter implements ChannelAdapter {
  readonly type = ChannelType.INBOX;

  validateConfig(_config: Record<string, unknown>) {
    // 无需外部配置
  }

  async send(
    _config: Record<string, unknown>,
    payload: SendPayload,
  ): Promise<SendResult> {
    if (!payload.title && !payload.content && !payload.html) {
      return { success: false, errorMessage: '站内通知需要 title 或 content' };
    }
    return {
      success: true,
      response: { inbox: true, deliveredAt: new Date().toISOString() },
    };
  }

  async test(config: Record<string, unknown>): Promise<SendResult> {
    return this.send(config, {
      title: '【测试】站内通知',
      content: '站内渠道可用：消息会进入发送记录并在后台弹窗。',
    });
  }
}
