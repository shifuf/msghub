import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { EmailPolicyService } from '../email-policy/email-policy.service';
import {
  maskEmail,
  resolveUnsubscribeSecret,
  verifyUnsubscribeToken,
} from '../common/token.util';
import { ok } from '../common/utils';

class UnsubDto {
  @IsString()
  token!: string;
}

@Controller('public/unsubscribe')
export class UnsubscribeController {
  constructor(
    private emailPolicy: EmailPolicyService,
    private config: ConfigService,
  ) {}

  private secret() {
    try {
      return resolveUnsubscribeSecret(
        this.config.get<string>('UNSUBSCRIBE_SECRET') ||
          this.config.get<string>('JWT_SECRET'),
        { allowDevFallback: true },
      );
    } catch (e: any) {
      throw new ServiceUnavailableException(
        e?.message || '退订服务未正确配置密钥',
      );
    }
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get('preview')
  async preview(@Query('token') token?: string) {
    if (!token) throw new BadRequestException('缺少 token');
    const payload = verifyUnsubscribeToken(token, this.secret());
    if (!payload) throw new BadRequestException('链接无效或已过期');
    return ok({
      emailMasked: maskEmail(payload.email),
      projectId: payload.projectId,
      exp: payload.exp,
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post()
  async unsubscribe(@Body() dto: UnsubDto) {
    if (!dto?.token) throw new BadRequestException('缺少 token');
    const payload = verifyUnsubscribeToken(dto.token, this.secret());
    if (!payload) throw new BadRequestException('链接无效或已过期');
    const entry = await this.emailPolicy.addSuppress({
      projectId: payload.projectId,
      address: payload.email,
      source: 'UNSUBSCRIBE',
      reason: 'user_unsubscribe',
    });
    return ok({
      suppressed: true,
      emailMasked: maskEmail(payload.email),
      id: entry.id,
    });
  }
}
