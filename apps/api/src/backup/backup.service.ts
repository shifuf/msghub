import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateApiKey, hashApiKey, apiKeyPrefix } from '../common/utils';
import { AdapterRegistry } from '../adapters/adapters.registry';

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private prisma: PrismaService,
    private adapters: AdapterRegistry,
  ) {}

  async exportConfig() {
    const [
      channels,
      projects,
      emailTemplates,
      pushTemplates,
      systemSettings,
      emailSuppress,
      schedules,
      eventDefinitions,
    ] = await Promise.all([
      this.prisma.channel.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.project.findMany({
        orderBy: { name: 'asc' },
        include: {
          bindings: {
            include: { channel: { select: { id: true, name: true, type: true } } },
          },
        },
      }),
      this.prisma.emailTemplate.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.pushTemplate.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.systemSetting.findMany(),
      this.prisma.emailSuppress.findMany({ orderBy: { createdAt: 'desc' }, take: 5000 }),
      this.prisma.scheduledMessage.findMany({
        where: { status: 'PENDING' },
        orderBy: { runAt: 'asc' },
      }),
      this.prisma.eventDefinition.findMany({ orderBy: { code: 'asc' } }),
    ]);

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      channels: channels.map((c) => ({
        name: c.name,
        type: c.type,
        config: c.config,
        enabled: c.enabled,
        isDefault: c.isDefault,
      })),
      projects: projects.map((p) => ({
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        adminEmail: p.adminEmail,
        alertFailRatePct: p.alertFailRatePct,
        alertWindowMin: p.alertWindowMin,
        dailyEmailQuota: p.dailyEmailQuota,
        emailFailSuppressCount: p.emailFailSuppressCount,
        alertCooldownMin: p.alertCooldownMin,
        quietHoursEnabled: p.quietHoursEnabled,
        quietStart: p.quietStart,
        quietEnd: p.quietEnd,
        quietTimezone: p.quietTimezone,
        rateLimitPerMin: p.rateLimitPerMin,
        idempotencyTtlMin: p.idempotencyTtlMin,
        // 不导出 apiKeyHash；bindings 用渠道 name 引用
        bindings: p.bindings.map((b) => ({
          channelName: b.channel?.name,
          channelType: b.channel?.type,
          enabled: b.enabled,
          isDefault: b.isDefault,
          isBackup: b.isBackup,
          priority: b.priority,
        })),
      })),
      emailTemplates: emailTemplates.map((t) => ({
        projectName: projects.find((p) => p.id === t.projectId)?.name || null,
        code: t.code,
        name: t.name,
        subject: t.subject,
        htmlBody: t.htmlBody,
        textBody: t.textBody,
        variables: t.variables,
        isSystem: t.isSystem,
        enabled: t.enabled,
      })),
      pushTemplates: pushTemplates.map((t) => ({
        projectName: projects.find((p) => p.id === t.projectId)?.name || null,
        code: t.code,
        name: t.name,
        titleTpl: t.titleTpl,
        contentTpl: t.contentTpl,
        variables: t.variables,
        enabled: t.enabled,
      })),
      systemSettings: systemSettings.map((s) => ({ key: s.key, value: s.value })),
      emailSuppress: emailSuppress.map((s) => ({
        projectName: s.projectId
          ? projects.find((p) => p.id === s.projectId)?.name || null
          : null,
        address: s.address,
        reason: s.reason,
        source: s.source,
        expiresAt: s.expiresAt,
      })),
      schedules: schedules.map((s) => ({
        projectName: projects.find((p) => p.id === s.projectId)?.name || null,
        kind: s.kind,
        title: s.title,
        content: s.content,
        html: s.html,
        toAddress: s.toAddress,
        templateCode: s.templateCode,
        variables: s.variables,
        runAt: s.runAt,
        cron: s.cron,
      })),
      eventDefinitions: eventDefinitions.map((e) => ({
        projectName: e.projectId
          ? projects.find((p) => p.id === e.projectId)?.name || null
          : null,
        code: e.code,
        name: e.name,
        description: e.description,
        defaultPriority: e.defaultPriority,
        pushTemplateCode: e.pushTemplateCode,
        emailTemplateCode: e.emailTemplateCode,
        enabled: e.enabled,
        isSystem: e.isSystem,
      })),
    };
  }

  async importConfig(body: any) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('无效的导入数据');
    }

    const result = {
      channels: { created: 0, updated: 0, skipped: 0 },
      projects: { created: 0, updated: 0 },
      emailTemplates: { created: 0, updated: 0 },
      pushTemplates: { created: 0, updated: 0 },
      bindings: { created: 0, updated: 0 },
      systemSettings: { upserted: 0 },
      emailSuppress: { created: 0 },
      eventDefinitions: { created: 0, updated: 0 },
      schedules: { created: 0 },
    };

    // 1) channels by name+type
    const channelMap = new Map<string, string>(); // `${name}::${type}` -> id
    const existingChannels = await this.prisma.channel.findMany();
    for (const c of existingChannels) {
      channelMap.set(`${c.name}::${c.type}`, c.id);
    }

    for (const ch of body.channels || []) {
      if (!ch?.name || !ch?.type) continue;
      const key = `${ch.name}::${ch.type}`;
      const cfg = (ch.config || {}) as Record<string, unknown>;
      // 导入时校验配置，非法渠道跳过，避免写入危险/坏配置
      try {
        const adapter = this.adapters.get(ch.type as ChannelType);
        adapter.validateConfig(cfg);
      } catch (e: any) {
        this.logger.warn(
          `backup import skip channel ${ch.name}/${ch.type}: ${e?.message || e}`,
        );
        result.channels.skipped++;
        continue;
      }
      const existingId = channelMap.get(key);
      if (existingId) {
        await this.prisma.channel.update({
          where: { id: existingId },
          data: {
            config: cfg as any,
            enabled: ch.enabled ?? true,
            isDefault: ch.isDefault ?? false,
          },
        });
        result.channels.updated++;
      } else {
        const created = await this.prisma.channel.create({
          data: {
            name: String(ch.name).trim(),
            type: ch.type as ChannelType,
            config: cfg as any,
            enabled: ch.enabled ?? true,
            isDefault: ch.isDefault ?? false,
          },
        });
        channelMap.set(key, created.id);
        result.channels.created++;
      }
    }

    // 2) projects by name
    const projectMap = new Map<string, string>(); // name -> id
    const existingProjects = await this.prisma.project.findMany();
    for (const p of existingProjects) {
      projectMap.set(p.name, p.id);
    }

    for (const proj of body.projects || []) {
      if (!proj?.name) continue;
      const name = String(proj.name).trim();
      let projectId = projectMap.get(name);
      if (projectId) {
        await this.prisma.project.update({
          where: { id: projectId },
          data: {
            description: proj.description ?? undefined,
            enabled: proj.enabled ?? undefined,
            adminEmail: proj.adminEmail === undefined ? undefined : proj.adminEmail,
            alertFailRatePct:
              proj.alertFailRatePct === undefined ? undefined : proj.alertFailRatePct,
            alertWindowMin:
              proj.alertWindowMin === undefined ? undefined : proj.alertWindowMin,
            dailyEmailQuota:
              proj.dailyEmailQuota === undefined ? undefined : proj.dailyEmailQuota,
            emailFailSuppressCount:
              proj.emailFailSuppressCount === undefined
                ? undefined
                : proj.emailFailSuppressCount,
            alertCooldownMin:
              proj.alertCooldownMin === undefined ? undefined : proj.alertCooldownMin,
            quietHoursEnabled:
              proj.quietHoursEnabled === undefined ? undefined : proj.quietHoursEnabled,
            quietStart: proj.quietStart === undefined ? undefined : proj.quietStart,
            quietEnd: proj.quietEnd === undefined ? undefined : proj.quietEnd,
            quietTimezone:
              proj.quietTimezone === undefined ? undefined : proj.quietTimezone,
            rateLimitPerMin:
              proj.rateLimitPerMin === undefined ? undefined : proj.rateLimitPerMin,
            idempotencyTtlMin:
              proj.idempotencyTtlMin === undefined ? undefined : proj.idempotencyTtlMin,
          },
        });
        result.projects.updated++;
      } else {
        const apiKey = generateApiKey();
        const hash = hashApiKey(apiKey);
        const prefix = apiKeyPrefix(apiKey);
        const created = await this.prisma.project.create({
          data: {
            name,
            description: proj.description || null,
            enabled: proj.enabled ?? true,
            adminEmail: proj.adminEmail || null,
            alertFailRatePct: proj.alertFailRatePct ?? null,
            alertWindowMin: proj.alertWindowMin ?? 60,
            dailyEmailQuota: proj.dailyEmailQuota ?? null,
            emailFailSuppressCount: proj.emailFailSuppressCount ?? 5,
            alertCooldownMin: proj.alertCooldownMin ?? 10,
            quietHoursEnabled: proj.quietHoursEnabled ?? false,
            quietStart: proj.quietStart || null,
            quietEnd: proj.quietEnd || null,
            quietTimezone: proj.quietTimezone || 'Asia/Shanghai',
            rateLimitPerMin: proj.rateLimitPerMin ?? null,
            idempotencyTtlMin: proj.idempotencyTtlMin ?? 30,
            apiKeyHash: hash,
            apiKeyPrefix: prefix,
            apiKeys: {
              create: {
                name: 'default',
                apiKeyHash: hash,
                apiKeyPrefix: prefix,
              },
            },
          },
        });
        projectId = created.id;
        projectMap.set(name, projectId);
        result.projects.created++;
      }

      // bindings
      for (const b of proj.bindings || []) {
        if (!b?.channelName || !b?.channelType) continue;
        const channelId = channelMap.get(`${b.channelName}::${b.channelType}`);
        if (!channelId) continue;
        const existing = await this.prisma.projectChannel.findUnique({
          where: {
            projectId_channelId: { projectId, channelId },
          },
        });
        if (existing) {
          await this.prisma.projectChannel.update({
            where: { id: existing.id },
            data: {
              enabled: b.enabled ?? true,
              isDefault: b.isDefault ?? false,
              isBackup: b.isBackup ?? false,
              priority: b.priority ?? existing.priority ?? 100,
            },
          });
          result.bindings.updated++;
        } else {
          await this.prisma.projectChannel.create({
            data: {
              projectId,
              channelId,
              enabled: b.enabled ?? true,
              isDefault: b.isDefault ?? false,
              isBackup: b.isBackup ?? false,
              priority: b.priority ?? 100,
            },
          });
          result.bindings.created++;
        }
      }
    }

    // 3) email templates by code + project
    for (const t of body.emailTemplates || []) {
      if (!t?.code || !t?.name) continue;
      const projectId = t.projectName ? projectMap.get(String(t.projectName).trim()) || null : null;
      const existing = await this.prisma.emailTemplate.findFirst({
        where: { projectId, code: String(t.code).trim() },
      });
      if (existing) {
        await this.prisma.emailTemplate.update({
          where: { id: existing.id },
          data: {
            name: t.name,
            subject: t.subject,
            htmlBody: t.htmlBody,
            textBody: t.textBody ?? null,
            variables: t.variables ?? [],
            enabled: t.enabled ?? true,
          },
        });
        result.emailTemplates.updated++;
      } else {
        await this.prisma.emailTemplate.create({
          data: {
            projectId,
            code: String(t.code).trim(),
            name: t.name,
            subject: t.subject || '',
            htmlBody: t.htmlBody || '',
            textBody: t.textBody || null,
            variables: t.variables || [],
            isSystem: !projectId,
            enabled: t.enabled ?? true,
          },
        });
        result.emailTemplates.created++;
      }
    }

    // 4) push templates
    for (const t of body.pushTemplates || []) {
      if (!t?.code || !t?.name) continue;
      const projectId = t.projectName ? projectMap.get(String(t.projectName).trim()) || null : null;
      const existing = await this.prisma.pushTemplate.findFirst({
        where: { projectId, code: String(t.code).trim() },
      });
      if (existing) {
        await this.prisma.pushTemplate.update({
          where: { id: existing.id },
          data: {
            name: t.name,
            titleTpl: t.titleTpl ?? '',
            contentTpl: t.contentTpl || '',
            variables: t.variables ?? [],
            enabled: t.enabled ?? true,
          },
        });
        result.pushTemplates.updated++;
      } else {
        await this.prisma.pushTemplate.create({
          data: {
            projectId,
            code: String(t.code).trim(),
            name: t.name,
            titleTpl: t.titleTpl ?? '',
            contentTpl: t.contentTpl || '',
            variables: t.variables || [],
            enabled: t.enabled ?? true,
          },
        });
        result.pushTemplates.created++;
      }
    }

    // 5) system settings
    for (const s of body.systemSettings || []) {
      if (!s?.key) continue;
      await this.prisma.systemSetting.upsert({
        where: { key: String(s.key) },
        create: { key: String(s.key), value: String(s.value ?? '') },
        update: { value: String(s.value ?? '') },
      });
      result.systemSettings.upserted++;
    }

    // 6) email suppress（Postgres 复合唯一键里 NULL 不互等，全局行不能靠 upsert projectId=null）
    for (const s of body.emailSuppress || []) {
      if (!s?.address) continue;
      const address = String(s.address).trim().toLowerCase();
      const projectId = s.projectName
        ? projectMap.get(String(s.projectName).trim()) || null
        : null;
      try {
        const existing = await this.prisma.emailSuppress.findFirst({
          where: projectId
            ? { projectId, address }
            : { projectId: null, address },
        });
        if (existing) {
          await this.prisma.emailSuppress.update({
            where: { id: existing.id },
            data: {
              reason: s.reason || null,
              source: s.source || 'MANUAL',
              expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
            },
          });
        } else {
          await this.prisma.emailSuppress.create({
            data: {
              projectId,
              address,
              reason: s.reason || null,
              source: s.source || 'MANUAL',
              expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
            },
          });
        }
        result.emailSuppress.created++;
      } catch {
        /* skip invalid rows */
      }
    }

    // 7) event definitions
    for (const e of body.eventDefinitions || []) {
      if (!e?.code || !e?.name) continue;
      const projectId = e.projectName
        ? projectMap.get(String(e.projectName).trim()) || null
        : null;
      const existing = await this.prisma.eventDefinition.findFirst({
        where: { projectId, code: String(e.code).trim() },
      });
      if (existing) {
        await this.prisma.eventDefinition.update({
          where: { id: existing.id },
          data: {
            name: e.name,
            description: e.description ?? null,
            defaultPriority: e.defaultPriority || existing.defaultPriority,
            pushTemplateCode: e.pushTemplateCode ?? null,
            emailTemplateCode: e.emailTemplateCode ?? null,
            enabled: e.enabled ?? true,
          },
        });
        result.eventDefinitions.updated++;
      } else {
        await this.prisma.eventDefinition.create({
          data: {
            projectId,
            code: String(e.code).trim(),
            name: e.name,
            description: e.description || null,
            defaultPriority: e.defaultPriority || 'NORMAL',
            pushTemplateCode: e.pushTemplateCode || null,
            emailTemplateCode: e.emailTemplateCode || null,
            enabled: e.enabled ?? true,
            isSystem: !!e.isSystem && !projectId,
          },
        });
        result.eventDefinitions.created++;
      }
    }

    // 8) pending schedules (best-effort)
    for (const s of body.schedules || []) {
      if (!s?.projectName) continue;
      const projectId = projectMap.get(String(s.projectName).trim());
      if (!projectId || !s.runAt) continue;
      const runAt = new Date(s.runAt);
      if (Number.isNaN(runAt.getTime()) || runAt.getTime() < Date.now()) continue;
      await this.prisma.scheduledMessage.create({
        data: {
          projectId,
          kind: s.kind || 'push',
          title: s.title || null,
          content: s.content || null,
          html: s.html || null,
          toAddress: s.toAddress || null,
          templateCode: s.templateCode || null,
          variables: (s.variables || null) as any,
          runAt,
          cron: s.cron || null,
          status: 'PENDING',
        },
      });
      result.schedules.created++;
    }

    this.logger.log(`backup import done: ${JSON.stringify(result)}`);
    return result;
  }
}
