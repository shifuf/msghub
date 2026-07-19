import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ChannelType, MessageStatus, MessageSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isValidEmail } from '../common/utils';

export type SuppressSource = 'MANUAL' | 'AUTO_FAIL' | 'BOUNCE' | 'UNSUBSCRIBE';

@Injectable()
export class EmailPolicyService {
  constructor(private prisma: PrismaService) {}

  normalizeAddress(raw: string): string {
    return String(raw || '').trim().toLowerCase();
  }

  private domainOf(email: string): string {
    const at = email.lastIndexOf('@');
    return at > 0 ? email.slice(at).toLowerCase() : '';
  }

  async isSuppressed(projectId: string | null | undefined, to: string): Promise<{
    blocked: boolean;
    entry?: { id: string; address: string; reason?: string | null; source: string };
  }> {
    const address = this.normalizeAddress(to);
    if (!address) return { blocked: false };
    const domain = this.domainOf(address);
    const now = new Date();

    const rows = await this.prisma.emailSuppress.findMany({
      where: {
        OR: [
          { projectId: projectId || null, address },
          { projectId: null, address },
          ...(domain
            ? [
                { projectId: projectId || null, address: domain },
                { projectId: null, address: domain },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    for (const r of rows) {
      if (r.expiresAt && r.expiresAt <= now) continue;
      return {
        blocked: true,
        entry: { id: r.id, address: r.address, reason: r.reason, source: r.source },
      };
    }
    return { blocked: false };
  }

  async assertNotSuppressed(projectId: string, to: string) {
    const r = await this.isSuppressed(projectId, to);
    if (r.blocked) {
      throw new BadRequestException(
        `收件人已被抑制（${r.entry?.source || 'MANUAL'}）：${r.entry?.address}${
          r.entry?.reason ? ` · ${r.entry.reason}` : ''
        }`,
      );
    }
  }

  async assertWithinDailyQuota(projectId: string) {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { dailyEmailQuota: true },
    });
    const quota = p?.dailyEmailQuota;
    if (quota == null || quota <= 0) return;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const used = await this.prisma.messageLog.count({
      where: {
        projectId,
        channelType: ChannelType.SMTP,
        source: { not: MessageSource.BACKUP_ALERT },
        createdAt: { gte: start },
        status: { in: [MessageStatus.SUCCESS, MessageStatus.PENDING] },
      },
    });
    if (used >= quota) {
      throw new BadRequestException(`已达项目每日邮件配额（${quota}），请明日再试或调高配额`);
    }
  }

  async listSuppress(opts: { projectId?: string; q?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20));
    const where: any = {};
    if (opts.projectId) where.projectId = opts.projectId;
    if (opts.q?.trim()) {
      where.OR = [
        { address: { contains: opts.q.trim(), mode: 'insensitive' } },
        { reason: { contains: opts.q.trim(), mode: 'insensitive' } },
      ];
    }
    const [total, items] = await Promise.all([
      this.prisma.emailSuppress.count({ where }),
      this.prisma.emailSuppress.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { project: { select: { id: true, name: true } } },
      }),
    ]);
    return { items, total, page, pageSize };
  }

  async addSuppress(data: {
    projectId?: string | null;
    address: string;
    reason?: string;
    source?: SuppressSource;
    expiresAt?: string | null;
  }) {
    let address = this.normalizeAddress(data.address);
    if (!address) throw new BadRequestException('地址不能为空');
    if (address.startsWith('@')) {
      if (address.length < 3) throw new BadRequestException('域名格式无效');
    } else if (!isValidEmail(address)) {
      throw new BadRequestException('邮箱格式无效');
    }
    const projectId = data.projectId || null;
    if (projectId) {
      const p = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!p) throw new NotFoundException('项目不存在');
    }
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    const exp = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null;
    const existing = await this.prisma.emailSuppress.findFirst({
      where: { projectId, address },
    });
    if (existing) {
      return this.prisma.emailSuppress.update({
        where: { id: existing.id },
        data: {
          reason: data.reason?.trim() || null,
          source: data.source || 'MANUAL',
          expiresAt: exp,
        },
      });
    }
    return this.prisma.emailSuppress.create({
      data: {
        projectId,
        address,
        reason: data.reason?.trim() || null,
        source: data.source || 'MANUAL',
        expiresAt: exp,
      },
    });
  }

