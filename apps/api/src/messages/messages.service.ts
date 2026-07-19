import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ChannelType,
  MessagePriority,
  MessageSource,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../adapters/adapters.registry';
import { ChannelsService } from '../channels/channels.service';
import { TemplatesService } from '../templates/templates.service';
import { PushTemplatesService } from '../push-templates/push-templates.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ProjectsService } from '../projects/projects.service';
import { SEND_QUEUE, SendJobData } from '../queue/queue.constants';
import { isValidEmail, sanitizeErrorMessage } from '../common/utils';
import { EmailPolicyService } from '../email-policy/email-policy.service';
import { QuietHoursService } from '../common/quiet-hours.service';
import {
  extractTemplateVars,
  missingTemplateVars,
  resolveUnsubscribeSecret,
  signUnsubscribeToken,
  signReadToken,
} from '../common/token.util';
import {
  resolveAsyncSend,
  resolveSendMaxAttempts,
  resolveSiteUrl,
} from '../common/env';

export type MessageListQuery = {
  projectId?: string;
  status?: MessageStatus;
  channelType?: ChannelType;
  page?: number;
  pageSize?: number;
  q?: string;
  from?: string;
  to?: string;
  hasError?: boolean;
  /** 收件人模糊匹配 */
  toAddress?: string;
  /** 仅 SMTP 失败：status=FAILED 且 channelType=SMTP */
  onlySmtpFailed?: boolean;
  unreadOnly?: boolean;
  archived?: boolean | 'only' | 'exclude';
  eventCode?: string;
  priority?: MessagePriority;
};

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly asyncEnabled: boolean;
  private readonly maxAttempts: number;

  constructor(
    private prisma: PrismaService,
    private adapters: AdapterRegistry,
    private channels: ChannelsService,
    private templates: TemplatesService,
    private pushTemplates: PushTemplatesService,
    private config: ConfigService,
    private realtime: RealtimeService,
    private projects: ProjectsService,
    private emailPolicy: EmailPolicyService,
    private quietHours: QuietHoursService,
    @InjectQueue(SEND_QUEUE) private sendQueue: Queue<SendJobData>,
  ) {
    this.asyncEnabled = resolveAsyncSend();
    this.maxAttempts = resolveSendMaxAttempts();
  }

  private buildListWhere(query: MessageListQuery): Prisma.MessageLogWhereInput {
    const where: Prisma.MessageLogWhereInput = {};
    if (query.projectId) where.projectId = query.projectId;

    if (query.onlySmtpFailed) {
      where.status = MessageStatus.FAILED;
      where.channelType = ChannelType.SMTP;
    } else {
      if (query.status) where.status = query.status;
      if (query.channelType) where.channelType = query.channelType;
    }

    if (query.hasError === true) {
      where.errorMessage = { not: null };
    } else if (query.hasError === false) {
      where.errorMessage = null;
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        const from = new Date(query.from);
        if (!Number.isNaN(from.getTime())) where.createdAt.gte = from;
      }
      if (query.to) {
        const to = new Date(query.to);
        if (!Number.isNaN(to.getTime())) where.createdAt.lte = to;
      }
    }

    if (query.toAddress?.trim()) {
      where.toAddress = { contains: query.toAddress.trim(), mode: 'insensitive' };
    }

    if (query.unreadOnly) where.readAt = null;
    if (query.archived === true || query.archived === 'only') {
      where.archivedAt = { not: null };
    } else if (query.archived === false || query.archived === 'exclude') {
      where.archivedAt = null;
    }
    if (query.eventCode) where.eventCode = query.eventCode;
    if (query.priority) where.priority = query.priority;

    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { id: { contains: q } },
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { errorMessage: { contains: q, mode: 'insensitive' } },
        { toAddress: { contains: q, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private appendAttempt(
    prev: unknown,
    entry: { n: number; at: string; status: string; error?: string | null; durationMs?: number },
  ) {
    const list = Array.isArray(prev) ? [...prev] : [];
    list.push(entry);
    return list.slice(-20);
  }

  private backoffMs(attempt: number) {
    // 与 Bull exponential delay 2000 对齐：2s, 4s, 8s...
    return Math.min(60_000, 2000 * Math.pow(2, Math.max(0, attempt - 1)));
  }

  async list(query: MessageListQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where = this.buildListWhere(query);

    const [total, items] = await Promise.all([
      this.prisma.messageLog.count({ where }),
      this.prisma.messageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true } },
        },
      }),
    ]);

    return { items, total, page, pageSize };
  }

  async exportCsv(query: MessageListQuery) {
    const where = this.buildListWhere(query);
    const items = await this.prisma.messageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    const header = [
      'id',
      'createdAt',
      'project',
      'channelType',
      'source',
      'status',
      'title',
      'errorMessage',
      'durationMs',
      'attempts',
    ];

    const escape = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const lines = [header.join(',')];
    for (const m of items) {
      lines.push(
        [
          m.id,
          m.createdAt.toISOString(),
          m.project?.name || '',
          m.channelType || '',
          m.source,
          m.status,
          m.title || '',
          m.errorMessage || '',
          m.durationMs ?? '',
          m.attempts,
        ]
          .map(escape)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  async get(id: string) {
    const m = await this.prisma.messageLog.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true, type: true } },
      },
    });
    if (!m) throw new NotFoundException('消息记录不存在');
    return m;
  }

  /** 清空发送记录（可按项目 / 仅失败过滤） */
  async clear(opts: {
    projectId?: string;
    onlyFailed?: boolean;
    before?: string;
  } = {}) {
    const where: Prisma.MessageLogWhereInput = {};
    if (opts.projectId) where.projectId = opts.projectId;
    if (opts.onlyFailed) {
      where.OR = [
        { status: MessageStatus.FAILED },
        { errorMessage: { not: null } },
      ];
    }
    if (opts.before) {
      const d = new Date(opts.before);
      if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d };
    }
    const result = await this.prisma.messageLog.deleteMany({ where });
    this.logger.log(
      `cleared message logs: deleted=${result.count} projectId=${opts.projectId || '*'} onlyFailed=${!!opts.onlyFailed}`,
    );
    return { deleted: result.count };
  }

  /** Open API 安全字段 */
  toPublicMessage(m: {
    id: string;
    status: MessageStatus;
    title: string | null;
    content: string | null;
    channelType: ChannelType | null;
    errorMessage: string | null;
    durationMs: number | null;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
    templateCode: string | null;
    toAddress: string | null;
  }) {
    return {
      id: m.id,
      status: m.status,
      title: m.title,
      content: m.content,
      channelType: m.channelType,
      errorMessage: m.errorMessage,
      durationMs: m.durationMs,
      attempts: m.attempts,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      templateCode: m.templateCode,
      toAddress: m.toAddress,
    };
  }

  private async publishLog(messageId: string) {
    try {
      const m = await this.prisma.messageLog.findUnique({
        where: { id: messageId },
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true } },
        },
      });
      if (m) this.realtime.emitMessage(m);
    } catch (e) {
      this.logger.debug(`publish log failed: ${e}`);
    }
  }

  private buildReadExtra(
    messageId: string,
    extra?: Record<string, unknown>,
  ): Record<string, unknown> {
    const base = { ...(extra || {}) };
    base.messageId = messageId;
    try {
      const secret = resolveUnsubscribeSecret(
        this.config.get('UNSUBSCRIBE_SECRET') || this.config.get('JWT_SECRET'),
        { allowDevFallback: true },
      );
      base.readToken = signReadToken(messageId, secret);
    } catch {
      /* 未配置密钥时不注入，公开已读接口会 503 */
    }
    return base;
  }

  private async enqueueOrSend(opts: {
    kind: 'push' | 'email';
    projectId: string;
    channelId: string;
    channelType: ChannelType;
    source: MessageSource;
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    extra?: Record<string, unknown>;
    templateCode?: string;
    forceSync?: boolean;
    parentId?: string;
    /** 已尝试过的渠道，避免兜底死循环 */
    triedChannelIds?: string[];
    /** 是否跳过失败后的渠道兜底（邮件/告警自身） */
    skipFailover?: boolean;
    priority?: MessagePriority;
    eventCode?: string;
    dedupeKey?: string;
  }) {
    const tried = Array.from(
      new Set([...(opts.triedChannelIds || []), opts.channelId].filter(Boolean)),
    );
    const priority = opts.priority || MessagePriority.NORMAL;

    // JPUSH：把 Registration ID 写入 toAddress，便于设备历史筛选
    let toAddress = opts.to || undefined;
    let pushExtra: Record<string, unknown> | undefined = opts.extra
      ? { ...opts.extra }
      : undefined;
    if (opts.kind === 'push' && opts.channelType === ChannelType.JPUSH) {
      try {
        const ch = await this.prisma.channel.findUnique({
          where: { id: opts.channelId },
        });
        const cfg = (ch?.config || {}) as Record<string, unknown>;
        const ridFromExtra =
          typeof pushExtra?.registrationId === 'string'
            ? String(pushExtra.registrationId).trim()
            : '';
        const ridFromCfg =
          typeof cfg.registrationId === 'string'
            ? String(cfg.registrationId).trim()
            : '';
        const rid = ridFromExtra || ridFromCfg;
        if (rid) {
          toAddress = toAddress || rid.split(/[,;\s]+/).filter(Boolean)[0] || rid;
          pushExtra = { ...(pushExtra || {}), registrationId: rid };
        }
      } catch {
        /* ignore */
      }
    }

    const log = await this.prisma.messageLog.create({
      data: {
        projectId: opts.projectId,
        channelId: opts.channelId,
        channelType: opts.channelType,
        source: opts.source,
        status: MessageStatus.PENDING,
        priority,
        title: opts.title,
        content: opts.content || opts.html,
        payload: {
          title: opts.title,
          content: opts.content,
          html: opts.html,
          to: toAddress,
          extra: pushExtra || opts.extra,
          // 异步队列失败兜底时用
          _failover: {
            triedChannelIds: tried,
            kind: opts.kind,
          },
        } as any,
        toAddress: toAddress,
        templateCode: opts.templateCode,
        eventCode: opts.eventCode,
        dedupeKey: opts.dedupeKey,
        attempts: 0,
        parentId: opts.parentId,
      },
    });

    // 推送携带 messageId + readToken，供客户端点击回执
    const enrichedExtra =
      opts.kind === 'push'
        ? this.buildReadExtra(log.id, pushExtra || opts.extra)
        : opts.extra;
    const payload = {
      title: opts.title,
      content: opts.content,
      html: opts.html,
      to: toAddress,
      extra: enrichedExtra,
    };
    // 回写 payload.extra，便于审计
    if (opts.kind === 'push') {
      await this.prisma.messageLog.update({
        where: { id: log.id },
        data: {
          payload: {
            ...payload,
            _failover: {
              triedChannelIds: tried,
              kind: opts.kind,
            },
          } as any,
        },
      });
    }

    await this.publishLog(log.id);

    const useAsync = this.asyncEnabled && !opts.forceSync;

    if (useAsync) {
      try {
        await this.sendQueue.add(
          opts.kind,
          {
            messageId: log.id,
            kind: opts.kind,
            projectId: opts.projectId,
            channelId: opts.channelId,
            channelType: opts.channelType,
            payload: {
              ...payload,
              _failover: {
                triedChannelIds: tried,
                kind: opts.kind,
              },
            },
          },
          {
            attempts: this.maxAttempts,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
            priority:
              priority === MessagePriority.CRITICAL
                ? 1
                : priority === MessagePriority.HIGH
                  ? 2
                  : priority === MessagePriority.LOW
                    ? 10
                    : 5,
          },
        );
        return {
          messageId: log.id,
          status: MessageStatus.PENDING,
          success: true,
          queued: true,
          channelId: opts.channelId,
          channelType: opts.channelType,
        };
      } catch (e: any) {
        this.logger.warn(`队列不可用，降级同步发送: ${e?.message || e}`);
      }
    }

    const channel = await this.prisma.channel.findUnique({ where: { id: opts.channelId } });
    if (!channel) throw new NotFoundException('渠道不存在');
    const adapter = this.adapters.get(channel.type);
    const config = (channel.config || {}) as Record<string, unknown>;
    const started = Date.now();
    const result = await adapter.send(config, payload);
    const durationMs = Date.now() - started;
    const attemptDetail = this.appendAttempt(null, {
      n: 1,
      at: new Date().toISOString(),
      status: result.success ? 'SUCCESS' : 'FAILED',
      error: result.success ? null : sanitizeErrorMessage(result.errorMessage),
      durationMs,
    });
    const updated = await this.prisma.messageLog.update({
      where: { id: log.id },
      data: {
        status: result.success ? MessageStatus.SUCCESS : MessageStatus.FAILED,
        response: result.response as any,
        errorMessage: sanitizeErrorMessage(result.errorMessage),
        durationMs,
        attempts: 1,
        attemptDetail: attemptDetail as any,
        nextRetryAt: null,
      },
    });
    await this.publishLog(updated.id);

    if (result.success && opts.kind === 'push' && opts.source !== MessageSource.BACKUP_ALERT) {
      await this.scheduleUnreadEmailFallback({
        projectId: opts.projectId,
        messageId: updated.id,
        title: opts.title,
        content: opts.content,
        html: opts.html,
      });
    }

    if (!result.success && opts.source !== MessageSource.BACKUP_ALERT) {
      // 1) 先尝试其它已启用渠道重发原消息
      if (!opts.skipFailover && opts.kind === 'push') {
        const failover = await this.tryFailoverChannels({
          projectId: opts.projectId,
          source: opts.source,
          title: opts.title,
          content: opts.content,
          html: opts.html,
          to: opts.to,
          extra: opts.extra,
          templateCode: opts.templateCode,
          parentId: updated.id,
          triedChannelIds: tried,
        });
        if (failover) {
          return {
            ...failover,
            failedPrimaryMessageId: updated.id,
            failedPrimaryError: sanitizeErrorMessage(result.errorMessage),
          };
        }
      }
      // 2) 再发「失败告警」到备用渠道（内容为告警文案，不是原消息）
      await this.triggerBackupAlert(
        opts.projectId,
        {
          id: updated.id,
          title: updated.title,
          channelType: updated.channelType,
          channelId: updated.channelId,
          errorMessage: updated.errorMessage,
          toAddress: updated.toAddress,
          source: updated.source,
        },
        result.errorMessage,
        opts.kind,
      );
      if (opts.kind === 'email' || updated.channelType === ChannelType.SMTP) {
        await this.emailPolicy.maybeAutoSuppress(
          opts.projectId,
          updated.toAddress,
          result.errorMessage,
        );
      }
      await this.checkFailRateAlert(opts.projectId);
    }

    return {
      messageId: updated.id,
      status: updated.status,
      success: result.success,
      errorMessage: sanitizeErrorMessage(result.errorMessage),
      queued: false,
      channelId: opts.channelId,
      channelType: opts.channelType,
    };
  }

  /**
   * 主渠道失败后，按「备用优先 → 默认 → 其它启用」顺序重发原消息。
   * 成功返回兜底结果；全部失败返回 null。
   */
  async tryFailoverChannels(opts: {
    projectId: string;
    source: MessageSource;
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    extra?: Record<string, unknown>;
    templateCode?: string;
    parentId: string;
    triedChannelIds: string[];
  }) {
    try {
      const candidates = await this.channels.listFailoverChannels(
        opts.projectId,
        opts.triedChannelIds,
      );
      if (!candidates.length) return null;

      for (const ch of candidates) {
        this.logger.log(
          `failover try project=${opts.projectId} parent=${opts.parentId} channel=${ch.id}/${ch.type}`,
        );
        const r = await this.enqueueOrSend({
          kind: 'push',
          projectId: opts.projectId,
          channelId: ch.id,
          channelType: ch.type,
          source: opts.source,
          title: opts.title,
          content: opts.content,
          html: opts.html,
          to: opts.to,
          extra: {
            ...(opts.extra || {}),
            failoverFrom: opts.parentId,
            failoverTried: opts.triedChannelIds,
          },
          templateCode: opts.templateCode,
          forceSync: true,
          parentId: opts.parentId,
          triedChannelIds: [...opts.triedChannelIds, ch.id],
          skipFailover: true, // 单渠道失败时由本循环继续，避免递归扇出
        });
        opts.triedChannelIds = [...opts.triedChannelIds, ch.id];
        if (r.success || r.status === MessageStatus.PENDING || r.status === MessageStatus.SUCCESS) {
          this.logger.log(
            `failover success parent=${opts.parentId} via channel=${ch.id} message=${r.messageId}`,
          );
          return { ...r, failover: true, failoverChannelId: ch.id };
        }
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`failover failed: ${e?.message || e}`);
      return null;
    }
  }

  /** 发送失败 → 备用渠道告警（告警文案，不是原消息转发） */
  async triggerBackupAlert(
    projectId: string | null | undefined,
    failedLog: {
      id: string;
      title?: string | null;
      channelType?: ChannelType | null;
      channelId?: string | null;
      errorMessage?: string | null;
      toAddress?: string | null;
      source?: MessageSource | null;
    },
    errorMessage?: string | null,
    kind?: 'push' | 'email',
  ) {
    if (!projectId) return;
    try {
      const skip = await this.emailPolicy.shouldSkipBackupAlert(projectId, {
        toAddress: failedLog.toAddress,
        errorMessage: errorMessage || failedLog.errorMessage,
      });
      if (skip) {
        this.logger.log(`backup alert cooled-down skip message=${failedLog.id}`);
        return;
      }

      // exclude 参数为渠道 ID，而非消息 ID
      const backup = await this.channels.resolveBackupChannel(
        projectId,
        failedLog.channelId || undefined,
      );
      if (!backup) return;
      if (backup.type === ChannelType.SMTP) return; // 备用告警走即时推送渠道

      const isEmail = kind === 'email' || failedLog.channelType === ChannelType.SMTP;
      const title = isEmail
        ? `【邮件发送失败】${failedLog.title || '邮件'}`
        : `【发送失败告警】${failedLog.title || '消息'}`;
      const content = [
        `原消息 ID: ${failedLog.id}`,
        `原渠道: ${failedLog.channelType || '-'}`,
        failedLog.toAddress ? `收件人: ${failedLog.toAddress}` : null,
        failedLog.title ? `主题: ${failedLog.title}` : null,
        failedLog.source ? `来源: ${failedLog.source}` : null,
        isEmail ? '类型: email' : kind ? `类型: ${kind}` : null,
        `错误: ${errorMessage || failedLog.errorMessage || '未知错误'}`,
        `时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      ]
        .filter(Boolean)
        .join('\n');

      await this.enqueueOrSend({
        kind: 'push',
        projectId,
        channelId: backup.id,
        channelType: backup.type,
        source: MessageSource.BACKUP_ALERT,
        title,
        content,
        forceSync: true,
        parentId: failedLog.id,
      });
      this.logger.log(`backup alert sent for message=${failedLog.id} via channel=${backup.id}`);
    } catch (e: any) {
      this.logger.warn(`backup alert failed: ${e?.message || e}`);
    }
  }

  /**
   * 失败率阈值告警：窗口内失败率 >= 阈值时，通过备用渠道发送汇总告警
   */
  async checkFailRateAlert(projectId: string | null | undefined) {
    if (!projectId) return;
    try {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return;
      const threshold = project.alertFailRatePct;
      if (threshold == null || threshold <= 0) return;

      const windowMin = project.alertWindowMin || 60;
      const since = new Date(Date.now() - windowMin * 60 * 1000);

      if (project.lastFailAlertAt && project.lastFailAlertAt > since) {
        return; // 窗口内已告警过
      }

      const [total, failed] = await Promise.all([
        this.prisma.messageLog.count({
          where: {
            projectId,
            createdAt: { gte: since },
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
        this.prisma.messageLog.count({
          where: {
            projectId,
            createdAt: { gte: since },
            status: MessageStatus.FAILED,
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
      ]);

      if (total <= 0) return;
      const rate = (failed / total) * 100;
      if (rate < threshold) return;

      const backup = await this.channels.resolveBackupChannel(projectId);
      if (!backup || backup.type === ChannelType.SMTP) {
        this.logger.warn(
          `fail-rate alert skipped: no backup channel for project=${projectId} rate=${rate.toFixed(1)}%`,
        );
        // 仍更新时间戳避免刷日志
        await this.prisma.project.update({
          where: { id: projectId },
          data: { lastFailAlertAt: new Date() },
        });
        return;
      }

      const title = `【失败率告警】${project.name}`;
      const content = [
        `项目: ${project.name}`,
        `窗口: 近 ${windowMin} 分钟`,
        `失败率: ${rate.toFixed(1)}% (${failed}/${total})`,
        `阈值: ${threshold}%`,
        `时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      ].join('\n');

      await this.enqueueOrSend({
        kind: 'push',
        projectId,
        channelId: backup.id,
        channelType: backup.type,
        source: MessageSource.BACKUP_ALERT,
        title,
        content,
        forceSync: true,
      });

      await this.prisma.project.update({
        where: { id: projectId },
        data: { lastFailAlertAt: new Date() },
      });
      this.logger.log(
        `fail-rate alert sent project=${projectId} rate=${rate.toFixed(1)}% threshold=${threshold}`,
      );
    } catch (e: any) {
      this.logger.warn(`fail-rate alert failed: ${e?.message || e}`);
    }
  }

  /**
   * 项目级推送：
   * 1) 始终站内入库 + SSE 弹窗
   * 2) 外发渠道完全由本项目绑定配置决定（忽略调用方 channel 选择）
   * 3) 外发按 priority 依次尝试，失败熔断切下一个
   *
   * 管理端显式指定 channelId 时仍按指定渠道发送（后台测试/手动发送）。
   */
  async sendPush(opts: {
    projectId: string;
    source: MessageSource;
    channelId?: string;
    channelType?: ChannelType;
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    extra?: Record<string, unknown>;
    forceSync?: boolean;
    parentId?: string;
    pushTemplate?: string;
    variables?: Record<string, unknown>;
    /** true=接入方调用：忽略 channel 选择，走项目策略 */
    projectDispatch?: boolean;
    priority?: MessagePriority | string;
    eventCode?: string;
    dedupeKey?: string;
    /** 静默补发时跳过再次静默 */
    forceImmediate?: boolean;
  }) {
    let title = opts.title;
    let content = opts.content;
    let templateCode: string | undefined;
    const priority = this.quietHours.parsePriority(
      typeof opts.priority === 'string' ? opts.priority : opts.priority || 'normal',
    );

    if (opts.pushTemplate) {
      const rendered = await this.pushTemplates.renderForSend(
        opts.projectId,
        opts.pushTemplate,
        opts.variables || {},
      );
      title = rendered.title || title;
      content = rendered.content || content;
      templateCode = rendered.code;
      // 调用方显式传 variables 时校验声明必填变量
      if (opts.variables && Object.keys(opts.variables).length > 0) {
        const declared =
          Array.isArray(rendered.variables) && rendered.variables.length
            ? (rendered.variables as string[])
            : extractTemplateVars(rendered.titleTpl, rendered.contentTpl);
        const missing = missingTemplateVars(declared, opts.variables);
        if (missing.length) {
          throw new BadRequestException(`推送模板缺少变量: ${missing.join(', ')}`);
        }
      }
    }

    const extra = opts.variables
      ? { ...(opts.extra || {}), variables: opts.variables }
      : opts.extra;

    // 开放 API / 入站 Webhook / 未指定渠道：项目策略派发
    const useProjectDispatch =
      opts.projectDispatch ||
      (!opts.channelId && !opts.channelType);

    if (useProjectDispatch) {
      return this.dispatchByProject({
        projectId: opts.projectId,
        source: opts.source,
        title,
        content,
        html: opts.html,
        to: opts.to,
        extra,
        templateCode,
        forceSync: opts.forceSync,
        parentId: opts.parentId,
        priority,
        eventCode: opts.eventCode,
        dedupeKey: opts.dedupeKey,
        forceImmediate: opts.forceImmediate,
      });
    }

    // 管理端显式指定渠道
    const channel = await this.channels.resolveChannel(opts.projectId, {
      channelId: opts.channelId,
      channelType: opts.channelType,
    });

    if (channel.type === ChannelType.SMTP) {
      throw new BadRequestException('邮件请使用 /email/send 接口');
    }

    if (channel.type === ChannelType.INBOX) {
      return this.receiveInbox({
        projectId: opts.projectId,
        source: opts.source,
        title,
        content,
        html: opts.html,
        extra,
        templateCode,
        parentId: opts.parentId,
      });
    }

    return this.enqueueOrSend({
      kind: 'push',
      projectId: opts.projectId,
      channelId: channel.id,
      channelType: channel.type,
      source: opts.source,
      title,
      content,
      html: opts.html,
      to: opts.to,
      extra,
      templateCode,
      forceSync: opts.forceSync,
      parentId: opts.parentId,
      priority,
      eventCode: opts.eventCode,
      dedupeKey: opts.dedupeKey,
    });
  }

  /**
   * 接入方统一入口策略：
   * 1) 静默时段 + low/normal → 站内 + 早晨补发
   * 2) 外发推送渠道（非 SMTP/INBOX）按 priority 熔断
   * 3) 无外发或全失败 → 管理员邮箱 SMTP（项目邮箱 → 全局邮箱）
   * 4) 再不行 → 站内通知（保证后台可见）
   */
  async dispatchByProject(opts: {
    projectId: string;
    source: MessageSource;
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    extra?: Record<string, unknown>;
    templateCode?: string;
    forceSync?: boolean;
    parentId?: string;
    priority?: MessagePriority;
    eventCode?: string;
    dedupeKey?: string;
    forceImmediate?: boolean;
  }) {
    if (!opts.title && !opts.content && !opts.html) {
      throw new BadRequestException('请提供 title 或 content');
    }

    const priority = opts.priority || MessagePriority.NORMAL;
    const project = await this.prisma.project.findUnique({
      where: { id: opts.projectId },
    });
    if (!project) throw new NotFoundException('项目不存在');

    if (
      !opts.forceImmediate &&
      this.quietHours.shouldHold(project, priority)
    ) {
      const releaseAt = this.quietHours.nextQuietEnd(project);
      const inbox = await this.receiveInbox({
        projectId: opts.projectId,
        source: opts.source,
        title: opts.title,
        content: opts.content,
        html: opts.html,
        extra: {
          ...(opts.extra || {}),
          quietHold: true,
          priority,
          releaseAt: releaseAt.toISOString(),
        },
        templateCode: opts.templateCode,
        parentId: opts.parentId,
        priority,
        eventCode: opts.eventCode,
        dedupeKey: opts.dedupeKey,
        status: MessageStatus.DELAYED,
      });
      await this.prisma.scheduledMessage.create({
        data: {
          projectId: opts.projectId,
          kind: 'push',
          title: opts.title || null,
          content: opts.content || null,
          html: opts.html || null,
          templateCode: opts.templateCode || null,
          variables: {
            quietRelease: true,
            forceImmediate: true,
            priority,
            eventCode: opts.eventCode,
            extra: opts.extra || {},
            inboxMessageId: inbox.messageId,
          } as any,
          runAt: releaseAt,
          status: 'PENDING',
          messageId: inbox.messageId,
        },
      });
      return {
        ...inbox,
        delayed: true,
        releaseAt: releaseAt.toISOString(),
        dispatch: {
          inboxOnly: true,
          quietHold: true,
          releaseAt: releaseAt.toISOString(),
          priority,
        },
      };
    }

    const externals = await this.channels.listDispatchChannels(opts.projectId);
    const tried: string[] = [];
    let externalResult: any = null;

    for (const ch of externals) {
      this.logger.log(
        `project-dispatch try project=${opts.projectId} channel=${ch.id}/${ch.type}`,
      );
      const r = await this.enqueueOrSend({
        kind: 'push',
        projectId: opts.projectId,
        channelId: ch.id,
        channelType: ch.type,
        source: opts.source,
        title: opts.title,
        content: opts.content,
        html: opts.html,
        to: opts.to,
        extra: {
          ...(opts.extra || {}),
          projectDispatch: true,
        },
        templateCode: opts.templateCode,
        forceSync: opts.forceSync ?? true,
        parentId: opts.parentId,
        triedChannelIds: tried,
        skipFailover: true,
        priority,
        eventCode: opts.eventCode,
        dedupeKey: opts.dedupeKey,
      });
      tried.push(ch.id);
      if (r.success || r.status === MessageStatus.PENDING || r.status === MessageStatus.SUCCESS) {
        externalResult = { ...r, failover: tried.length > 1, triedChannelIds: [...tried] };
        break;
      }
    }

    if (externalResult) {
      return {
        messageId: externalResult.messageId,
        status: externalResult.status,
        success: true,
        queued: !!externalResult.queued,
        channelId: externalResult.channelId,
        channelType: externalResult.channelType,
        inboxOnly: false,
        external: externalResult,
        dispatch: {
          inboxOnly: false,
          externalTried: tried.length,
          externalSuccess: true,
          emailTried: false,
          externalMessageId: externalResult.messageId,
          externalChannelId: externalResult.channelId,
          triedChannelIds: tried,
        },
      };
    }

    // ② 邮件兜底：项目管理员邮箱 → 全局管理员邮箱
    let emailResult: any = null;
    let adminEmail: string | null = null;
    try {
      adminEmail = await this.projects.resolveAdminEmail(opts.projectId);
    } catch (e: any) {
      this.logger.warn(`resolveAdminEmail failed: ${e?.message || e}`);
    }
    if (adminEmail) {
      try {
        emailResult = await this.sendEmail({
          projectId: opts.projectId,
          source: opts.source,
          to: adminEmail,
          subject: opts.title || '通知',
          content: opts.content,
          html: opts.html,
          forceSync: true,
          parentId: opts.parentId,
        });
        if (
          emailResult?.success ||
          emailResult?.status === MessageStatus.PENDING ||
          emailResult?.status === MessageStatus.SUCCESS
        ) {
          return {
            messageId: emailResult.messageId,
            status: emailResult.status,
            success: true,
            queued: !!emailResult.queued,
            channelId: emailResult.channelId,
            channelType: emailResult.channelType,
            inboxOnly: false,
            email: emailResult,
            dispatch: {
              inboxOnly: false,
              externalTried: tried.length,
              externalSuccess: false,
              emailTried: true,
              emailSuccess: true,
              emailTo: adminEmail,
              triedChannelIds: tried,
            },
          };
        }
      } catch (e: any) {
        this.logger.warn(`admin email fallback failed: ${e?.message || e}`);
        emailResult = { success: false, errorMessage: e?.message || String(e) };
      }
    }

    // ③ 站内兜底
    const reason = !externals.length
      ? adminEmail
        ? 'no_external_email_failed_or_skipped'
        : 'no_external_no_admin_email'
      : 'external_all_failed';
    const inbox = await this.receiveInbox({
      projectId: opts.projectId,
      source: opts.source,
      title: opts.title,
      content: opts.content,
      html: opts.html,
      extra: {
        ...(opts.extra || {}),
        projectDispatch: true,
        reason,
        triedChannelIds: tried,
        adminEmail: adminEmail || undefined,
      },
      templateCode: opts.templateCode,
      parentId: opts.parentId,
    });
    if (externals.length) {
      await this.triggerBackupAlert(
        opts.projectId,
        {
          id: inbox.messageId,
          title: opts.title,
          channelType: null,
          errorMessage: '项目外发渠道全部失败，已回落站内/邮件',
        },
        '项目外发渠道全部失败，已回落站内/邮件',
      );
      await this.checkFailRateAlert(opts.projectId);
    }
    return {
      ...inbox,
      dispatch: {
        inboxOnly: true,
        externalTried: tried.length,
        externalSuccess: false,
        emailTried: !!adminEmail,
        emailSuccess: false,
        emailTo: adminEmail || undefined,
        triedChannelIds: tried,
        fallbackInbox: true,
      },
    };
  }

  /**
   * 仅入库（不走外部渠道），供后台 SSE/弹窗/发送记录展示。
   * 用于「未启用任何渠道」时的纯接收场景。
   */
  async receiveInbox(opts: {
    projectId: string;
    source: MessageSource;
    title?: string;
    content?: string;
    html?: string;
    extra?: Record<string, unknown>;
    templateCode?: string;
    parentId?: string;
    priority?: MessagePriority;
    eventCode?: string;
    dedupeKey?: string;
    status?: MessageStatus;
  }) {
    if (!opts.title && !opts.content && !opts.html) {
      throw new BadRequestException('请提供 title 或 content');
    }
    const payload = {
      title: opts.title,
      content: opts.content,
      html: opts.html,
      extra: opts.extra,
      inboxOnly: true,
    };
    const log = await this.prisma.messageLog.create({
      data: {
        projectId: opts.projectId,
        channelId: null,
        channelType: null,
        source: opts.source,
        status: opts.status || MessageStatus.SUCCESS,
        priority: opts.priority || MessagePriority.NORMAL,
        title: opts.title || '站内通知',
        content: opts.content || opts.html || '',
        payload: payload as any,
        templateCode: opts.templateCode,
        eventCode: opts.eventCode,
        dedupeKey: opts.dedupeKey,
        attempts: 0,
        durationMs: 0,
        parentId: opts.parentId,
      },
    });
    await this.publishLog(log.id);
    this.logger.log(`inbox received message=${log.id} project=${opts.projectId}`);
    return {
      messageId: log.id,
      status: log.status,
      success: true,
      queued: false,
      channelId: null as string | null,
      channelType: null as ChannelType | null,
      inboxOnly: true,
    };
  }

  async sendEmail(opts: {
    projectId: string;
    source: MessageSource;
    to: string;
    channelId?: string;
    template?: string;
    variables?: Record<string, unknown>;
    subject?: string;
    html?: string;
    content?: string;
    forceSync?: boolean;
    parentId?: string;
    priority?: MessagePriority | string;
    eventCode?: string;
    dedupeKey?: string;
  }) {
    if (!opts.to) throw new BadRequestException('缺少收件人 to');
    if (!isValidEmail(opts.to)) {
      throw new BadRequestException('收件人邮箱格式无效');
    }
    await this.emailPolicy.assertNotSuppressed(opts.projectId, opts.to);
    await this.emailPolicy.assertWithinDailyQuota(opts.projectId);

    let channel;
    try {
      channel = await this.channels.resolveChannel(opts.projectId, {
        channelId: opts.channelId,
        channelType: ChannelType.SMTP,
      });
    } catch (e: any) {
      // 未配置 / 未绑定 / 未启用 SMTP 时给出可操作提示
      if (
        e instanceof NotFoundException ||
        String(e?.message || '').includes('未启用') ||
        String(e?.message || '').includes('未绑定') ||
        String(e?.message || '').includes('没有可用')
      ) {
        throw new BadRequestException(
          '未配置或未启用邮件（SMTP）渠道：请先在消息通知平台「渠道管理」添加 SMTP 并全局启用，再在对应项目中绑定并启用后，方可使用 /api/email 发信',
        );
      }
      throw e;
    }

    if (channel.type !== ChannelType.SMTP) {
      throw new BadRequestException('指定渠道不是 SMTP');
    }

    let subject = opts.subject || '通知';
    let html = opts.html;
    let text = opts.content;
    let templateCode: string | undefined;
    let vars = { ...(opts.variables || {}) } as Record<string, unknown>;

    // 自动注入 unsubscribeUrl（密钥未配置时跳过，不阻断发信）
    if (!vars.unsubscribeUrl && opts.to) {
      try {
        const secret = resolveUnsubscribeSecret(
          this.config.get<string>('UNSUBSCRIBE_SECRET') ||
            this.config.get<string>('JWT_SECRET'),
          { allowDevFallback: true },
        );
        const publicBase = resolveSiteUrl();
        const token = signUnsubscribeToken(
          {
            email: opts.to.trim().toLowerCase(),
            projectId: opts.projectId,
            exp: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
          },
          secret,
        );
        if (publicBase) {
          vars.unsubscribeUrl = `${publicBase}/unsubscribe?token=${encodeURIComponent(token)}`;
        } else {
          vars.unsubscribeUrl = `/unsubscribe?token=${encodeURIComponent(token)}`;
        }
      } catch {
        /* 密钥未配置：不注入链接 */
      }
    }

    if (opts.template) {
      const tpl = await this.templates.resolve(opts.projectId, opts.template);
      const declared = Array.isArray(tpl.variables)
        ? (tpl.variables as string[])
        : extractTemplateVars(tpl.subject, tpl.htmlBody, tpl.textBody || undefined);
      // 仅当调用方显式传 variables 时校验：声明变量中的必填项（可选变量白名单放行）
      if (opts.variables && Object.keys(opts.variables).length > 0) {
        const missing = missingTemplateVars(declared, vars);
        if (missing.length) {
          throw new BadRequestException(`邮件模板缺少变量: ${missing.join(', ')}`);
        }
      }
      subject = this.templates.render(tpl.subject, vars);
      html = this.templates.render(tpl.htmlBody, vars);
      text = tpl.textBody ? this.templates.render(tpl.textBody, vars) : undefined;
      templateCode = tpl.code;
    }

    if (!html && !text) {
      throw new BadRequestException('请提供 template 或 html/content');
    }

    return this.enqueueOrSend({
      kind: 'email',
      projectId: opts.projectId,
      channelId: channel.id,
      channelType: channel.type,
      source: opts.source,
      title: subject,
      content: text,
      html,
      to: opts.to,
      extra: { variables: vars },
      templateCode,
      forceSync: opts.forceSync,
      parentId: opts.parentId,
      priority: this.quietHours.parsePriority(
        typeof opts.priority === 'string' ? opts.priority : opts.priority || 'normal',
      ),
      eventCode: opts.eventCode,
      dedupeKey: opts.dedupeKey,
    });
  }

  async adminSend(body: {
    projectId: string;
    channelId?: string;
    channelType?: ChannelType;
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    template?: string;
    pushTemplate?: string;
    variables?: Record<string, unknown>;
  }) {
    if (body.template || body.channelType === ChannelType.SMTP) {
      return this.sendEmail({
        projectId: body.projectId,
        source: MessageSource.ADMIN_SEND,
        to: body.to || '',
        channelId: body.channelId,
        template: body.template,
        variables: body.variables,
        subject: body.title,
        html: body.html,
        content: body.content,
        forceSync: true,
      });
    }
    return this.sendPush({
      projectId: body.projectId,
      source: MessageSource.ADMIN_SEND,
      channelId: body.channelId,
      channelType: body.channelType,
      title: body.title,
      content: body.content,
      html: body.html,
      to: body.to,
      pushTemplate: body.pushTemplate,
      variables: body.variables,
      forceSync: true,
    });
  }

  /** 重发：基于原消息 payload 再发一次 */
  async resend(id: string) {
    const original = await this.get(id);
    if (!original.projectId || !original.channelId) {
      throw new BadRequestException('原消息缺少项目或渠道，无法重发');
    }
    // 设备推送已读或已邮件兜底时不允许重发
    if (
      original.channelType === ChannelType.JPUSH ||
      original.channelType === ChannelType.BARK ||
      original.channelType === ChannelType.GOTIFY
    ) {
      if (original.readAt) {
        throw new BadRequestException('消息已读，无法重发');
      }
      if (this.parseEmailFallback(original.payload).used) {
        throw new BadRequestException('已使用邮箱兜底，无法重发');
      }
    }
    const payload = (original.payload || {}) as any;

    if (original.channelType === ChannelType.SMTP) {
      return this.sendEmail({
        projectId: original.projectId,
        source: MessageSource.RESEND,
        to: original.toAddress || payload.to || '',
        channelId: original.channelId,
        template: original.templateCode || undefined,
        variables: payload.extra?.variables,
        subject: original.title || payload.title,
        html: payload.html,
        content: payload.content || original.content || undefined,
        forceSync: true,
        parentId: original.id,
      });
    }

    return this.sendPush({
      projectId: original.projectId,
      source: MessageSource.RESEND,
      channelId: original.channelId,
      title: original.title || payload.title,
      content: payload.content || original.content || undefined,
      html: payload.html,
      to: original.toAddress || payload.to,
      extra: {
        ...((payload.extra as Record<string, unknown>) || {}),
        // 重推沿用原 RID
        registrationId:
          (payload.extra as any)?.registrationId ||
          original.toAddress ||
          undefined,
      },
      forceSync: true,
      parentId: original.id,
    });
  }

  /**
   * 批量重发失败消息。可传 ids，或按筛选条件（默认仅 SMTP 失败）。
   */
  async batchResend(opts: {
    ids?: string[];
    projectId?: string;
    toAddress?: string;
    onlySmtpFailed?: boolean;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const limit = Math.min(50, Math.max(1, Number(opts.limit) || 20));
    let targets: { id: string }[] = [];

    if (opts.ids?.length) {
      targets = opts.ids.slice(0, limit).map((id) => ({ id }));
    } else {
      const where = this.buildListWhere({
        projectId: opts.projectId,
        toAddress: opts.toAddress,
        from: opts.from,
        to: opts.to,
        onlySmtpFailed: opts.onlySmtpFailed !== false,
        status: opts.onlySmtpFailed === false ? MessageStatus.FAILED : undefined,
      });
      targets = await this.prisma.messageLog.findMany({
        where: {
          ...where,
          status: MessageStatus.FAILED,
          channelId: { not: null },
          projectId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true },
      });
    }

    const results: any[] = [];
    for (const t of targets) {
      try {
        const r = await this.resend(t.id);
        results.push({ id: t.id, success: !!r.success, result: r });
      } catch (e: any) {
        results.push({
          id: t.id,
          success: false,
          errorMessage: e?.message || String(e),
        });
      }
    }
    return {
      total: targets.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /** 批量发送到同一项目的多个渠道 / 同一内容多次 */
  async batchSend(body: {
    projectId: string;
    channelIds?: string[];
    channelTypes?: ChannelType[];
    title?: string;
    content?: string;
    html?: string;
    to?: string;
  }) {
    if (!body.projectId) throw new BadRequestException('缺少 projectId');
    const channelIds = new Set<string>(body.channelIds || []);

    if (body.channelTypes?.length) {
      for (const t of body.channelTypes) {
        try {
          const c = await this.channels.resolveChannel(body.projectId, { channelType: t });
          channelIds.add(c.id);
        } catch {
          // skip missing type
        }
      }
    }

    if (!channelIds.size) {
      // 全部已绑定启用渠道
      const bindings = await this.channels.listBindings(body.projectId);
      for (const b of bindings) {
        if (b.enabled && b.channel?.enabled) channelIds.add(b.channelId);
      }
    }

    if (!channelIds.size) throw new BadRequestException('没有可发送的渠道');

    const results: any[] = [];
    for (const channelId of channelIds) {
      try {
        const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) {
          results.push({ channelId, success: false, errorMessage: '渠道不存在' });
          continue;
        }
        if (channel.type === ChannelType.SMTP) {
          if (!body.to) {
            results.push({ channelId, success: false, errorMessage: 'SMTP 需要 to' });
            continue;
          }
          const r = await this.sendEmail({
            projectId: body.projectId,
            source: MessageSource.BATCH,
            to: body.to,
            channelId,
            subject: body.title,
            html: body.html,
            content: body.content,
            forceSync: true,
          });
          results.push(r);
        } else {
          const r = await this.sendPush({
            projectId: body.projectId,
            source: MessageSource.BATCH,
            channelId,
            title: body.title,
            content: body.content,
            html: body.html,
            forceSync: true,
          });
          results.push(r);
        }
      } catch (e: any) {
        results.push({ channelId, success: false, errorMessage: e?.message || '发送失败' });
      }
    }

    return {
      total: results.length,
      success: results.filter((r) => r.success !== false && r.status !== 'FAILED').length,
      failed: results.filter((r) => r.success === false || r.status === 'FAILED').length,
      results,
    };
  }

  async markRead(ids: string[]) {
    if (!ids?.length) return { updated: 0 };
    const result = await this.prisma.messageLog.updateMany({
      where: { id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    // 已读后取消未读邮件兜底
    await this.cancelUnreadEmailFallback(ids);
    for (const id of ids.slice(0, 50)) {
      await this.publishLog(id);
    }
    return { updated: result.count };
  }

  /** 公开接口：单条已读（token 已在 controller 校验） */
  async markReadPublic(messageId: string) {
    const m = await this.prisma.messageLog.findUnique({ where: { id: messageId } });
    if (!m) throw new NotFoundException('消息不存在');
    if (m.readAt) {
      return { updated: 0, alreadyRead: true, messageId, readAt: m.readAt };
    }
    const updated = await this.prisma.messageLog.update({
      where: { id: messageId },
      data: { readAt: new Date() },
    });
    await this.cancelUnreadEmailFallback([messageId]);
    await this.publishLog(messageId);
    return {
      updated: 1,
      alreadyRead: false,
      messageId,
      readAt: updated.readAt,
    };
  }

  /** 推送成功后：若项目开启未读邮件兜底，则定时检查 */
  async scheduleUnreadEmailFallback(opts: {
    projectId: string;
    messageId: string;
    title?: string;
    content?: string;
    html?: string;
  }) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: opts.projectId },
      });
      if (!project?.unreadEmailFallbackEnabled) return;
      // 已读或已邮件兜底：不再创建兜底任务
      const src = await this.prisma.messageLog.findUnique({
        where: { id: opts.messageId },
        select: { readAt: true, payload: true },
      });
      if (src?.readAt || this.parseEmailFallback(src?.payload).used) return;
      // 字段名保留 Hours 兼容历史 API，语义为分钟
      const minutes = Math.max(1, Math.min(43200, Number(project.unreadEmailFallbackHours) || 24));
      const runAt = new Date(Date.now() + minutes * 60 * 1000);
      // 同一消息仅保留一条待执行兜底任务
      const existing = await this.prisma.scheduledMessage.findFirst({
        where: {
          projectId: opts.projectId,
          kind: 'unread_email_fallback',
          status: 'PENDING',
          messageId: opts.messageId,
        },
      });
      if (existing) return;
      await this.prisma.scheduledMessage.create({
        data: {
          projectId: opts.projectId,
          kind: 'unread_email_fallback',
          title: opts.title || null,
          content: opts.content || null,
          html: opts.html || null,
          templateCode: project.unreadEmailTemplateCode || null,
          variables: {
            sourceMessageId: opts.messageId,
            unreadEmailFallback: true,
            minutes,
            scheduledAt: new Date().toISOString(),
            runAt: runAt.toISOString(),
          } as any,
          runAt,
          status: 'PENDING',
          messageId: opts.messageId,
        },
      });
      this.logger.log(
        `unread-email-fallback scheduled message=${opts.messageId} runAt=${runAt.toISOString()} minutes=${minutes}`,
      );
    } catch (e: any) {
      this.logger.warn(`schedule unread email fallback failed: ${e?.message || e}`);
    }
  }

  async cancelUnreadEmailFallback(messageIds: string[]) {
    if (!messageIds?.length) return { cancelled: 0 };
    const result = await this.prisma.scheduledMessage.updateMany({
      where: {
        kind: 'unread_email_fallback',
        status: 'PENDING',
        messageId: { in: messageIds },
      },
      data: { status: 'CANCELLED', lastError: 'message_read' },
    });
    return { cancelled: result.count };
  }

  /** 从 payload 解析是否已走邮箱兜底 */
  private parseEmailFallback(payload: unknown): {
    used: boolean;
    at?: string | null;
    to?: string | null;
    emailMessageId?: string | null;
  } {
    const p = (payload || {}) as any;
    const fb = p?.emailFallback;
    if (fb && typeof fb === 'object') {
      return {
        used: true,
        at: typeof fb.at === 'string' ? fb.at : null,
        to: typeof fb.to === 'string' ? fb.to : null,
        emailMessageId:
          typeof fb.emailMessageId === 'string' ? fb.emailMessageId : null,
      };
    }
    return { used: false };
  }

  /** 定时触发：未读则按项目模板发管理员邮件；成功后原消息标已读（邮箱兜底已读） */
  async executeUnreadEmailFallback(item: {
    id: string;
    projectId: string;
    messageId: string | null;
    title: string | null;
    content: string | null;
    html: string | null;
    templateCode: string | null;
    variables: unknown;
  }) {
    const vars = (item.variables || {}) as Record<string, unknown>;
    const sourceId =
      (typeof vars.sourceMessageId === 'string' && vars.sourceMessageId) ||
      item.messageId;
    if (!sourceId) {
      return { success: false, errorMessage: '缺少 sourceMessageId' };
    }
    const src = await this.prisma.messageLog.findUnique({ where: { id: sourceId } });
    if (!src) {
      return { success: true, skipped: true, reason: 'source_missing' };
    }
    if (src.readAt) {
      return { success: true, skipped: true, reason: 'already_read' };
    }
    const alreadyFb = this.parseEmailFallback(src.payload);
    if (alreadyFb.used) {
      // 已兜底过：补标已读，禁止再发
      if (!src.readAt) {
        await this.prisma.messageLog.update({
          where: { id: sourceId },
          data: { readAt: new Date() },
        });
        await this.cancelUnreadEmailFallback([sourceId]);
      }
      return { success: true, skipped: true, reason: 'already_email_fallback' };
    }
    // 仅对非 SMTP 的成功/延迟消息兜底
    if (src.channelType === ChannelType.SMTP) {
      return { success: true, skipped: true, reason: 'smtp_source' };
    }

    const project = await this.prisma.project.findUnique({
      where: { id: item.projectId },
    });
    if (!project?.unreadEmailFallbackEnabled) {
      return { success: true, skipped: true, reason: 'disabled' };
    }

    const adminEmail = await this.projects.resolveAdminEmail(item.projectId);
    if (!adminEmail) {
      return { success: false, errorMessage: '未配置管理员邮箱，无法邮件兜底' };
    }

    const template =
      item.templateCode || project.unreadEmailTemplateCode || undefined;
    const title = item.title || src.title || '未读通知提醒';
    const content =
      item.content ||
      src.content ||
      `您有一条通知超过等待时间仍未查看：${title}`;
    const html = item.html || undefined;

    const viewUrl =
      (typeof vars.viewUrl === 'string' && vars.viewUrl) ||
      resolveSiteUrl() ||
      '';
    const result = await this.sendEmail({
      projectId: item.projectId,
      source: MessageSource.ADMIN_SEND,
      to: adminEmail,
      template,
      variables: {
        title,
        content,
        body: content,
        messageId: sourceId,
        sourceMessageId: sourceId,
        appName: project.name,
        projectName: project.name,
        siteName: project.name,
        viewUrl,
        actionUrl: viewUrl,
      },
      subject: `【未读提醒】${title}`,
      content: template ? undefined : content,
      html: template ? undefined : html,
      forceSync: true,
      parentId: sourceId,
      eventCode: src.eventCode || undefined,
    });

    const ok =
      result?.success !== false && result?.status !== MessageStatus.FAILED;
    if (ok) {
      // 邮件兜底成功视为已通过邮箱阅读，标记已读并终止后续重发/兜底
      const now = new Date();
      const prevPayload = (src.payload || {}) as Record<string, unknown>;
      await this.prisma.messageLog.update({
        where: { id: sourceId },
        data: {
          readAt: now,
          payload: {
            ...prevPayload,
            emailFallback: {
              at: now.toISOString(),
              to: adminEmail,
              emailMessageId: result?.messageId || null,
              via: 'unread_email_fallback',
            },
          } as any,
        },
      });
      await this.cancelUnreadEmailFallback([sourceId]);
      await this.publishLog(sourceId);
      this.logger.log(
        `unread-email-fallback done source=${sourceId} email=${result?.messageId} to=${adminEmail}`,
      );
    }

    return {
      success: ok,
      messageId: result?.messageId,
      status: result?.status,
      errorMessage: result?.errorMessage,
      emailTo: adminEmail,
      sourceMarkedRead: ok,
    };
  }

  async archive(ids: string[], archived = true) {
    if (!ids?.length) return { updated: 0 };
    const result = await this.prisma.messageLog.updateMany({
      where: { id: { in: ids } },
      data: { archivedAt: archived ? new Date() : null },
    });
    return { updated: result.count };
  }

  async cleanup(opts: {
    before?: string;
    projectId?: string;
    onlyInbox?: boolean;
    onlyArchived?: boolean;
  }) {
    const where: Prisma.MessageLogWhereInput = {};
    if (opts.projectId) where.projectId = opts.projectId;
    if (opts.before) {
      const d = new Date(opts.before);
      if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d };
    }
    if (opts.onlyInbox) {
      where.channelId = null;
    }
    if (opts.onlyArchived) {
      where.archivedAt = { not: null };
    }
    if (!opts.before && !opts.onlyArchived) {
      throw new BadRequestException('请提供 before 或 onlyArchived');
    }
    const result = await this.prisma.messageLog.deleteMany({ where });
    return { deleted: result.count };
  }

  /**
   * 设备推送历史（按 Registration ID 筛选，主要用于 JPUSH / 棱镜浏览器）
   */
  async listDevicePushHistory(opts: {
    registrationId?: string;
    projectId?: string;
    unreadOnly?: boolean;
    page?: number;
    pageSize?: number;
    q?: string;
  }) {
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20));
    const rid = (opts.registrationId || '').trim();

    const where: Prisma.MessageLogWhereInput = {
      channelType: ChannelType.JPUSH,
      source: { not: MessageSource.BACKUP_ALERT },
    };
    if (opts.projectId) where.projectId = opts.projectId;
    if (opts.unreadOnly) where.readAt = null;
    if (rid) {
      where.toAddress = { contains: rid, mode: 'insensitive' };
    }
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as any[]) : where.AND ? [where.AND] : []),
        {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { content: { contains: q, mode: 'insensitive' } },
            { id: { contains: q } },
            { toAddress: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.messageLog.count({ where }),
      this.prisma.messageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true, config: true } },
        },
      }),
    ]);

    const mapped = items.map((m) => {
      const payload = (m.payload || {}) as any;
      const extra = (payload.extra || {}) as Record<string, unknown>;
      const cfg = (m.channel?.config || {}) as Record<string, unknown>;
      const registrationId =
        (typeof extra.registrationId === 'string' && extra.registrationId) ||
        m.toAddress ||
        (typeof cfg.registrationId === 'string' && cfg.registrationId) ||
        null;
      const fb = this.parseEmailFallback(payload);
      const unread = !m.readAt && !fb.used;
      // click | email_fallback | null
      let readVia: 'click' | 'email_fallback' | null = null;
      if (fb.used) readVia = 'email_fallback';
      else if (m.readAt) readVia = 'click';
      return {
        id: m.id,
        projectId: m.projectId,
        project: m.project,
        channelId: m.channelId,
        channel: m.channel
          ? { id: m.channel.id, name: m.channel.name, type: m.channel.type }
          : null,
        channelType: m.channelType,
        source: m.source,
        status: m.status,
        title: m.title,
        content: m.content,
        registrationId,
        readAt: m.readAt || (fb.at ? new Date(fb.at) : null),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        errorMessage: m.errorMessage,
        attempts: m.attempts,
        durationMs: m.durationMs,
        unread,
        readVia,
        emailFallback: fb.used,
        emailFallbackAt: fb.at || null,
        emailFallbackTo: fb.to || null,
        // 仅真正未读才允许重发
        canResend: unread,
        fallbackPending: false as boolean,
      };
    });

    // 标注是否仍有未读邮件兜底任务（仅真正未读）
    const unreadIds = mapped.filter((m) => m.unread).map((m) => m.id);
    if (unreadIds.length) {
      const pending = await this.prisma.scheduledMessage.findMany({
        where: {
          kind: 'unread_email_fallback',
          status: 'PENDING',
          messageId: { in: unreadIds },
        },
        select: { messageId: true, runAt: true },
      });
      const map = new Map(pending.map((p) => [p.messageId, p.runAt]));
      for (const row of mapped) {
        if (map.has(row.id)) {
          (row as any).fallbackPending = true;
          (row as any).fallbackRunAt = map.get(row.id);
        }
      }
    }

    // 汇总：已知 RID 列表（来自 JPUSH 渠道配置 + 历史 toAddress）
    const channels = await this.prisma.channel.findMany({
      where: { type: ChannelType.JPUSH, enabled: true },
      select: { id: true, name: true, config: true },
    });
    const knownRids: { registrationId: string; channelName: string; channelId: string }[] = [];
    for (const c of channels) {
      const cfg = (c.config || {}) as Record<string, unknown>;
      const raw = typeof cfg.registrationId === 'string' ? cfg.registrationId : '';
      for (const part of raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)) {
        knownRids.push({
          registrationId: part,
          channelName: c.name,
          channelId: c.id,
        });
      }
    }

    return {
      items: mapped,
      total,
      page,
      pageSize,
      knownRegistrationIds: knownRids,
    };
  }

  /** 未读重推：仅对未读 JPUSH 消息再发一次；已读或已邮件兜底时拒绝 */
  async resendUnreadPush(messageId: string) {
    const m = await this.prisma.messageLog.findUnique({ where: { id: messageId } });
    if (!m) throw new NotFoundException('消息不存在');
    if (m.readAt) throw new BadRequestException('消息已读，无法重发');
    if (this.parseEmailFallback(m.payload).used) {
      throw new BadRequestException('已使用邮箱兜底，无法重发');
    }
    if (m.channelType !== ChannelType.JPUSH) {
      throw new BadRequestException('仅支持 JPUSH 设备消息重推');
    }
    return this.resend(messageId);
  }

  async recipientTimeline(opts: {
    address: string;
    projectId?: string;
    limit?: number;
  }) {
    const address = (opts.address || '').trim();
    if (!address) throw new BadRequestException('缺少 address');
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));
    const where: Prisma.MessageLogWhereInput = {
      toAddress: { equals: address, mode: 'insensitive' },
    };
    if (opts.projectId) where.projectId = opts.projectId;
    const [messages, suppresses] = await Promise.all([
      this.prisma.messageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.emailSuppress.findMany({
        where: {
          address: { equals: address, mode: 'insensitive' },
          ...(opts.projectId
            ? { OR: [{ projectId: opts.projectId }, { projectId: null }] }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { address, messages, suppresses };
  }

  async simulateSend(
    projectId: string,
    body: { title?: string; content?: string; channelIds?: string[] },
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    const bindings = await this.channels.listBindings(projectId);
    let targets = bindings.filter((b: any) => b.enabled && b.channel?.enabled);
    if (body.channelIds?.length) {
      const set = new Set(body.channelIds);
      targets = targets.filter((b: any) => set.has(b.channelId));
    }
    const title = body.title || '【模拟发送】连通性测试';
    const content = body.content || `项目 ${project.name} 模拟发送 ${new Date().toLocaleString('zh-CN')}`;
    const results: any[] = [];
    for (const b of targets) {
      const ch = b.channel;
      if (!ch) continue;
      if (ch.type === ChannelType.INBOX) {
        results.push({
          channelId: ch.id,
          type: ch.type,
          name: ch.name,
          ok: true,
          ms: 0,
          skipped: true,
          error: null,
        });
        continue;
      }
      if (ch.type === ChannelType.SMTP) {
        const cfg = (ch.config || {}) as any;
        if (!cfg.testTo && !project.adminEmail) {
          results.push({
            channelId: ch.id,
            type: ch.type,
            name: ch.name,
            ok: false,
            ms: 0,
            error: 'SMTP 无 testTo/管理员邮箱，跳过真实发送',
          });
          continue;
        }
      }
      const started = Date.now();
      try {
        const adapter = this.adapters.get(ch.type as ChannelType);
        const cfg = (ch.config || {}) as Record<string, unknown>;
        // SMTP test 走 adapter.test；其它也用 test
        const r = await adapter.test(cfg);
        results.push({
          channelId: ch.id,
          type: ch.type,
          name: ch.name,
          ok: !!r.success,
          ms: Date.now() - started,
          error: r.success ? null : sanitizeErrorMessage(r.errorMessage),
        });
        // 记一条 ADMIN_TEST 日志
        await this.prisma.messageLog.create({
          data: {
            projectId,
            channelId: ch.id,
            channelType: ch.type as ChannelType,
            source: MessageSource.ADMIN_TEST,
            status: r.success ? MessageStatus.SUCCESS : MessageStatus.FAILED,
            title,
            content,
            errorMessage: sanitizeErrorMessage(r.errorMessage),
            durationMs: Date.now() - started,
            attempts: 1,
            response: r.response as any,
          },
        });
      } catch (e: any) {
        results.push({
          channelId: ch.id,
          type: ch.type,
          name: ch.name,
          ok: false,
          ms: Date.now() - started,
          error: e?.message || String(e),
        });
      }
    }
    return {
      projectId,
      total: results.length,
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      results,
    };
  }

  /** 按事件目录派发 */
  async dispatchEvent(opts: {
    projectId: string;
    source: MessageSource;
    event: string;
    variables?: Record<string, unknown>;
    title?: string;
    content?: string;
    html?: string;
    to?: string;
    priority?: string;
    dedupeKey?: string;
    forceSync?: boolean;
  }) {
    const code = opts.event.trim();
    const ev =
      (await this.prisma.eventDefinition.findFirst({
        where: { projectId: opts.projectId, code, enabled: true },
      })) ||
      (await this.prisma.eventDefinition.findFirst({
        where: { projectId: null, code, enabled: true },
      }));
    if (!ev) throw new BadRequestException(`未知事件: ${code}`);

    const priority = opts.priority
      ? this.quietHours.parsePriority(opts.priority)
      : ev.defaultPriority;
    const vars = opts.variables || {};

    // 仅指定 to 时走邮件（评论回邮）；仅有 emailTemplate 无 to 仍走推送，避免缺 to 直接炸
    if (opts.to) {
      return this.sendEmail({
        projectId: opts.projectId,
        source: opts.source,
        to: opts.to,
        template: ev.emailTemplateCode || undefined,
        variables: vars,
        subject: opts.title,
        html: opts.html,
        content: opts.content,
        forceSync: opts.forceSync ?? true,
        priority,
        eventCode: code,
        dedupeKey: opts.dedupeKey,
      });
    }

    // 无正文且无推送模板时，给默认标题，避免 dispatchByProject 400
    const title = opts.title || ev.name || code;
    const content =
      opts.content ||
      opts.html ||
      (ev.pushTemplateCode
        ? undefined
        : Object.keys(vars).length
          ? JSON.stringify(vars)
          : `事件 ${code}`);

    return this.sendPush({
      projectId: opts.projectId,
      source: opts.source,
      title,
      content,
      html: opts.html,
      pushTemplate: ev.pushTemplateCode || undefined,
      variables: vars,
      projectDispatch: true,
      forceSync: opts.forceSync,
      priority,
      eventCode: code,
      dedupeKey: opts.dedupeKey,
    });
  }
}
