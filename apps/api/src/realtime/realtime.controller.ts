import { Controller, Query, Sse, UnauthorizedException, MessageEvent, Post, UseGuards, Request } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable, Subscription, concatMap, from, takeWhile, map } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ok } from '../common/utils';

@Controller('admin/realtime')
export class RealtimeController {
  constructor(
    private realtime: RealtimeService,
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  @Post('ticket')
  @UseGuards(JwtAuthGuard)
  async ticket(@Request() req: any) {
    const ticket = await this.jwt.signAsync({ sub: req.user.id, ver: req.user.tokenVersion }, { audience: 'realtime', expiresIn: 60 });
    return ok({ ticket, expiresIn: 60 });
  }

  @Sse('stream')
  async stream(@Query('ticket') ticket?: string): Promise<Observable<MessageEvent>> {
    if (!ticket) throw new UnauthorizedException('缺少实时票据');
    let payload: { sub: string; ver: number };
    try {
      payload = await this.jwt.verifyAsync(ticket, { audience: 'realtime', algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || !Number.isInteger(payload.ver)) throw new Error('Invalid identity');
    } catch {
      throw new UnauthorizedException('实时票据无效');
    }
    const valid = async () => {
      const user = await this.prisma.adminUser.findUnique({ where: { id: payload.sub }, select: { tokenVersion: true } });
      return !!user && user.tokenVersion === payload.ver;
    };
    if (!await valid()) throw new UnauthorizedException('会话已撤销');
    return new Observable<MessageEvent>((subscriber) => {
      let source: Subscription | undefined;
      let checking = false;
      const recheck = async () => {
        if (checking) return;
        checking = true;
        try { if (!await valid()) subscriber.complete(); }
        catch { subscriber.complete(); }
        finally { checking = false; }
      };
      const interval = setInterval(() => void recheck(), 15000);
      // Force a fresh authenticated ticket periodically even if no events occur.
      const expiry = setTimeout(() => subscriber.complete(), 5 * 60000);
      source = this.realtime.stream().pipe(
        concatMap(event => from(valid().then(allowed => ({ allowed, event })))),
        takeWhile(result => result.allowed),
        map(result => result.event),
      ).subscribe(subscriber);
      return () => { clearInterval(interval); clearTimeout(expiry); source?.unsubscribe(); };
    });
  }
}
