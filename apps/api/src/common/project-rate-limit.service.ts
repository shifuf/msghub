import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { resolveRedis } from './env';

@Injectable()
export class ProjectRateLimitService {
  private readonly logger = new Logger(ProjectRateLimitService.name);
  private redis: Redis | null = null;
  private memory = new Map<string, { count: number; resetAt: number }>();

  constructor() {
    try {
      const redis = resolveRedis();
      this.redis = new Redis({
        host: redis.host,
        port: redis.port,
        password: redis.password,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      void this.redis.connect().catch((e) => {
        this.logger.warn(`rate-limit redis unavailable: ${e?.message || e}`);
        try {
          this.redis?.disconnect();
        } catch {
          /* ignore */
        }
        this.redis = null;
      });
    } catch {
      this.redis = null;
    }
  }

  /**
   * 固定窗口限流。Redis 不可用时 fail-closed（拒绝），避免刷爆外发渠道。
   * 仅当 limit 未配置时放行。
   */
  async check(projectId: string, limitPerMin: number | null | undefined): Promise<{
    allowed: boolean;
    remaining: number;
    limit: number;
  }> {
    const limit = Number(limitPerMin);
    if (!limit || limit <= 0) {
      return { allowed: true, remaining: Infinity, limit: 0 };
    }

    const windowKey = `rl:project:${projectId}:${Math.floor(Date.now() / 60_000)}`;

    if (this.redis) {
      try {
        const n = await this.redis.incr(windowKey);
        if (n === 1) await this.redis.expire(windowKey, 70);
        return {
          allowed: n <= limit,
          remaining: Math.max(0, limit - n),
          limit,
        };
      } catch (e: any) {
        this.logger.warn(`rate-limit redis error, fail-closed: ${e?.message || e}`);
        return { allowed: false, remaining: 0, limit };
      }
    }

    // 无 Redis：进程内限流；多实例场景会放宽，日志提醒
    this.logger.debug(
      `rate-limit using in-memory fallback for project=${projectId} (multi-instance not strict)`,
    );
    const now = Date.now();
    const slot = this.memory.get(windowKey);
    if (!slot || slot.resetAt <= now) {
      this.memory.set(windowKey, { count: 1, resetAt: now + 60_000 });
      if (this.memory.size > 5000) {
        for (const [k, v] of this.memory) {
          if (v.resetAt <= now) this.memory.delete(k);
        }
      }
      return { allowed: true, remaining: limit - 1, limit };
    }
    slot.count += 1;
    return {
      allowed: slot.count <= limit,
      remaining: Math.max(0, limit - slot.count),
      limit,
    };
  }
}
