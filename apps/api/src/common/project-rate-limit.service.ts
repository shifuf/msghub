import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { resolveRedis } from './env';

const incrementWindow = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 70) end
return count
`;

@Injectable()
export class ProjectRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(ProjectRateLimitService.name);
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      ...resolveRedis(),
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      retryStrategy: attempt => Math.min(attempt * 250, 5000),
    });
    this.redis.on('error', () => undefined);
    // A failed first connection must retain the reconnecting client. No process-local fallback.
    void this.redis.connect().catch(() => undefined);
  }

  onModuleDestroy() { this.redis.disconnect(); }

  /** Shared fixed-window quota. A configured quota fails closed until Redis is ready. */
  async check(projectId: string, limitPerMin: number | null | undefined): Promise<{
    allowed: boolean;
    remaining: number;
    limit: number;
  }> {
    const limit = Number(limitPerMin);
    if (!limit || limit <= 0) return { allowed: true, remaining: Infinity, limit: 0 };
    if (!this.redis || this.redis.status !== 'ready') return { allowed: false, remaining: 0, limit };
    const windowKey = `rl:project:${projectId}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const count = Number(await this.redis.eval(incrementWindow, 1, windowKey));
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
    } catch {
      this.logger.warn('project rate-limit Redis unavailable; request denied');
      return { allowed: false, remaining: 0, limit };
    }
  }
}
