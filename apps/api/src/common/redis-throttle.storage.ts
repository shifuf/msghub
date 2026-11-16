import { Global, Injectable, Module, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { resolveRedis } from './env';

const incrementScript = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), 1, blocked}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local expiry = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, expiry, 1, tonumber(ARGV[3])}
end
return {hits, expiry, 0, 0}
`;

@Injectable()
export class RedisThrottleStorage implements ThrottlerStorage, OnModuleDestroy {
  private redis: Redis;
  constructor() {
    this.redis = new Redis({ ...resolveRedis(), lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: attempt => Math.min(attempt * 250, 5000) });
    this.redis.on('error', () => undefined);
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, _name: string) {
    try {
      const result = await this.redis.eval(incrementScript, 2, `throttle:{${key}}:hits`, `throttle:{${key}}:block`, ttl, limit, blockDuration || ttl) as number[];
      return { totalHits: Number(result[0]), timeToExpire: Math.max(0, Math.ceil(Number(result[1]) / 1000)), isBlocked: Number(result[2]) === 1, timeToBlockExpire: Math.max(0, Math.ceil(Number(result[3]) / 1000)) };
    } catch {
      throw new ServiceUnavailableException('限流服务暂不可用，请稍后重试');
    }
  }

  onModuleDestroy() { this.redis.disconnect(); }
}

@Global()
@Module({ providers: [RedisThrottleStorage], exports: [RedisThrottleStorage] })
export class RedisThrottleModule {}
