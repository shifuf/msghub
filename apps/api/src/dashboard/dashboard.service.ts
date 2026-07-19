import { Injectable } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeErrorCluster } from '../common/token.util';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async stats() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      projectCount,
      channelCount,
      templateCount,
      totalMessages,
      success24h,
      failed24h,
      recent,
      unhealthyChannelCount,
      delayedCount,
      unreadCount,
    ] = await Promise.all([
      this.prisma.project.count(),
      this.prisma.channel.count(),
      this.prisma.emailTemplate.count(),
      this.prisma.messageLog.count(),
      this.prisma.messageLog.count({
        where: { status: MessageStatus.SUCCESS, createdAt: { gte: since24h } },
      }),
      this.prisma.messageLog.count({
        where: { status: MessageStatus.FAILED, createdAt: { gte: since24h } },
      }),
      this.prisma.messageLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.channel.count({
        where: { enabled: true, lastHealthOk: false },
      }),
      this.prisma.messageLog.count({ where: { status: MessageStatus.DELAYED } }),
      this.prisma.messageLog.count({ where: { readAt: null } }),
    ]);

    return {
      projectCount,
      channelCount,
      templateCount,
      totalMessages,
      success24h,
      failed24h,
      recent,
      unhealthyChannelCount,
      delayedCount,
      unreadCount,
    };
  }

  async notifications(since?: string, limit = 20) {
    const take = Math.min(50, Math.max(1, Number(limit) || 20));
    const where: any = { archivedAt: null };
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) {
        where.createdAt = { gt: d };
      }
    }

    const [items, pending, failed24h] = await Promise.all([
      this.prisma.messageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          project: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.messageLog.count({ where: { status: MessageStatus.PENDING } }),
      this.prisma.messageLog.count({
        where: {
          status: MessageStatus.FAILED,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      items,
      pending,
      failed24h,
      serverTime: new Date().toISOString(),
    };
  }

  async charts(days = 7) {
    const d = Math.min(30, Math.max(1, Number(days) || 7));
    // 使用本地日历日窗口，避免 UTC toISOString 导致跨日分桶错误
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (d - 1));

    const logs = await this.prisma.messageLog.findMany({
      where: { createdAt: { gte: start } },
      select: {
        status: true,
        channelType: true,
        projectId: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
      },
    });

    const dayKey = (dt: Date) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const dayKeys: string[] = [];
    for (let i = 0; i < d; i++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      dayKeys.push(dayKey(dt));
    }
    const trendMap = new Map<
      string,
      { success: number; failed: number; pending: number; total: number }
    >();
    for (const k of dayKeys) {
      trendMap.set(k, { success: 0, failed: 0, pending: 0, total: 0 });
    }
    for (const log of logs) {
      const key = dayKey(log.createdAt);
      const row = trendMap.get(key);
      if (!row) continue;
      row.total += 1;
      if (log.status === 'SUCCESS') row.success += 1;
      else if (log.status === 'FAILED') row.failed += 1;
      else row.pending += 1;
    }
    const trend = dayKeys.map((date) => ({ date, ...trendMap.get(date)! }));

    const channelMap = new Map<string, number>();
    for (const log of logs) {
      const t = log.channelType || 'UNKNOWN';
      channelMap.set(t, (channelMap.get(t) || 0) + 1);
    }
    const byChannel = Array.from(channelMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const projectMap = new Map<
      string,
      { name: string; count: number; success: number; failed: number }
    >();
    for (const log of logs) {
      const id = log.projectId || '_none';
      const name = log.project?.name || '未归属';
      const row = projectMap.get(id) || { name, count: 0, success: 0, failed: 0 };
      row.count += 1;
      if (log.status === 'SUCCESS') row.success += 1;
      if (log.status === 'FAILED') row.failed += 1;
      projectMap.set(id, row);
    }
    const byProject = Array.from(projectMap.entries())
      .map(([id, v]) => ({ projectId: id === '_none' ? null : id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const successRate =
      logs.length === 0
        ? 0
        : Math.round(
            (logs.filter((l) => l.status === 'SUCCESS').length / logs.length) * 1000,
          ) / 10;

    return {
      days: d,
      since: start.toISOString(),
      total: logs.length,
      successRate,
      trend,
      byChannel,
      byProject,
    };
  }

  async errorClusters(days = 7) {
    const d = Math.min(30, Math.max(1, Number(days) || 7));
    const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.messageLog.findMany({
      where: {
        status: MessageStatus.FAILED,
        createdAt: { gte: since },
        errorMessage: { not: null },
      },
      select: {
        id: true,
        errorMessage: true,
        channelType: true,
        projectId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const map = new Map<
      string,
      { key: string; count: number; sampleIds: string[]; sampleError: string }
    >();
    for (const log of logs) {
      const key = normalizeErrorCluster(log.errorMessage);
      const row = map.get(key) || {
        key,
        count: 0,
        sampleIds: [] as string[],
        sampleError: log.errorMessage || '',
      };
      row.count += 1;
      if (row.sampleIds.length < 5) row.sampleIds.push(log.id);
      map.set(key, row);
    }
    return {
      days: d,
      totalFailed: logs.length,
      clusters: Array.from(map.values()).sort((a, b) => b.count - a.count),
    };
  }
}
