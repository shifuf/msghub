import { Controller, Query, Sse, UnauthorizedException, MessageEvent } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';

@Controller('admin/realtime')
export class RealtimeController {
  constructor(
    private realtime: RealtimeService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  /** EventSource 用 ?token= 鉴权 */
  @Sse('stream')
  stream(@Query('token') token?: string): Observable<MessageEvent> {
    if (!token) throw new UnauthorizedException('缺少 token');
    try {
      this.jwt.verify(token, {
        secret: this.config.get<string>('JWT_SECRET') || 'dev-secret-change-me',
      });
    } catch {
      throw new UnauthorizedException('token 无效');
    }
    return this.realtime.stream();
  }
}
