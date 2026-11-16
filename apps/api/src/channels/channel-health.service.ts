import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ChannelType, MessageSource, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from '../adapters/adapters.registry';
import { ActivityService } from '../activity/activity.service';
import { ChannelsService } from '../channels/channels.service';
import { sanitizeErrorMessage } from '../common/utils';

@Injectable()
export class ChannelHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelHealthService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunAt = 0;

  constructor(
    private prisma: PrismaService,
    private adapters: AdapterRegistry,
    private activity: ActivityService,
    private channels: ChannelsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.maybeProbeAll(), 60_000);
    this.logger.log('channel health ticker started (60s check / 10min probe)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async intervalMin() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'healthProbeIntervalMin' },
    });
    const n = Number(row?.value || 10);
    return Math.max(5, Number.isFinite(n) ? n : 10);
  }

  async maybeProbeAll() {
    const interval = (await this.intervalMin()) * 60_000;
    if (Date.now() - this.lastRunAt < interval) return;
    await this.probeAll();
  }

  async probeAll() {
    if (this.running) return { skipped: true };
    this.running = true;
    this.lastRunAt = Date.now();
    try {
      const channels = await this.prisma.channel.findMany({
        where: { enabled: true },
      });
      const targets = channels.filter((ch) => {
        if (ch.type === ChannelType.INBOX) return false;
        const cfg = (ch.config || {}) as any;
        if (cfg.skipHealthProbe === true) return false;
        if (ch.type === ChannelType.SMTP && !cfg.testTo) return false;
        return true;
      });
      // 有限并发，避免串行过慢
      const concurrency = 3;
      const results: any[] = [];
      for (let i = 0; i < targets.length; i += concurrency) {
        const batch = targets.slice(i, i + concurrency);
        const part = await Promise.all(batch.map((ch) => this.probeOne(ch.id)));
        results.push(...part);
      }
      return { total: results.length, results };
    } finally {
      this.running = false;
    }
  }

  async probeOne(channelId: string) {
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) return { channelId, ok: false, error: 'not found' };
    if (ch.type === ChannelType.INBOX) {
      return { channelId, ok: true, skipped: true };
    }
    const started = Date.now();
    let ok = false;
    let error: string | null = null;
    try {
      const adapter = this.adapters.get(ch.type);
      adapter.validateConfig((ch.config || {}) as Record<string, unknown>);
      ok = true;
      error = null;
    } catch (e: any) {
      ok = false;
      error = e?.message || String(e);
    }
    const ms = Date.now() - started;
    const prevStreak = ch.healthFailStreak || 0;
    const streak = ok ? 0 : prevStreak + 1;
    await this.prisma.channel.update({
      where: { id: ch.id },
      data: {
        lastHealthAt: new Date(),
        lastHealthOk: ok,
        lastHealthError: error,
        lastHealthMs: ms,
        healthFailStreak: streak,
      },
    });

    if (!ok && prevStreak === 0) {
      await this.activity.log({
        action: 'channel.health_fail',
        resource: 'Channel',
        resourceId: ch.id,
        resourceName: ch.name,
        detail: { error, type: ch.type },
      });
    }

    // 连续失败 ≥2：向绑定了该渠道的项目推备用告警（冷却用 lastFailAlertAt）
    // Passive configuration checks only; explicit channel tests own real sends.

    return { channelId: ch.id, name: ch.name, type: ch.type, ok, ms, error, streak, scope: 'configuration', deliveryVerified: false };
  }

  private async alertProjects(channelId: string, name: string, error: string | null) {
    const bindings = await this.prisma.projectChannel.findMany({
      where: { channelId, enabled: true },
      include: { project: true },
    });
    for (const b of bindings) {
      const p = b.project;
      if (!p?.enabled) continue;
      const coolMin = p.alertCooldownMin ?? 10;
      if (
        p.lastFailAlertAt &&
        Date.now() - p.lastFailAlertAt.getTime() < coolMin * 60_000
      ) {
        continue;
      }
      try {
        const backup = await this.channels.resolveBackupChannel(p.id, channelId);
        if (!backup || backup.type === ChannelType.SMTP) continue;
        const adapter = this.adapters.get(backup.type);
        const title = `【渠道健康告警】${name}`;
        const content = [
          `项目: ${p.name}`,
          `渠道: ${name}`,
          `错误: ${error || '未知'}`,
          `时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        ].join('\n');
        const sendResult = await adapter.send(
          (backup.config || {}) as Record<string, unknown>,
          { title, content },
        );
        await this.prisma.messageLog.create({
          data: {
            projectId: p.id,
            channelId: backup.id,
            channelType: backup.type,
            source: MessageSource.BACKUP_ALERT,
            status: sendResult.success
              ? MessageStatus.SUCCESS
              : MessageStatus.FAILED,
            title,
            content,
            errorMessage: sendResult.success
              ? null
              : sanitizeErrorMessage(sendResult.errorMessage),
            attempts: 1,
            response: (sendResult.response || null) as any,
          },
        });
        // 仅成功发送时推进冷却，避免「假成功」吞掉后续告警
        if (sendResult.success) {
          await this.prisma.project.update({
            where: { id: p.id },
            data: { lastFailAlertAt: new Date() },
          });
        } else {
          this.logger.warn(
            `health alert send failed project=${p.id}: ${sendResult.errorMessage}`,
          );
        }
      } catch (e: any) {
        this.logger.warn(`health alert failed project=${p.id}: ${e?.message || e}`);
      }
    }
  }

  async listHealth() {
    const rows = await this.prisma.channel.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        enabled: true,
        lastHealthAt: true,
        lastHealthOk: true,
        lastHealthError: true,
        lastHealthMs: true,
        healthFailStreak: true,
      },
    });
    return rows;
  }
}