  async removeSuppress(id: string) {
    await this.prisma.emailSuppress.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('记录不存在');
    });
    return { id };
  }

  /** SMTP 失败后：连续失败达阈值则自动拉黑 */
  async maybeAutoSuppress(projectId: string | null | undefined, to: string | null | undefined, errorMessage?: string | null) {
    if (!projectId || !to) return;
    const address = this.normalizeAddress(to);
    if (!isValidEmail(address)) return;

    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { emailFailSuppressCount: true },
    });
    const threshold = p?.emailFailSuppressCount ?? 5;
    if (!threshold || threshold <= 0) return;

    const already = await this.isSuppressed(projectId, address);
    if (already.blocked) return;

    const recent = await this.prisma.messageLog.findMany({
      where: {
        projectId,
        channelType: ChannelType.SMTP,
        toAddress: { equals: address, mode: 'insensitive' },
        source: { not: MessageSource.BACKUP_ALERT },
      },
      orderBy: { createdAt: 'desc' },
      take: threshold,
      select: { status: true },
    });
    if (recent.length < threshold) return;
    if (!recent.every((r) => r.status === MessageStatus.FAILED)) return;

    await this.addSuppress({
      projectId,
      address,
      source: 'AUTO_FAIL',
      reason: `连续失败 ${threshold} 次${errorMessage ? `：${String(errorMessage).slice(0, 120)}` : ''}`,
    });
  }

  /**
   * 失败告警冷却：同项目 + 同收件人（或同错误摘要）在冷却窗口内已有 BACKUP_ALERT 则跳过。
   */
  async shouldSkipBackupAlert(
    projectId: string,
    opts: { toAddress?: string | null; errorMessage?: string | null },
  ): Promise<boolean> {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { alertCooldownMin: true },
    });
    const mins = p?.alertCooldownMin ?? 10;
    if (!mins || mins <= 0) return false;

    const since = new Date(Date.now() - mins * 60 * 1000);
    const to = opts.toAddress ? this.normalizeAddress(opts.toAddress) : '';
    const errKey = (opts.errorMessage || '').slice(0, 80);

    const recent = await this.prisma.messageLog.findMany({
      where: {
        projectId,
        source: MessageSource.BACKUP_ALERT,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { title: true, content: true },
    });

    for (const m of recent) {
      const body = `${m.title || ''}\n${m.content || ''}`;
      if (to && body.toLowerCase().includes(to)) return true;
      if (errKey && body.includes(errKey)) return true;
    }
    return false;
  }

  async projectHealth(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        bindings: {
          where: { enabled: true },
          include: { channel: true },
          orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }],
        },
      },
    });
    if (!project) throw new NotFoundException('项目不存在');

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);

    const [smtpTotal24h, smtpFail24h, smtpSuccess24h, smtpToday, suppressCount, lastSmtp] =
      await Promise.all([
        this.prisma.messageLog.count({
          where: {
            projectId,
            channelType: ChannelType.SMTP,
            createdAt: { gte: since24h },
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
        this.prisma.messageLog.count({
          where: {
            projectId,
            channelType: ChannelType.SMTP,
            status: MessageStatus.FAILED,
            createdAt: { gte: since24h },
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
        this.prisma.messageLog.count({
          where: {
            projectId,
            channelType: ChannelType.SMTP,
            status: MessageStatus.SUCCESS,
            createdAt: { gte: since24h },
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
        this.prisma.messageLog.count({
          where: {
            projectId,
            channelType: ChannelType.SMTP,
            createdAt: { gte: startToday },
            status: { in: [MessageStatus.SUCCESS, MessageStatus.PENDING] },
            source: { not: MessageSource.BACKUP_ALERT },
          },
        }),
        this.prisma.emailSuppress.count({
          where: { OR: [{ projectId }, { projectId: null }] },
        }),
        this.prisma.messageLog.findFirst({
          where: {
            projectId,
            channelType: ChannelType.SMTP,
            source: { not: MessageSource.BACKUP_ALERT },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            toAddress: true,
            errorMessage: true,
            durationMs: true,
            createdAt: true,
            title: true,
          },
        }),
      ]);

    const smtpBindings = project.bindings.filter(
      (b) => b.channel?.type === ChannelType.SMTP && b.channel.enabled,
    );
    const backupBindings = project.bindings.filter(
      (b) =>
        b.isBackup &&
        b.channel?.enabled &&
        b.channel.type !== ChannelType.SMTP &&
        b.channel.type !== ChannelType.INBOX,
    );
    const pushBindings = project.bindings.filter(
      (b) =>
        b.channel?.enabled &&
        b.channel.type !== ChannelType.SMTP &&
        b.channel.type !== ChannelType.INBOX,
    );

    const failRate24h = smtpTotal24h > 0 ? (smtpFail24h / smtpTotal24h) * 100 : 0;
    const quota = project.dailyEmailQuota;

    return {
      projectId: project.id,
      name: project.name,
      enabled: project.enabled,
      smtp: {
        configured: smtpBindings.length > 0,
        bindings: smtpBindings.map((b) => ({
          channelId: b.channelId,
          name: b.channel?.name,
          isDefault: b.isDefault,
        })),
        last24h: {
          total: smtpTotal24h,
          success: smtpSuccess24h,
          failed: smtpFail24h,
          failRatePct: Number(failRate24h.toFixed(1)),
        },
        todayUsed: smtpToday,
        dailyQuota: quota ?? null,
        quotaRemaining: quota && quota > 0 ? Math.max(0, quota - smtpToday) : null,
        lastMessage: lastSmtp,
      },
      backupAlert: {
        configured: backupBindings.length > 0 || pushBindings.some((b) => !b.isDefault),
        channels: (backupBindings.length ? backupBindings : pushBindings.filter((b) => !b.isDefault))
          .slice(0, 5)
          .map((b) => ({
            channelId: b.channelId,
            name: b.channel?.name,
            type: b.channel?.type,
            isBackup: b.isBackup,
          })),
      },
      policy: {
        dailyEmailQuota: project.dailyEmailQuota ?? null,
        emailFailSuppressCount: project.emailFailSuppressCount ?? 5,
        alertCooldownMin: project.alertCooldownMin ?? 10,
        adminEmail: project.adminEmail,
        alertFailRatePct: project.alertFailRatePct,
        suppressCount,
      },
      warnings: [
        !smtpBindings.length ? '未绑定启用 SMTP，无法 /api/email' : null,
        !backupBindings.length && !pushBindings.some((b) => !b.isDefault)
          ? '未配置备用推送渠道，邮件失败无法手机告警'
          : null,
        failRate24h >= 30 && smtpTotal24h >= 5 ? `近 24h SMTP 失败率偏高 ${failRate24h.toFixed(1)}%` : null,
        quota && quota > 0 && smtpToday >= quota ? '今日邮件配额已用尽' : null,
      ].filter(Boolean),
    };
  }
}
