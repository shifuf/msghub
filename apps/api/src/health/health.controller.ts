import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { SEND_QUEUE } from '../queue/queue.constants';
import { ok } from '../common/utils';

async function bounded<T>(work: Promise<T>, milliseconds = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), milliseconds); })]);
  } finally { clearTimeout(timer!); }
}

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService, @InjectQueue(SEND_QUEUE) private queue: Queue) {}

  @SkipThrottle()
  @Get('live')
  live() { return ok({ status: 'ok', time: new Date().toISOString() }); }

  @SkipThrottle()
  @Get(['', 'ready'])
  async check() {
    const results = await Promise.allSettled([
      bounded(this.prisma.$queryRaw`SELECT 1`),
      bounded(this.queue.client.then(client => (client as unknown as { ping(): Promise<string> }).ping())),
      bounded(Promise.all([this.queue.getWorkers(), this.queue.isPaused(), this.queue.getJobCounts('waiting', 'active', 'failed', 'delayed')]).then(([workers, paused, counts]) => {
        if (!workers.length || paused) throw new Error('worker unavailable');
        return { workers: workers.length, counts };
      })),
    ]);
    const info: Record<string, unknown> = {};
    ['database', 'redis', 'worker'].forEach((name, index) => {
      const result = results[index];
      info[name] = result.status === 'fulfilled' ? { status: 'up', ...(name === 'worker' ? result.value as object : {}) } : { status: 'down' };
    });
    if (results.some(result => result.status === 'rejected')) throw new ServiceUnavailableException({ error: { code: 'NOT_READY', message: '服务尚未就绪' }, data: { status: 'error', info } });
    return ok({ status: 'ok', info, time: new Date().toISOString() });
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('throttle-test')
  throttleTest() { return ok({ ok: true, message: '限流探测通过（窗口 60s / 上限 5 次）', limit: 5, ttlMs: 60000, time: new Date().toISOString() }); }
}
