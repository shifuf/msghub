import { BadRequestException, Injectable } from '@nestjs/common';
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
      this.prisma.messageLog.count({ where: { readAt: null, archivedAt: null } }),
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

  async notifications(since?: string, limit = 20, cursor?: string) {
    const take = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    // Capture before querying so updates racing this page are covered by the next delta.
    const serverTime = new Date().toISOString();
    const delta = !!(since || cursor);
    const where: any = delta ? {} : { archivedAt: null };
    if (since) {
      const d = new Date(since);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('since 日期无效');
      where.updatedAt = { gte: d };
    }
    if (cursor) {
      try {
        if (cursor.length > 1000) throw Error();
        const [time, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        const d = new Date(time);
        if (!Number.isFinite(d.getTime()) || typeof id !== 'string' || !id) throw Error();
        delete where.updatedAt;
        where.OR = [{ updatedAt: { gt: d } }, { updatedAt: d, id: { gt: id } }];
      } catch { throw new BadRequestException('通知游标无效'); }
    }

    const [items, pending, failed24h, unreadCount] = await Promise.all([
      this.prisma.messageLog.findMany({
        where,
        orderBy: delta ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
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
      this.prisma.messageLog.count({ where: { readAt: null, archivedAt: null } }),
    ]);

    const page = items.slice(0, take);
    const last = page[page.length - 1];
    return {
      items: page,
      pending,
      failed24h,
      hasMore: delta && items.length > take,
      unreadCount,
      nextCursor: delta && items.length > take && last ? Buffer.from(JSON.stringify([last.updatedAt.toISOString(), last.id])).toString('base64url') : null,
      serverTime,
    };
  }

  async charts(days = 7) {
    const d = Math.min(30, Math.max(1, Math.floor(Number(days) || 7)));
    // All replicas use UTC calendar boundaries; aggregate in PostgreSQL, never load message bodies.
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (d - 1));
    const [daily, byChannel, byProject, metricRows] = await Promise.all([
      this.prisma.$queryRaw<any[]>`SELECT to_char("createdAt", 'YYYY-MM-DD') AS date,
        count(*)::int AS total, count(*) FILTER (WHERE status='SUCCESS')::int AS success,
        count(*) FILTER (WHERE status='FAILED')::int AS failed,
        count(*) FILTER (WHERE status NOT IN ('SUCCESS','FAILED'))::int AS pending
        FROM "MessageLog" WHERE "createdAt">=${start} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<any[]>`SELECT COALESCE("channelType"::text,'UNKNOWN') AS type, count(*)::int AS count
        FROM "MessageLog" WHERE "createdAt">=${start} GROUP BY 1 ORDER BY count DESC`,
      this.prisma.$queryRaw<any[]>`SELECT m."projectId", COALESCE(p.name,'未归属') AS name, count(*)::int AS count,
        count(*) FILTER (WHERE m.status='SUCCESS')::int AS success,
        count(*) FILTER (WHERE m.status='FAILED')::int AS failed,
        count(*) FILTER (WHERE m."deliveredAt" IS NOT NULL AND m."channelType"<>'INBOX')::int AS delivered,
        count(*) FILTER (WHERE m."fallbackSentAt" IS NOT NULL OR m."parentId" IS NOT NULL)::int AS fallback,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (m."deliveredAt"-m."createdAt"))*1000)
          FILTER (WHERE m."deliveredAt" IS NOT NULL AND m."channelType"<>'INBOX') AS "latencyP95Ms"
        FROM "MessageLog" m LEFT JOIN "Project" p ON p.id=m."projectId"
        WHERE m."createdAt">=${start} GROUP BY m."projectId",p.name ORDER BY count DESC LIMIT 10`,
      this.prisma.$queryRaw<any[]>`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status='SUCCESS')::int AS success,
        count(*) FILTER (WHERE "channelType"<>'INBOX' AND "deliveredAt" IS NOT NULL)::int AS delivered,
        count(*) FILTER (WHERE "channelType"<>'INBOX')::int AS "externalAttempts",
        count(*) FILTER (WHERE "channelType"='INBOX' AND status='SUCCESS')::int AS "inboxAccepted",
        count(*) FILTER (WHERE "fallbackSentAt" IS NOT NULL OR "parentId" IS NOT NULL)::int AS fallback,
        count(*) FILTER (WHERE status='PENDING' AND "createdAt"<now()-interval '5 minutes')::int AS "stalePending",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("deliveredAt"-"createdAt"))*1000)
          FILTER (WHERE "deliveredAt" IS NOT NULL AND "channelType"<>'INBOX') AS "latencyP95Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("deliveryStartedAt"-"createdAt"))*1000)
          FILTER (WHERE "deliveryStartedAt" IS NOT NULL) AS "queueWaitP95Ms"
        FROM "MessageLog" WHERE "createdAt">=${start}`,
    ]);
    const dayKeys: string[] = [];
    for (let i = 0; i < d; i++) {
      const dt = new Date(start);
      dt.setUTCDate(start.getUTCDate() + i);
      dayKeys.push(dt.toISOString().slice(0, 10));
    }
    const trendMap = new Map(daily.map(row => [row.date, row]));
    const trend = dayKeys.map(date => trendMap.get(date) || { date, success: 0, failed: 0, pending: 0, total: 0 });
    const metrics = metricRows[0];
    metrics.externalSuccessRate = metrics.externalAttempts ? Math.round(metrics.delivered / metrics.externalAttempts * 1000) / 10 : 0;
    metrics.fallbackRate = metrics.total ? Math.round(metrics.fallback / metrics.total * 1000) / 10 : 0;
    return {
      days: d,
      timezone: 'UTC',
      since: start.toISOString(),
      total: metrics.total,
      successRate: metrics.total ? Math.round(metrics.success / metrics.total * 1000) / 10 : 0,
      metrics,
      trend,
      byChannel,
      byProject,
    };
  }

  async errorClusters(days = 7) {
    const d = Math.min(30, Math.max(1, Number(days) || 7));
    const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const failureWhere = {status: MessageStatus.FAILED, createdAt: { gte: since }, errorMessage: { not: null }};
    const [logs, totalFailed] = await Promise.all([this.prisma.messageLog.findMany({
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
    }), this.prisma.messageLog.count({ where: failureWhere })]);
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
      totalFailed,
      sampleSize: logs.length,
      sampled: totalFailed > logs.length,
      clusters: Array.from(map.values()).sort((a, b) => b.count - a.count),
    };
  }
}
