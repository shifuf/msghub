import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ChannelType, MessageSource, MessageStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../adapters/adapters.registry';
import { maskChannelConfig } from '../common/utils';
import { RealtimeService } from '../realtime/realtime.service';
import { ActivityService } from '../activity/activity.service';
import { safeAdapterSend } from '../common/delivery.util';
import { sanitizeErrorMessage } from '../common/utils';
import {
  resolveUnsubscribeSecret,
  signReadToken,
} from '../common/token.util';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private prisma: PrismaService,
    private adapters: AdapterRegistry,
    private realtime: RealtimeService,
    private activity: ActivityService,
    private config: ConfigService,
  ) {}

  private mapChannel(c: any, mask = true) {
    const config = (c.config || {}) as Record<string, unknown>;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      config: mask ? maskChannelConfig(c.type, config) : config,
      enabled: c.enabled,
      isDefault: c.isDefault,
      lastHealthAt: c.lastHealthAt ?? null,
      lastHealthOk: c.lastHealthOk ?? null,
      lastHealthError: c.lastHealthError ?? null,
      lastHealthMs: c.lastHealthMs ?? null,
      healthFailStreak: c.healthFailStreak ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      _count: c._count,
    };
  }

  private mapBinding(b: any, mask = true) {
    return {
      id: b.id,
      projectId: b.projectId,
      channelId: b.channelId,
      enabled: b.enabled,
      isDefault: b.isDefault,
      isBackup: b.isBackup ?? false,
      priority: b.priority ?? 100,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      channel: b.channel ? this.mapChannel(b.channel, mask) : undefined,
    };
  }

  async listAll() {
    const rows = await this.prisma.channel.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { bindings: true, messages: true } } },
    });
    return rows.map((c) => this.mapChannel(c));
  }

  async get(id: string, mask = true) {
    const c = await this.prisma.channel.findUnique({
      where: { id },
      include: { _count: { select: { bindings: true, messages: true } } },
    });
    if (!c) throw new NotFoundException('渠道不存在');
    return this.mapChannel(c, mask);
  }

  async getRaw(id: string) {
    const c = await this.prisma.channel.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('渠道不存在');
    return c;
  }

  async create(data: {
    name: string;
    type: ChannelType;
    config: Record<string, unknown>;
    enabled?: boolean;
    isDefault?: boolean;
  }) {
    const adapter = this.adapters.get(data.type);
    adapter.validateConfig(data.config || {});

    if (data.isDefault) {
      await this.prisma.channel.updateMany({ data: { isDefault: false } });
    }

    const c = await this.prisma.channel.create({
      data: {
        name: data.name.trim(),
        type: data.type,
        config: (data.config || {}) as any,
        enabled: data.enabled ?? true,
        isDefault: data.isDefault ?? false,
      },
      include: { _count: { select: { bindings: true, messages: true } } },
    });
    return this.mapChannel(c);
  }

  async update(
    id: string,
    data: {
      name?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
      isDefault?: boolean;
    },
  ) {
    const existing = await this.getRaw(id);
    let nextConfig = (existing.config || {}) as Record<string, unknown>;

    if (data.config) {
      nextConfig = this.mergeConfig(nextConfig, data.config);
      this.adapters.get(existing.type).validateConfig(nextConfig);
    }

    if (data.isDefault) {
      await this.prisma.channel.updateMany({
        where: { NOT: { id } },
        data: { isDefault: false },
      });
    }

    const c = await this.prisma.channel.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        config: data.config ? (nextConfig as any) : undefined,
        enabled: data.enabled,
        isDefault: data.isDefault,
      },
      include: { _count: { select: { bindings: true, messages: true } } },
    });
    return this.mapChannel(c);
  }

  private mergeConfig(
    oldCfg: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const next = { ...oldCfg };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string') {
        if (!v.trim() || v.includes('****')) continue;
        next[k] = v;
      } else {
        next[k] = v;
      }
    }
    return next;
  }

  async remove(id: string) {
    const c = await this.getRaw(id);
    if (c.type === ChannelType.INBOX) {
      throw new BadRequestException('站内通知渠道不允许删除');
    }
    await this.prisma.channel.delete({ where: { id } });
    await this.activity.log({
      action: 'channel.delete',
      resource: 'Channel',
      resourceId: c.id,
      resourceName: c.name,
      detail: { type: c.type },
    });
    return { deleted: true };
  }

  async setDefault(id: string) {
    await this.getRaw(id);
    await this.prisma.$transaction([
      this.prisma.channel.updateMany({ data: { isDefault: false } }),
      this.prisma.channel.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.get(id);
  }

  /**
   * 渠道连通测试：与正式推送使用相同链路。
   * - 先入库取得 messageId，并注入 readToken（客户端点击可回传已读）
   * - JPUSH 将 Registration ID 写入 toAddress，进入设备推送历史
   * - 若绑定项目开启未读邮件兜底，则创建对应定时任务
   */
  async test(id: string) {
    const c = await this.getRaw(id);
    if (!c.enabled) throw new BadRequestException('渠道已禁用');
    const adapter = this.adapters.get(c.type);
    const config = (c.config || {}) as Record<string, unknown>;

    // 优先选择：绑定本渠道且开启未读邮件兜底的项目；否则取任一已启用绑定项目
    const binding =
      (await this.prisma.projectChannel.findFirst({
        where: {
          channelId: id,
          enabled: true,
          project: { enabled: true, unreadEmailFallbackEnabled: true },
        },
        include: { project: true },
        orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }],
      })) ||
      (await this.prisma.projectChannel.findFirst({
        where: {
          channelId: id,
          enabled: true,
          project: { enabled: true },
        },
        include: { project: true },
        orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }],
      }));

    const projectId = binding?.projectId || null;
    const project = binding?.project || null;

    let toAddress: string | null = null;
    if (c.type === ChannelType.JPUSH) {
      const rid =
        typeof config.registrationId === 'string'
          ? config.registrationId.trim()
          : '';
      toAddress = rid.split(/[,;\s]+/).filter(Boolean)[0] || rid || null;
    } else if (c.type === ChannelType.SMTP) {
      const testTo =
        typeof config.testTo === 'string' ? config.testTo.trim() : '';
      toAddress = testTo || project?.adminEmail || null;
    }

    const title =
      c.type === ChannelType.JPUSH
        ? '【测试】极光推送'
        : '【测试】连通性测试';
    const content =
      c.type === ChannelType.JPUSH
        ? '这是一条来自消息推送平台的 JPush 测试通知（含已读回执与未读邮件兜底链路）。'
        : '这是一条来自消息推送平台的测试消息。';

    // 先入库，拿到 messageId 再发送，保证 extras 带上平台字段
    const log = await this.prisma.messageLog.create({
      data: {
        projectId,
        channelId: c.id,
        channelType: c.type,
        source: MessageSource.ADMIN_TEST,
        status: MessageStatus.PENDING,
        title,
        content,
        toAddress,
        payload: {
          title,
          content,
          to: toAddress,
          extra: { test: true, adminChannelTest: true },
        } as any,
        attempts: 0,
      },
    });

    const extra: Record<string, unknown> = {
      test: true,
      adminChannelTest: true,
      messageId: log.id,
    };
    if (toAddress && c.type === ChannelType.JPUSH) {
      extra.registrationId =
        typeof config.registrationId === 'string'
          ? config.registrationId.trim()
          : toAddress;
    }
    try {
      const secret = resolveUnsubscribeSecret(
        this.config.get('UNSUBSCRIBE_SECRET') || this.config.get('JWT_SECRET'),
        { allowDevFallback: true },
      );
      extra.readToken = signReadToken(log.id, secret);
    } catch (e: any) {
      this.logger.warn(`channel test readToken skip: ${e?.message || e}`);
    }

    await this.prisma.messageLog.update({
      where: { id: log.id },
      data: {
        payload: {
          title,
          content,
          to: toAddress,
          extra,
        } as any,
      },
    });

    const started = Date.now();
    const result = await safeAdapterSend(this.adapters, c.type, config, {
      title,
      content,
      to: toAddress || undefined,
      extra,
    });
    const durationMs = Date.now() - started;

    const updated = await this.prisma.messageLog.update({
      where: { id: log.id },
      data: {
        status: result.success ? MessageStatus.SUCCESS : MessageStatus.FAILED,
        response: result.response as any,
        errorMessage: sanitizeErrorMessage(result.errorMessage),
        durationMs,
        attempts: 1,
      },
    });

    // 成功且为外发推送：按绑定项目排未读邮件兜底（与正式发送一致）
    let fallback: {
      scheduled: boolean;
      runAt?: string;
      minutes?: number;
      projectId?: string | null;
      reason?: string;
    } = { scheduled: false };

    if (
      result.success &&
      projectId &&
      project?.unreadEmailFallbackEnabled &&
      c.type !== ChannelType.SMTP &&
      c.type !== ChannelType.INBOX
    ) {
      const minutes = Math.max(
        1,
        Math.min(43200, Number(project.unreadEmailFallbackHours) || 24),
      );
      const runAt = new Date(Date.now() + minutes * 60 * 1000);
      const existing = await this.prisma.scheduledMessage.findFirst({
        where: {
          projectId,
          kind: 'unread_email_fallback',
          status: 'PENDING',
          messageId: log.id,
        },
      });
      if (!existing) {
        await this.prisma.scheduledMessage.create({
          data: {
            projectId,
            kind: 'unread_email_fallback',
            title,
            content,
            templateCode: project.unreadEmailTemplateCode || null,
            variables: {
              sourceMessageId: log.id,
              unreadEmailFallback: true,
              minutes,
              scheduledAt: new Date().toISOString(),
              runAt: runAt.toISOString(),
              from: 'channel_test',
            } as any,
            runAt,
            status: 'PENDING',
            messageId: log.id,
          },
        });
        fallback = {
          scheduled: true,
          runAt: runAt.toISOString(),
          minutes,
          projectId,
        };
        this.logger.log(
          `channel-test fallback scheduled message=${log.id} project=${projectId} runAt=${runAt.toISOString()} min=${minutes}`,
        );
      } else {
        fallback = {
          scheduled: true,
          runAt: existing.runAt.toISOString(),
          minutes,
          projectId,
          reason: 'already_pending',
        };
      }
    } else if (result.success && !projectId) {
      fallback = {
        scheduled: false,
        reason: 'channel_not_bound_to_project',
      };
    } else if (result.success && project && !project.unreadEmailFallbackEnabled) {
      fallback = {
        scheduled: false,
        projectId,
        reason: 'project_fallback_disabled',
      };
    }

    try {
      const full = await this.prisma.messageLog.findUnique({
        where: { id: log.id },
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true } },
        },
      });
      if (full) this.realtime.emitMessage(full);
    } catch {
      /* ignore */
    }

    return {
      success: result.success,
      messageId: updated.id,
      errorMessage: sanitizeErrorMessage(result.errorMessage),
      response: result.response,
      durationMs,
      projectId,
      toAddress,
      // 测试响应附加：是否注入已读令牌与兜底链路
      extras: {
        messageId: log.id,
        hasReadToken: !!extra.readToken,
      },
      unreadEmailFallback: fallback,
    };
  }

  async listBindings(projectId: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectChannel.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      include: { channel: true },
    });
    return rows.map((b) => this.mapBinding(b));
  }

  async listProjectChannelOptions(projectId: string) {
    await this.ensureProject(projectId);
    const [channels, bindings] = await Promise.all([
      this.prisma.channel.findMany({
        where: { enabled: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.projectChannel.findMany({ where: { projectId } }),
    ]);
    const byChannel = new Map(bindings.map((b) => [b.channelId, b]));
    // 启用中的按 priority 排前，未绑定/未启用的靠后
    const mapped = channels.map((c) => {
      const b = byChannel.get(c.id);
      return {
        ...this.mapChannel(c),
        bound: !!b,
        bindingId: b?.id || null,
        bindingEnabled: b?.enabled ?? false,
        bindingIsDefault: b?.isDefault ?? false,
        bindingIsBackup: b?.isBackup ?? false,
        bindingPriority: b?.priority ?? 100,
      };
    });
    mapped.sort((a, b) => {
      // 默认优先
      if (a.bindingIsDefault !== b.bindingIsDefault) return a.bindingIsDefault ? -1 : 1;
      // 已启用优先
      if (a.bindingEnabled !== b.bindingEnabled) return a.bindingEnabled ? -1 : 1;
      // 按 priority 升序
      if (a.bindingPriority !== b.bindingPriority) return a.bindingPriority - b.bindingPriority;
      return String(a.name).localeCompare(String(b.name));
    });
    return mapped;
  }

  async bindChannel(
    projectId: string,
    data: {
      channelId: string;
      enabled?: boolean;
      isDefault?: boolean;
      isBackup?: boolean;
      priority?: number;
    },
  ) {
    await this.ensureProject(projectId);
    const channel = await this.getRaw(data.channelId);
    if (!channel.enabled) throw new BadRequestException('该渠道已全局禁用');

    if (data.isDefault) {
      await this.prisma.projectChannel.updateMany({
        where: { projectId },
        data: { isDefault: false },
      });
    }
    if (data.isBackup) {
      await this.prisma.projectChannel.updateMany({
        where: { projectId },
        data: { isBackup: false },
      });
    }

    // 新建绑定时：若未指定 priority，排到当前最大 priority + 10
    let priority = data.priority;
    if (priority == null) {
      const max = await this.prisma.projectChannel.aggregate({
        where: { projectId },
        _max: { priority: true },
      });
      priority = (max._max.priority ?? 0) + 10;
    }

    const row = await this.prisma.projectChannel.upsert({
      where: {
        projectId_channelId: { projectId, channelId: data.channelId },
      },
      create: {
        projectId,
        channelId: data.channelId,
        enabled: data.enabled ?? true,
        isDefault: data.isDefault ?? false,
        isBackup: data.isBackup ?? false,
        priority,
      },
      update: {
        enabled: data.enabled ?? true,
        isDefault: data.isDefault,
        isBackup: data.isBackup,
        ...(data.priority != null ? { priority: data.priority } : {}),
      },
      include: { channel: true },
    });
    return this.mapBinding(row);
  }

  async updateBinding(
    projectId: string,
    channelId: string,
    data: {
      enabled?: boolean;
      isDefault?: boolean;
      isBackup?: boolean;
      priority?: number;
    },
  ) {
    const existing = await this.prisma.projectChannel.findUnique({
      where: { projectId_channelId: { projectId, channelId } },
      include: { channel: true },
    });
    if (!existing) throw new NotFoundException('项目未绑定该渠道');
    if (existing.channel?.type === ChannelType.INBOX && data.enabled === false) {
      throw new BadRequestException('站内通知渠道不允许停用');
    }

    if (data.isDefault) {
      await this.prisma.projectChannel.updateMany({
        where: { projectId, NOT: { id: existing.id } },
        data: { isDefault: false },
      });
    }
    if (data.isBackup) {
      await this.prisma.projectChannel.updateMany({
        where: { projectId, NOT: { id: existing.id } },
        data: { isBackup: false },
      });
    }

    const row = await this.prisma.projectChannel.update({
      where: { id: existing.id },
      data: {
        enabled: data.enabled,
        isDefault: data.isDefault,
        isBackup: data.isBackup,
        priority: data.priority,
      },
      include: { channel: true },
    });
    return this.mapBinding(row);
  }

  async unbindChannel(projectId: string, channelId: string) {
    const existing = await this.prisma.projectChannel.findUnique({
      where: { projectId_channelId: { projectId, channelId } },
      include: { channel: true },
    });
    if (!existing) throw new NotFoundException('项目未绑定该渠道');
    if (existing.channel?.type === ChannelType.INBOX) {
      throw new BadRequestException('站内通知渠道不允许解绑');
    }
    await this.prisma.projectChannel.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

  async setProjectDefault(projectId: string, channelId: string) {
    const existing = await this.prisma.projectChannel.findUnique({
      where: { projectId_channelId: { projectId, channelId } },
    });
    if (!existing) throw new NotFoundException('项目未绑定该渠道');
    await this.prisma.$transaction([
      this.prisma.projectChannel.updateMany({
        where: { projectId },
        data: { isDefault: false },
      }),
      this.prisma.projectChannel.update({
        where: { id: existing.id },
        data: { isDefault: true, enabled: true, priority: 0 },
      }),
    ]);
    return this.mapBinding(
      await this.prisma.projectChannel.findUnique({
        where: { id: existing.id },
        include: { channel: true },
      }),
    );
  }

  async setProjectBackup(projectId: string, channelId: string) {
    const existing = await this.prisma.projectChannel.findUnique({
      where: { projectId_channelId: { projectId, channelId } },
      include: { channel: true },
    });
    if (!existing) throw new NotFoundException('项目未绑定该渠道');
    if (existing.channel.type === ChannelType.SMTP) {
      throw new BadRequestException('备用告警渠道请选择推送类渠道（非 SMTP）');
    }
    await this.prisma.$transaction([
      this.prisma.projectChannel.updateMany({
        where: { projectId },
        data: { isBackup: false },
      }),
      this.prisma.projectChannel.update({
        where: { id: existing.id },
        data: { isBackup: true, enabled: true },
      }),
    ]);
    return this.mapBinding(
      await this.prisma.projectChannel.findUnique({
        where: { id: existing.id },
        include: { channel: true },
      }),
    );
  }

  /**
   * 批量设置兜底优先级。ids 顺序即优先级 10,20,30...
   * 默认渠道固定 priority=0。
   */
  async reorderBindings(projectId: string, channelIds: string[]) {
    await this.ensureProject(projectId);
    if (!Array.isArray(channelIds) || !channelIds.length) {
      throw new BadRequestException('channelIds 不能为空');
    }
    const bindings = await this.prisma.projectChannel.findMany({
      where: { projectId },
    });
    const byChannel = new Map(bindings.map((b) => [b.channelId, b]));
    const updates: Array<{ id: string; priority: number }> = [];
    let order = 10;
    for (const cid of channelIds) {
      const b = byChannel.get(cid);
      if (!b) continue;
      const priority = b.isDefault ? 0 : order;
      if (!b.isDefault) order += 10;
      updates.push({ id: b.id, priority });
    }
    for (const b of bindings) {
      if (channelIds.includes(b.channelId)) continue;
      if (b.isDefault) updates.push({ id: b.id, priority: 0 });
    }
    for (const u of updates) {
      await this.prisma.projectChannel.update({
        where: { id: u.id },
        data: { priority: u.priority },
      });
    }
    return this.listProjectChannelOptions(projectId);
  }

  /**
   * 解析备用告警渠道：优先 isBackup；没有则取非默认的最高优先级启用渠道
   */
  async resolveBackupChannel(projectId: string, excludeChannelId?: string) {
    const backup = await this.prisma.projectChannel.findFirst({
      where: {
        projectId,
        enabled: true,
        isBackup: true,
        channel: {
          enabled: true,
          ...(excludeChannelId ? { id: { not: excludeChannelId } } : {}),
          type: { notIn: [ChannelType.SMTP, ChannelType.INBOX] },
        },
      },
      include: { channel: true },
    });
    if (backup?.channel) return backup.channel;

    // 无显式备用时：用优先级最高的非默认外发渠道作为告警兜底
    const next = await this.prisma.projectChannel.findFirst({
      where: {
        projectId,
        enabled: true,
        isDefault: false,
        channel: {
          enabled: true,
          ...(excludeChannelId ? { id: { not: excludeChannelId } } : {}),
          type: { notIn: [ChannelType.SMTP, ChannelType.INBOX] },
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: { channel: true },
    });
    return next?.channel || null;
  }

  /**
   * 失败兜底 / 项目派发候选：已启用、非 SMTP、非站内 INBOX，排除已失败渠道。
   * 排序：priority 升序（数字越小越先），默认渠道靠前。
   * 站内由 receiveInbox 固定承接，不参与外发熔断链。
   */
  async listFailoverChannels(projectId: string, excludeChannelIds: string[] = []) {
    const exclude = excludeChannelIds.filter(Boolean);
    const bindings = await this.prisma.projectChannel.findMany({
      where: {
        projectId,
        enabled: true,
        ...(exclude.length ? { channelId: { notIn: exclude } } : {}),
        channel: {
          enabled: true,
          type: { notIn: [ChannelType.SMTP, ChannelType.INBOX] },
        },
      },
      include: { channel: true },
      orderBy: [{ priority: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return bindings.map((b) => b.channel).filter(Boolean);
  }

  /** 项目已启用的外发渠道（不含站内 / SMTP），按优先级 */
  async listDispatchChannels(projectId: string) {
    return this.listFailoverChannels(projectId, []);
  }

  async resolveChannel(
    projectId: string,
    opts: { channelId?: string; channelType?: ChannelType },
  ) {
    if (opts.channelId) {
      const b = await this.prisma.projectChannel.findFirst({
        where: {
          projectId,
          channelId: opts.channelId,
          enabled: true,
          channel: { enabled: true },
        },
        include: { channel: true },
      });
      if (!b) throw new NotFoundException('渠道未绑定到该项目或已禁用');
      return b.channel;
    }

    if (opts.channelType) {
      const b = await this.prisma.projectChannel.findFirst({
        where: {
          projectId,
          enabled: true,
          channel: { type: opts.channelType, enabled: true },
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        include: { channel: true },
      });
      if (!b) {
        throw new NotFoundException(
          `项目未启用可用的 ${opts.channelType} 渠道，请先在项目详情中绑定`,
        );
      }
      return b.channel;
    }

    const def = await this.prisma.projectChannel.findFirst({
      where: {
        projectId,
        enabled: true,
        isDefault: true,
        channel: { enabled: true },
      },
      include: { channel: true },
    });
    if (def) return def.channel;

    const any = await this.prisma.projectChannel.findFirst({
      where: {
        projectId,
        enabled: true,
        channel: { enabled: true },
      },
      orderBy: { createdAt: 'desc' },
      include: { channel: true },
    });
    if (!any) throw new NotFoundException('项目下没有可用渠道，请先绑定渠道');
    return any.channel;
  }

  private async ensureProject(projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException('项目不存在');
    return p;
  }
}
