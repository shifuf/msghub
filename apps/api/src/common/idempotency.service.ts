import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 查找未过期记录；无则预占（response 为空）。
   * 进行中（response=null 且未过期）返回 inFlight → 409。
   * 过期行用条件更新抢占，避免双发。
   */
  async begin(opts: {
    projectId: string;
    key: string;
    ttlMin: number;
  }): Promise<
    | { hit: true; response: any; messageId?: string | null }
    | { hit: false; inFlight?: boolean; owner?: string }
  > {
    const key = opts.key.trim().slice(0, 200);
    if (opts.key.trim().length > 200) throw new Error('幂等键不能超过 200 字符');
    if (!key) return { hit: false };

    const now = new Date();
    const owner = randomUUID();
    const expiresAt = new Date(now.getTime() + Math.max(1, opts.ttlMin || 30) * 60_000);

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        projectId_key: { projectId: opts.projectId, key },
      },
    });

    if (existing) {
      // An incomplete attempt may already have reached the provider. Do not
      // reclaim it automatically merely because its response TTL elapsed.
      if (existing.response == null) return { hit: false, inFlight: true };
      if (existing.expiresAt > now) {
        if (existing.response != null) {
          return {
            hit: true,
            response: existing.response,
            messageId: existing.messageId,
          };
        }
        return { hit: false, inFlight: true };
      }
      // 过期：条件更新抢占（仅 expiresAt 仍为旧值时可赢）
      const claimed = await this.prisma.idempotencyRecord.updateMany({
        where: {
          id: existing.id,
          expiresAt: existing.expiresAt,
        },
        data: {
          expiresAt,
          response: Prisma.DbNull,
          messageId: null,
          owner,
        } as any,
      });
      if (claimed.count === 0) {
        // 被别人抢走
        const again = await this.prisma.idempotencyRecord.findUnique({
          where: { projectId_key: { projectId: opts.projectId, key } },
        });
        if (again && again.expiresAt > now && again.response != null) {
          return { hit: true, response: again.response, messageId: again.messageId };
        }
        return { hit: false, inFlight: true };
      }
      return { hit: false, owner };
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          projectId: opts.projectId,
          key,
          expiresAt,
          owner,
        } as any,
      });
      return { hit: false, owner };
    } catch (e: any) {
      const again = await this.prisma.idempotencyRecord.findUnique({
        where: { projectId_key: { projectId: opts.projectId, key } },
      });
      if (again && again.expiresAt > now && again.response != null) {
        return { hit: true, response: again.response, messageId: again.messageId };
      }
      if (again && again.expiresAt > now && again.response == null) {
        return { hit: false, inFlight: true };
      }
      this.logger.warn(`idempotency begin race: ${e?.message || e}`);
      return { hit: false, inFlight: true };
    }
  }

  async commit(opts: {
    projectId: string;
    key: string;
    messageId?: string | null;
    response: unknown;
    ttlMin: number;
    owner?: string;
  }) {
    const key = opts.key.trim().slice(0, 200);
    if (!key) return;
    const expiresAt = new Date(
      Date.now() + Math.max(1, opts.ttlMin || 30) * 60_000,
    );
    if (!opts.owner) throw new Error('Missing idempotency owner');
    const result = await this.prisma.idempotencyRecord.updateMany({
      where: { projectId: opts.projectId, key, owner: opts.owner } as any,
      data: {
        messageId: opts.messageId || null,
        response: opts.response as any,
        expiresAt,
      },
    });
    if (!result.count) throw new Error('Idempotency ownership lost');
  }

  async release(opts: { projectId: string; key: string; owner?: string }) {
    const key = opts.key.trim().slice(0, 200);
    if (!key || !opts.owner) return;
    try {
      await this.prisma.idempotencyRecord.deleteMany({
        where: {
          projectId: opts.projectId,
          key,
          owner: opts.owner,
          response: { equals: Prisma.DbNull },
        } as any,
      });
    } catch (e: any) {
      this.logger.warn(`idempotency release: ${e?.message || e}`);
    }
  }

  async cleanupExpired() {
    await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() }, messageId: { not: null } },
    });
  }
}
