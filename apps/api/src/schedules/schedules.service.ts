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
import { randomUUID } from 'crypto';
import { DeliveryUncertainError } from '../common/delivery.util';
import { DEFAULT_SCHEDULE_TIMEZONE, nextScheduleRun, validateScheduleRule, validateScheduleTimezone } from './recurrence';
import { sanitizeErrorMessage } from '../common/utils';

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

  async list(query: { projectId?: string; status?: string; page?: number; pageSize?: number }) {
    const where: any = {};
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const paginated = query.page != null || query.pageSize != null;
    const items = await this.prisma.scheduledMessage.findMany({
      where,
      orderBy: [{ runAt: 'asc' }, { createdAt: 'desc' }],
      include: { project: { select: { id: true, name: true } } },
      skip: paginated ? (page - 1) * pageSize : 0,
      take: paginated ? pageSize : 1000,
    });
    return paginated ? { items, total: await this.prisma.scheduledMessage.count({ where }), page, pageSize } : items;
  }

  async get(id: string) {
    const row = await this.prisma.scheduledMessage.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('定时消息不存在');
    return row;
  }

  async history(id: string, query: { page?: number; pageSize?: number } = {}) {
    await this.get(id);
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 20)));
    const where = { scheduleId: id };
    const [items, total] = await Promise.all([
      this.prisma.scheduleExecution.findMany({ where, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.scheduleExecution.count({ where }),
    ]);
    return { items, total, page, pageSize };
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
    timezone?: string;
  }) {
    if (!data.projectId) throw new BadRequestException('缺少 projectId');
    validateScheduleTimezone(data.timezone ?? DEFAULT_SCHEDULE_TIMEZONE);
    validateScheduleRule(data.cron);
    if (data.variables && ['quietRelease', 'unreadEmailFallback', 'sourceMessageId', 'inboxMessageId'].some((key) => key in data.variables!)) throw new BadRequestException('variables 含内部任务保留字段');
    if (data.kind && !['push', 'email'].includes(data.kind)) throw new BadRequestException('任务 kind 无效');
    const runAt = new Date(data.runAt);
    if (Number.isNaN(runAt.getTime())) {
      throw new BadRequestException('runAt 无效');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: data.projectId },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (!project.enabled) throw new BadRequestException('项目已禁用');
    if (data.channelId) {
      const binding = await this.prisma.projectChannel.findUnique({ where: { projectId_channelId: { projectId: data.projectId, channelId: data.channelId } }, include: { channel: true } });
      if (!binding?.enabled || !binding.channel?.enabled) throw new BadRequestException('渠道未绑定或已禁用');
      if (data.channelType && data.channelType !== binding.channel.type) throw new BadRequestException('channelId 与 channelType 不一致');
    }

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
        timezone: data.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
        status: 'PENDING',
      },
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async cancel(id: string) {
    const row = await this.get(id);
    if (!['PENDING', 'PAUSED'].includes(row.status)) {
      throw new BadRequestException('只能取消待执行的定时消息');
    }
    const result = await this.prisma.scheduledMessage.updateMany({
      where: { id, status: row.status },
      data: { status: 'CANCELLED' },
    });
    if (!result.count) throw new BadRequestException('任务已被领取，无法取消');
    return this.get(id);
  }

  async update(id: string, data: { title?: string; content?: string; html?: string; runAt?: string; cron?: string; timezone?: string; variables?: Record<string, unknown> }) {
    if (data.variables && ['quietRelease', 'unreadEmailFallback', 'sourceMessageId', 'inboxMessageId'].some((key) => key in data.variables!)) throw new BadRequestException('variables 含内部任务保留字段');
    validateScheduleRule(data.cron);
    if (data.timezone !== undefined) validateScheduleTimezone(data.timezone);
    const runAt = data.runAt === undefined ? undefined : new Date(data.runAt);
    if (runAt && !Number.isFinite(runAt.getTime())) throw new BadRequestException('runAt 无效');
    const changed = await this.prisma.scheduledMessage.updateMany({ where: { id, status: { in: ['PENDING', 'PAUSED'] } }, data: { ...data, variables: data.variables as any, runAt } });
    if (!changed.count) throw new BadRequestException('仅待执行或暂停的任务可编辑');
    return this.get(id);
  }

  async pause(id: string) {
    const changed = await this.prisma.scheduledMessage.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PAUSED' } });
    if (!changed.count) throw new BadRequestException('仅待执行任务可暂停');
    return this.get(id);
  }

  async resume(id: string) {
    const changed = await this.prisma.scheduledMessage.updateMany({ where: { id, status: 'PAUSED' }, data: { status: 'PENDING' } });
    if (!changed.count) throw new BadRequestException('仅暂停任务可恢复');
    return this.get(id);
  }

  async resolve(id: string, data: { action: 'delivered' | 'retry'; acknowledgeDuplicateRisk?: boolean }) {
    if (!['delivered', 'retry'].includes(data.action)) throw new BadRequestException('无效处理操作');
    if (data.action === 'retry' && data.acknowledgeDuplicateRisk !== true) throw new BadRequestException('重试可能重复发送，须明确确认重复风险');
    const row = await this.get(id);
    const next = data.action === 'delivered' && row.cron && row.kind !== 'unread_email_fallback'
      ? nextScheduleRun(row.runAt, row.cron, row.timezone || DEFAULT_SCHEDULE_TIMEZONE) : null;
    const changed = await this.prisma.scheduledMessage.updateMany({
      where: { id, status: 'UNCERTAIN' },
      data: { status: data.action === 'delivered' && !next ? 'SUCCESS' : 'PENDING', leaseUntil: null, executionKey: null,
        ...(data.action === 'retry' ? { runAt: new Date() } : next ? { runAt: next } : {}),
        lastError: data.action === 'delivered' ? '管理员核实已送达' : '管理员确认重复风险后重试' },
    });
    if (!changed.count) throw new BadRequestException('仅结果待核实任务可处理，状态可能已变更');
    return this.get(id);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.scheduledMessage.updateMany({
        where: { status: 'RUNNING', OR: [{ leaseUntil: { lt: new Date() } }, { leaseUntil: null }] } as any,
        data: { status: 'UNCERTAIN', lastError: '执行租约过期；外部送达结果未知，请核实后手动重建任务', leaseUntil: null } as any,
      });
      await this.prisma.scheduleExecution.updateMany({
        where: { status: 'RUNNING', schedule: { status: 'UNCERTAIN' } },
        data: { status: 'UNCERTAIN', finishedAt: new Date(), error: '执行租约过期；外部送达结果未知，等待人工核实' },
      });
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
    const executionKey = randomUUID();
    const item = await this.prisma.$transaction(async db => {
      const claimed = await db.scheduledMessage.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'RUNNING', executionKey, leaseUntil: new Date(Date.now() + 120_000), attempt: { increment: 1 } },
      });
      if (!claimed.count) return null;
      const scheduled = await db.scheduledMessage.findUnique({ where: { id } });
      if (scheduled) await db.scheduleExecution.create({ data: { id: executionKey, scheduleId: id, startedAt: new Date(), status: 'RUNNING' } });
      return scheduled;
    });
    if (!item) return;
    const heartbeat = setInterval(() => {
      void this.prisma.scheduledMessage.updateMany({
        where: { id, status: 'RUNNING', executionKey } as any,
        data: { leaseUntil: new Date(Date.now() + 120_000) } as any,
      }).catch((e) => this.logger.warn(`schedule heartbeat failed: ${e?.message}`));
    }, 30_000);

    let deliveryReturned = false;
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

      deliveryReturned = true;
      const skipped = !!result?.skipped;
      const uncertain = ['UNCERTAIN', 'DELIVERY_UNKNOWN', 'UNKNOWN'].includes(String(result?.status)) || result?.deliveryVerified === false && result?.status === 'UNKNOWN';
      const success = skipped || result?.success !== false && result?.status !== 'FAILED';
      const status = uncertain ? 'UNCERTAIN' : skipped ? 'CANCELLED' : success ? 'SUCCESS' : 'FAILED';
      await this.finishExecution(item, executionKey, status, result?.messageId || null, uncertain ? '外部送达结果未知，等待人工核实' : skipped ? String(result?.reason || 'skipped') : success ? null : result?.errorMessage || '发送失败');
    } catch (e: any) {
      await this.finishExecution(item, executionKey, deliveryReturned || e instanceof DeliveryUncertainError ? 'UNCERTAIN' : 'FAILED', e instanceof DeliveryUncertainError ? e.messageId : null, e?.message || String(e));
      this.logger.warn(`schedule ${id} failed: ${e?.message || e}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async finishExecution(item: any, executionKey: string, status: string, messageId: string | null, error: string | null) {
    const safeError = error ? sanitizeErrorMessage(error) : null;
    const next = status !== 'UNCERTAIN' && item.cron && item.kind !== 'unread_email_fallback'
      ? nextScheduleRun(item.runAt, item.cron, item.timezone || DEFAULT_SCHEDULE_TIMEZONE) : null;
    await this.prisma.$transaction(async db => {
      const changed = await db.scheduledMessage.updateMany({
        where: { id: item.id, status: 'RUNNING', executionKey },
        data: { status: next ? 'PENDING' : status, ...(next ? { runAt: next } : {}), messageId, lastError: safeError, leaseUntil: null, executionKey: null },
      });
      // Lease loss means another ticker already recorded uncertainty; never overwrite it.
      if (changed.count) await db.scheduleExecution.updateMany({
        where: { id: executionKey, status: 'RUNNING' },
        data: { status, messageId, error: safeError, finishedAt: new Date() },
      });
    });
  }
}
