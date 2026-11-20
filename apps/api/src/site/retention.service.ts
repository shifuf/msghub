import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(RetentionService.name);
  constructor(private prisma: PrismaService) {}
  onModuleInit() { this.timer = setInterval(() => { void this.run().catch(e => this.logger.warn(`Retention failed: ${e.message}`)); }, 3600_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: ['activityRetentionDays', 'sensitiveRetentionDays'] } } });
      const value = (key: string) => { const n = Number(rows.find(r => r.key === key)?.value); return Number.isInteger(n) && n > 0 && n <= 36500 ? n : 0; };
      const before = (days: number) => new Date(Date.now() - days * 86400_000);
      const activityDays = value('activityRetentionDays');
      if (activityDays) await this.prisma.activityLog.deleteMany({ where: { createdAt: { lt: before(activityDays) } } });
      const sensitiveDays = value('sensitiveRetentionDays');
      if (sensitiveDays) {
        const active = await this.prisma.scheduledMessage.findMany({ where: { status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'UNCERTAIN'] }, messageId: { not: null } }, select: { messageId: true } });
        const protectedIds = active.map(r => r.messageId!).filter(Boolean);
        const settledConversation: Prisma.MessageLogWhereInput = {
          OR: [{ conversationActivityAt: null }, { conversationClosedAt: { not: null } }],
          replies: { none: { deliveryStatus: { in: ['PENDING', 'UNCERTAIN'] } } },
        };
        // Only known sensitive templates; preserve operational metadata and fallback markers.
        const messages = await this.prisma.messageLog.findMany({ where: {
          templateCode: { in: ['login', 'register', 'reset_password'] }, createdAt: { lt: before(sensitiveDays) }, id: { notIn: protectedIds },
          AND: [
            { OR: [{ status: 'SUCCESS' }, { status: 'FAILED', deliveryStartedAt: null }] },
            { OR: [{ errorMessage: null }, { NOT: { errorMessage: { startsWith: 'DELIVERY_UNKNOWN:' } } }] },
            { OR: [{ content: null }, { content: { not: '[已按保留策略脱敏]' } }] },
            settledConversation,
          ],
        }, take: 500, orderBy: { createdAt: 'asc' } });
        for (const row of messages) {
          const payload = row.payload as Record<string, any> | null;
          await this.prisma.messageLog.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, status: { in: ['SUCCESS', 'FAILED'] }, AND: [settledConversation] }, data: { title: '敏感通知（已脱敏）', content: '[已按保留策略脱敏]', toAddress: null, errorMessage: row.errorMessage ? '[已脱敏错误详情]' : null, attemptDetail: Prisma.DbNull, response: Prisma.DbNull, payload: { redacted: true, emailFallback: payload?.emailFallback ? { at: payload.emailFallback.at, emailMessageId: payload.emailFallback.emailMessageId } : null } } });
        }
      }
      // Do not release unfinished requests: an external send may already have succeeded.
      await this.prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() }, NOT: { response: { equals: Prisma.DbNull } } } });
    } finally { this.running = false; }
  }
}
