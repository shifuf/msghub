import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import {
  resolveUnsubscribeSecret,
  verifyReadToken,
} from '../common/token.util';
import { ok } from '../common/utils';

class PublicMarkReadDto {
  @IsString()
  @MinLength(1)
  messageId!: string;

  @IsString()
  @MinLength(1)
  token!: string;
}

/**
 * 公开已读回执：浏览器/App 点击通知后调用，无需登录。
 * POST /api/public/messages/mark-read  { messageId, token }
 */
@Controller('public/messages')
export class PublicMessagesController {
  private readonly logger = new Logger(PublicMessagesController.name);

  constructor(
    private messages: MessagesService,
    private config: ConfigService,
  ) {}

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Post('mark-read')
  async markRead(@Body() dto: PublicMarkReadDto) {
    const messageId = (dto.messageId || '').trim();
    const token = (dto.token || '').trim();
    if (!messageId || !token) {
      throw new BadRequestException('缺少 messageId 或 token');
    }
    let secret: string;
    try {
      secret = resolveUnsubscribeSecret(
        this.config.get('UNSUBSCRIBE_SECRET') || this.config.get('JWT_SECRET'),
        { allowDevFallback: true },
      );
    } catch (e: any) {
      throw new HttpException(
        e?.message || '服务未配置密钥',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!verifyReadToken(messageId, token, secret)) {
      this.logger.warn(
        `mark-read invalid token messageId=${messageId.slice(0, 12)}…`,
      );
      throw new BadRequestException('已读凭证无效');
    }
    const result = await this.messages.markReadPublic(messageId);
    this.logger.log(
      `mark-read ok messageId=${messageId} updated=${(result as any)?.updated} already=${(result as any)?.alreadyRead}`,
    );
    return ok(result);
  }
}
