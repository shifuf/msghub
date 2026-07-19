import { Controller, Get } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { ok } from '../common/utils';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaIndicator: PrismaHealthIndicator,
    private prisma: PrismaService,
  ) {}

  @SkipThrottle()
  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
    ]);
    return ok({
      status: result.status,
      info: result.info,
      time: new Date().toISOString(),
    });
  }

  /**
   * 限流探测：60 秒窗口内最多 5 次，用于后台「限流测试」。
   * 超限时全局 Throttler 返回 429。
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('throttle-test')
  throttleTest() {
    return ok({
      ok: true,
      message: '限流探测通过（窗口 60s / 上限 5 次）',
      limit: 5,
      ttlMs: 60000,
      time: new Date().toISOString(),
    });
  }
}
