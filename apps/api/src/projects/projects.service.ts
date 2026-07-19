import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { apiKeyPrefix, generateApiKey, hashApiKey, isValidEmail } from '../common/utils';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private activity: ActivityService) {}

  private map(p: any) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      apiKey: `${p.apiKeyPrefix}****`,
      apiKeyPrefix: p.apiKeyPrefix,
      enabled: p.enabled,
      adminEmail: p.adminEmail ?? null,
      alertFailRatePct: p.alertFailRatePct ?? null,
      alertWindowMin: p.alertWindowMin ?? 60,
      lastFailAlertAt: p.lastFailAlertAt ?? null,
      dailyEmailQuota: p.dailyEmailQuota ?? null,
      emailFailSuppressCount: p.emailFailSuppressCount ?? 5,
      alertCooldownMin: p.alertCooldownMin ?? 10,
      quietHoursEnabled: p.quietHoursEnabled ?? false,
      quietStart: p.quietStart ?? null,
      quietEnd: p.quietEnd ?? null,
      quietTimezone: p.quietTimezone ?? 'Asia/Shanghai',
      rateLimitPerMin: p.rateLimitPerMin ?? null,
      idempotencyTtlMin: p.idempotencyTtlMin ?? 30,
      unreadEmailFallbackEnabled: p.unreadEmailFallbackEnabled ?? false,
      unreadEmailFallbackHours: p.unreadEmailFallbackHours ?? 24,
      unreadEmailTemplateCode: p.unreadEmailTemplateCode ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      _count: p._count
        ? {
            channels: p._count.bindings ?? p._count.channels ?? 0,
            messages: p._count.messages ?? 0,
            templates: p._count.templates ?? 0,
          }
        : undefined,
    };
  }

  /** 项目邮箱优先，否则全局管理员邮箱 */
  async resolveAdminEmail(projectId: string): Promise<string | null> {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { adminEmail: true },
    });
    const projectEmail = (p?.adminEmail || '').trim();
    if (projectEmail) return projectEmail;
    const global = await this.prisma.systemSetting.findUnique({
      where: { key: 'globalAdminEmail' },
    });
    const g = (global?.value || '').trim();
    return g || null;
  }

  async getGlobalAdminEmail() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'globalAdminEmail' },
    });
    return { globalAdminEmail: row?.value || '' };
  }

  async setGlobalAdminEmail(email: string) {
    const value = (email || '').trim();
    if (value && !isValidEmail(value)) {
      throw new BadRequestException('全局管理员邮箱格式无效');
    }
    await this.prisma.systemSetting.upsert({
      where: { key: 'globalAdminEmail' },
      create: { key: 'globalAdminEmail', value },
      update: { value },
    });
    return { globalAdminEmail: value };
  }

  async list() {
    const rows = await this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { bindings: true, messages: true } } },
    });
    return rows.map((p) => this.map(p));
  }

  async get(id: string) {
    const p = await this.prisma.project.findUnique({
      where: { id },
      include: {
        _count: { select: { bindings: true, messages: true, templates: true } },
        bindings: {
          include: { channel: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        },
        apiKeys: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            apiKeyPrefix: true,
            enabled: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!p) throw new NotFoundException('项目不存在');
    return {
      ...this.map(p),
      apiKeys: (p as any).apiKeys || [],
      bindings: (p as any).bindings?.map((b: any) => ({
        id: b.id,
        channelId: b.channelId,
        enabled: b.enabled,
        isDefault: b.isDefault,
        isBackup: b.isBackup,
        priority: b.priority,
        channel: b.channel
          ? {
              id: b.channel.id,
              name: b.channel.name,
              type: b.channel.type,
              enabled: b.channel.enabled,
              lastHealthOk: b.channel.lastHealthOk,
              lastHealthAt: b.channel.lastHealthAt,
              lastHealthError: b.channel.lastHealthError,
            }
          : null,
      })),
    };
  }

  async create(data: { name: string; description?: string }) {
    if (!data.name?.trim()) throw new BadRequestException('项目名称不能为空');
    const apiKey = generateApiKey();
    const hash = hashApiKey(apiKey);
    const prefix = apiKeyPrefix(apiKey);
    const p = await this.prisma.project.create({
      data: {
        name: data.name.trim(),
        description: data.description?.trim() || null,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        apiKeys: {
          create: {
            name: 'default',
            apiKeyHash: hash,
            apiKeyPrefix: prefix,
            enabled: true,
          },
        },
      },
    });
    await this.bindDefaultInbox(p.id);
    return { ...this.map(p), apiKey };
  }

  private async bindDefaultInbox(projectId: string) {
    const inbox =
      (await this.prisma.channel.findFirst({
        where: { type: 'INBOX', enabled: true, isDefault: true },
        orderBy: { createdAt: 'asc' },
      })) ||
      (await this.prisma.channel.findFirst({
        where: { type: 'INBOX', enabled: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!inbox) return;
    await this.prisma.projectChannel.upsert({
      where: {
        projectId_channelId: { projectId, channelId: inbox.id },
      },
      create: {
        projectId,
        channelId: inbox.id,
        enabled: true,
        isDefault: true,
        isBackup: false,
        priority: 0,
      },
      update: {
        enabled: true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      enabled?: boolean;
      adminEmail?: string | null;
      alertFailRatePct?: number | null;
      alertWindowMin?: number;
      dailyEmailQuota?: number | null;
      emailFailSuppressCount?: number;
      alertCooldownMin?: number;
      quietHoursEnabled?: boolean;
      quietStart?: string | null;
      quietEnd?: string | null;
      quietTimezone?: string;
      rateLimitPerMin?: number | null;
      idempotencyTtlMin?: number;
      unreadEmailFallbackEnabled?: boolean;
      unreadEmailFallbackHours?: number;
      unreadEmailTemplateCode?: string | null;
    },
  ) {
    await this.get(id);
    let adminEmail: string | null | undefined = undefined;
    if (data.adminEmail !== undefined) {
      const v = (data.adminEmail || '').trim();
      if (v && !isValidEmail(v)) {
        throw new BadRequestException('项目管理员邮箱格式无效');
      }
      adminEmail = v || null;
    }
    let unreadEmailTemplateCode: string | null | undefined = undefined;
    if (data.unreadEmailTemplateCode !== undefined) {
      unreadEmailTemplateCode = (data.unreadEmailTemplateCode || '').trim() || null;
    }
    const p = await this.prisma.project.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        description: data.description === undefined ? undefined : data.description?.trim() || null,
        enabled: data.enabled,
        adminEmail,
        alertFailRatePct:
          data.alertFailRatePct === undefined
            ? undefined
            : data.alertFailRatePct === null
              ? null
              : Number(data.alertFailRatePct),
        alertWindowMin:
          data.alertWindowMin === undefined
            ? undefined
            : Math.max(1, Number(data.alertWindowMin) || 60),
        dailyEmailQuota:
          data.dailyEmailQuota === undefined
            ? undefined
            : data.dailyEmailQuota === null
              ? null
              : Math.max(0, Number(data.dailyEmailQuota) || 0),
        emailFailSuppressCount:
          data.emailFailSuppressCount === undefined
            ? undefined
            : Math.max(0, Number(data.emailFailSuppressCount) || 0),
        alertCooldownMin:
          data.alertCooldownMin === undefined
            ? undefined
            : Math.max(0, Number(data.alertCooldownMin) || 0),
        quietHoursEnabled: data.quietHoursEnabled,
        quietStart:
          data.quietStart === undefined
            ? undefined
            : (data.quietStart || '').trim() || null,
        quietEnd:
          data.quietEnd === undefined ? undefined : (data.quietEnd || '').trim() || null,
        quietTimezone: data.quietTimezone?.trim() || undefined,
        rateLimitPerMin:
          data.rateLimitPerMin === undefined
            ? undefined
            : data.rateLimitPerMin === null
              ? null
              : Math.max(0, Number(data.rateLimitPerMin) || 0),
        idempotencyTtlMin:
          data.idempotencyTtlMin === undefined
            ? undefined
            : Math.max(1, Number(data.idempotencyTtlMin) || 30),
        unreadEmailFallbackEnabled: data.unreadEmailFallbackEnabled,
        unreadEmailFallbackHours:
          data.unreadEmailFallbackHours === undefined
            ? undefined
            : Math.max(1, Math.min(43200, Number(data.unreadEmailFallbackHours) || 60)),
        unreadEmailTemplateCode,
      },
    });
    return this.map(p);
  }

  async remove(id: string) {
    const p = await this.get(id);
    await this.prisma.project.delete({ where: { id } });
    await this.activity.log({
      action: 'project.delete',
      resource: 'Project',
      resourceId: id,
      resourceName: p.name,
    });
    return { deleted: true };
  }

  async resetKey(id: string) {
    await this.get(id);
    const apiKey = generateApiKey();
    const hash = hashApiKey(apiKey);
    const prefix = apiKeyPrefix(apiKey);
    const p = await this.prisma.project.update({
      where: { id },
      data: {
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
      },
    });
    // 同步 default 命名 key（若存在则轮换）
    const existing = await this.prisma.projectApiKey.findUnique({
      where: { projectId_name: { projectId: id, name: 'default' } },
    });
    if (existing) {
      await this.prisma.projectApiKey.update({
        where: { id: existing.id },
        data: { apiKeyHash: hash, apiKeyPrefix: prefix, enabled: true, expiresAt: null },
      });
    } else {
      await this.prisma.projectApiKey.create({
        data: {
          projectId: id,
          name: 'default',
          apiKeyHash: hash,
          apiKeyPrefix: prefix,
          enabled: true,
        },
      });
    }
    return { id: p.id, apiKey };
  }

  async listKeys(projectId: string) {
    await this.get(projectId);
    return this.prisma.projectApiKey.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        apiKeyPrefix: true,
        enabled: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async createKey(projectId: string, name: string, expiresAt?: string) {
    await this.get(projectId);
    const n = (name || '').trim();
    if (!n) throw new BadRequestException('密钥名称不能为空');
    let exp: Date | null = null;
    if (expiresAt) {
      exp = new Date(expiresAt);
      if (Number.isNaN(exp.getTime())) throw new BadRequestException('expiresAt 无效');
    }
    const apiKey = generateApiKey();
    try {
      const row = await this.prisma.projectApiKey.create({
        data: {
          projectId,
          name: n,
          apiKeyHash: hashApiKey(apiKey),
          apiKeyPrefix: apiKeyPrefix(apiKey),
          enabled: true,
          expiresAt: exp,
        },
      });
      return {
        id: row.id,
        name: row.name,
        apiKey,
        apiKeyPrefix: row.apiKeyPrefix,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      };
    } catch {
      throw new BadRequestException('密钥名称已存在');
    }
  }

  async revokeKey(projectId: string, keyId: string) {
    const row = await this.prisma.projectApiKey.findFirst({
      where: { id: keyId, projectId },
    });
    if (!row) throw new NotFoundException('密钥不存在');
    await this.prisma.projectApiKey.update({
      where: { id: keyId },
      data: { enabled: false },
    });
    // 若与项目兼容字段同一 hash，作废兼容入口，避免「吊销后仍可用」
    await this.invalidateLegacyHashIfMatch(projectId, row.apiKeyHash);
    return { id: keyId, enabled: false };
  }

  async deleteKey(projectId: string, keyId: string) {
    const row = await this.prisma.projectApiKey.findFirst({
      where: { id: keyId, projectId },
    });
    if (!row) throw new NotFoundException('密钥不存在');
    await this.invalidateLegacyHashIfMatch(projectId, row.apiKeyHash);
    await this.prisma.projectApiKey.delete({ where: { id: keyId } });
    return { deleted: true };
  }

  /** 吊销/删除 key 时同步作废 Project.apiKeyHash 兼容入口 */
  private async invalidateLegacyHashIfMatch(projectId: string, hash: string) {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKeyHash: true },
    });
    if (p?.apiKeyHash === hash) {
      // 写入不可用占位，避免旧明文 key 仍能 findByApiKey 命中
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          apiKeyHash: `revoked_${hash}`,
          apiKeyPrefix: 'revoked_',
        },
      });
    }
  }

  async findByApiKey(apiKey: string) {
    if (!apiKey) return null;
    const hash = hashApiKey(apiKey);
    const keyRow = await this.prisma.projectApiKey.findUnique({
      where: { apiKeyHash: hash },
      include: { project: true },
    });
    if (keyRow) {
      if (!keyRow.enabled) return null;
      if (keyRow.expiresAt && keyRow.expiresAt.getTime() < Date.now()) return null;
      if (!keyRow.project?.enabled) return null;
      void this.prisma.projectApiKey
        .update({ where: { id: keyRow.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
      return keyRow.project;
    }
    // 兼容旧单 key（仅当 Project.apiKeyHash 仍是有效 hash，未被 revoke 占位）
    const legacy = await this.prisma.project.findUnique({
      where: { apiKeyHash: hash },
    });
    if (!legacy || !legacy.enabled) return null;
    if (String(legacy.apiKeyHash).startsWith('revoked_')) return null;
    return legacy;
  }

  async inboundErrors(projectId: string, limit = 20) {
    await this.get(projectId);
    return this.prisma.messageLog.findMany({
      where: {
        projectId,
        source: 'OPEN_API',
        status: 'FAILED',
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true,
        title: true,
        errorMessage: true,
        channelType: true,
        createdAt: true,
        eventCode: true,
      },
    });
  }
}
