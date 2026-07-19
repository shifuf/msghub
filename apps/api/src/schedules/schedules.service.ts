import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ChannelType, MessageSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';

@Injectable()
export class SchedulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulesService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private messages: MessagesService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 20_000);
    this.logger.log('schedule ticker started (20s)');
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async list(query: { projectId?: string; status?: string }) {
    const where: any = {};
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    return this.prisma.scheduledMessage.findMany({
      where,
      orderBy: [{ runAt: 'asc' }, { createdAt: 'desc' }],
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async get(id: string) {
    const row = await this.prisma.scheduledMessage.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('定时消息不存在');
    return row;
  }

  async create(data: {
    projectId: string;
    channelId?: string;
    channelType?: ChannelType;
    kind?: string;
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    template?: string;
    variables?: Record<string, unknown>;
    runAt: string | Date;
    cron?: string;
  }) {
    if (!data.projectId) throw new BadRequestException('缺少 projectId');
    const runAt = new Date(data.runAt);
    if (Number.isNaN(runAt.getTime())) {
      throw new BadRequestException('runAt 无效');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: data.projectId },
    });
    if (!project) throw new NotFoundException('项目不存在');

    return this.prisma.scheduledMessage.create({
      data: {
        projectId: data.projectId,
        channelId: data.channelId || null,
        channelType: data.channelType || null,
        kind: data.kind || (data.template || data.to ? 'email' : 'push'),
        title: data.title || null,
        content: data.content || null,
        html: data.html || null,
        toAddress: data.to || null,
        templateCode: data.template || null,
        variables: (data.variables || null) as any,
        runAt,
        cron: data.cron || null,
        status: 'PENDING',
      },
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async cancel(id: string) {
    const row = await this.get(id);
    if (row.status !== 'PENDING') {
      throw new BadRequestException('只能取消待执行的定时消息');
    }
    return this.prisma.scheduledMessage.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.scheduledMessage.findMany({
        where: {
          status: 'PENDING',
          runAt: { lte: new Date() },
        },
        orderBy: { runAt: 'asc' },
        take: 20,
      });
      for (const item of due) {
        await this.executeOne(item.id);
      }
    } catch (e: any) {
      this.logger.warn(`schedule tick error: ${e?.message || e}`);
    } finally {
      this.running = false;
    }
  }

  private async executeOne(id: string) {
    // 乐观锁：仅 PENDING 可领取
    const claimed = await this.prisma.scheduledMessage.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'RUNNING' },
    });
    if (claimed.count === 0) return;

    const item = await this.prisma.scheduledMessage.findUnique({ where: { id } });
    if (!item) return;

    try {
      const variables = (item.variables || {}) as Record<string, unknown>;
      let result: any;

      // 静默时段释放：强制立即完整派发；保留原 OPEN_API 来源语义
      if (variables.quietRelease) {
        result = await this.messages.sendPush({
          projectId: item.projectId,
          source: MessageSource.OPEN_API,
          title: item.title || undefined,
          content: item.content || undefined,
          html: item.html || undefined,
          extra: {
            ...((variables.extra as Record<string, unknown>) || {}),
            quietRelease: true,
            quietInboxMessageId: variables.inboxMessageId,
          },
          forceSync: true,
          projectDispatch: true,
          forceImmediate: true,
          priority: (variables.priority as any) || 'normal',
          eventCode: (variables.eventCode as string) || undefined,
        });
        // 补发成功后把原 DELAYED 站内记录标为 SUCCESS
        if (
          result?.success !== false &&
          result?.status !== 'FAILED' &&
          typeof variables.inboxMessageId === 'string'
        ) {
          try {
            await this.prisma.messageLog.updateMany({
              where: {
                id: variables.inboxMessageId,
                status: 'DELAYED' as any,
              },
              data: { status: 'SUCCESS' as any },
            });
          } catch {
            /* ignore */
          }
        }
      } else if (item.kind === 'unread_email_fallback' || variables.unreadEmailFallback) {
        result = await this.messages.executeUnreadEmailFallback(item);
      } else if (item.kind === 'email' || item.templateCode || item.toAddress) {
        result = await this.messages.sendEmail({
          projectId: item.projectId,
          source: MessageSource.ADMIN_SEND,
          to: item.toAddress || '',
          channelId: item.channelId || undefined,
          template: item.templateCode || undefined,
          variables,
          subject: item.title || undefined,
          html: item.html || undefined,
          content: item.content || undefined,
          forceSync: true,
        });
      } else {
        // 未指定渠道 → 项目策略（无外发则站内）
        result = await this.messages.sendPush({
          projectId: item.projectId,
          source: MessageSource.ADMIN_SEND,
          channelId: item.channelId || undefined,
          channelType: item.channelType || undefined,
          title: item.title || undefined,
          content: item.content || undefined,
          html: item.html || undefined,
          to: item.toAddress || undefined,
          variables,
          forceSync: true,
          projectDispatch: !item.channelId && !item.channelType,
        });
      }

      const skipped = !!(result as any)?.skipped;
      const success =
        skipped ||
        (result?.success !== false && result?.status !== 'FAILED');
      if (success && item.cron && item.kind !== 'unread_email_fallback') {
        // 简化：cron 非空 → 每日同一时刻重排
        const nextRunAt = new Date(item.runAt.getTime() + 24 * 60 * 60 * 1000);
        await this.prisma.scheduledMessage.update({
          where: { id },
          data: {
            status: 'PENDING',
            runAt: nextRunAt,
            messageId: result?.messageId || item.messageId || null,
            lastError: null,
          },
        });
        this.logger.log(`schedule ${id} success, requeued daily at ${nextRunAt.toISOString()}`);
      } else if (success) {
        await this.prisma.scheduledMessage.update({
          where: { id },
          data: {
            status: skipped ? 'CANCELLED' : 'SUCCESS',
            messageId: result?.messageId || item.messageId || null,
            lastError: skipped
              ? String((result as any)?.reason || 'skipped')
              : null,
          },
        });
      } else {
        await this.prisma.scheduledMessage.update({
          where: { id },
          data: {
            status: 'FAILED',
            messageId: result?.messageId || item.messageId || null,
            lastError: result?.errorMessage || '发送失败',
          },
        });
      }
    } catch (e: any) {
      await this.prisma.scheduledMessage.update({
        where: { id },
        data: {
          status: 'FAILED',
          lastError: e?.message || String(e),
        },
      });
      this.logger.warn(`schedule ${id} failed: ${e?.message || e}`);
    }
  }
}
