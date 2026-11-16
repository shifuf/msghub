import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async log(opts: {
    action: string;
    resource?: string;
    resourceId?: string;
    resourceName?: string;
    detail?: Record<string, unknown>;
  }) {
    try {
      await this.prisma.activityLog.create({
        data: {
          action: opts.action,
          resource: opts.resource,
          resourceId: opts.resourceId,
          resourceName: opts.resourceName,
          detail: (opts.detail || {}) as any,
        },
      });
    } catch (e) {
      console.warn('activity log failed', e);
    }
  }

  async list(query: {
    action?: string;
    resource?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where: Prisma.ActivityLogWhereInput = {};
    if (query.action) where.action = { contains: query.action };
    if (query.resource) where.resource = query.resource;

    const [total, items] = await Promise.all([
      this.prisma.activityLog.count({ where }),
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items, total, page, pageSize };
  }

  async clear(opts: { action?: string; resource?: string; before?: string; dryRun?: boolean } = {}) {
    const where: Prisma.ActivityLogWhereInput = {};
    if (opts.action) where.action = { contains: opts.action };
    if (opts.resource) where.resource = opts.resource;
    if (opts.before !== undefined) {
      const d = new Date(opts.before);
      if (!opts.before || Number.isNaN(d.getTime())) throw new BadRequestException('清理日期无效');
      where.createdAt = { lt: d };
    }
    if (opts.dryRun) return { matched: await this.prisma.activityLog.count({ where }), deleted: 0 };
    const result = await this.prisma.activityLog.deleteMany({ where });
    return { deleted: result.count };
  }
}
