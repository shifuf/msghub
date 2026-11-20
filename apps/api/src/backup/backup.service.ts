import { Injectable, BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify, isDeepStrictEqual } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import { generateApiKey, hashApiKey, apiKeyPrefix } from '../common/utils';
import { AdapterRegistry } from '../adapters/adapters.registry';
import { Prisma } from '@prisma/client';
import { validateScheduleRule, validateScheduleTimezone } from '../schedules/recurrence';

const deriveKey = promisify(scrypt);
const GROUPS = ['channels', 'projects', 'emailTemplates', 'pushTemplates', 'templateRevisions', 'systemSettings', 'emailSuppress', 'schedules', 'eventDefinitions', 'partners'] as const;
const MODELS = { channels: 'channel', projects: 'project', emailTemplates: 'emailTemplate', pushTemplates: 'pushTemplate', templateRevisions: 'templateRevision', systemSettings: 'systemSetting', emailSuppress: 'emailSuppress', schedules: 'scheduledMessage', eventDefinitions: 'eventDefinition', partners: 'partnerLink' };
const PROJECT_FIELDS = ['name', 'description', 'enabled', 'adminEmail', 'alertFailRatePct', 'alertWindowMin', 'dailyEmailQuota', 'emailFailSuppressCount', 'alertCooldownMin', 'quietHoursEnabled', 'quietStart', 'quietEnd', 'quietTimezone', 'rateLimitPerMin', 'idempotencyTtlMin', 'unreadEmailFallbackEnabled', 'unreadEmailFallbackHours', 'unreadEmailTemplateCode'];
const FIELDS: Record<string, string[]> = {
  channels: ['name', 'type', 'config', 'enabled', 'isDefault'], projects: PROJECT_FIELDS,
  emailTemplates: ['projectId', 'code', 'name', 'subject', 'htmlBody', 'textBody', 'variables', 'enabled', 'isSystem', 'draft', 'revision'],
  pushTemplates: ['projectId', 'code', 'name', 'titleTpl', 'contentTpl', 'variables', 'enabled', 'draft', 'revision'],
  templateRevisions: ['kind', 'templateId', 'revision', 'snapshot', 'createdAt'],
  systemSettings: ['key', 'value'], emailSuppress: ['projectId', 'address', 'reason', 'source', 'expiresAt'],
  schedules: ['projectId', 'channelId', 'channelType', 'kind', 'title', 'content', 'html', 'toAddress', 'templateCode', 'variables', 'runAt', 'cron', 'timezone'],
  eventDefinitions: ['projectId', 'code', 'name', 'description', 'defaultPriority', 'pushTemplateCode', 'emailTemplateCode', 'enabled', 'isSystem'],
  partners: ['name', 'url', 'logoUrl', 'description', 'displayOrder', 'enabled'],
};
// Only public/operator settings belong in configuration backups; session/TOTP secrets never do.
const SETTINGS = new Set(['siteName', 'siteIcp', 'sitePolice', 'sitePoliceUrl', 'siteCopyright', 'siteContactEmail', 'siteDescription', 'globalAdminEmail', 'healthProbeIntervalMin', 'messageRetentionDays', 'activityRetentionDays', 'sensitiveRetentionDays']);
const pick = (row: any, keys: string[]) => Object.fromEntries(keys.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
type Options = { password?: string; redact?: boolean };

@Injectable()
export class BackupService {
  constructor(private prisma: PrismaService, private adapters: AdapterRegistry) {}

  async exportConfig(options: Options = {}): Promise<any> {
    const body: any = { version: 3, exportedAt: new Date().toISOString(), redacted: !!options.redact, warnings: [] };
    for (const group of GROUPS) {
      const model = (this.prisma as any)[MODELS[group]];
      const rows = await model.findMany(group === 'projects' ? { include: { bindings: true } } : {});
      body[group] = rows.filter((row: any) => {
        if (group === 'templateRevisions') return (row.kind === 'email' ? body.emailTemplates : row.kind === 'push' ? body.pushTemplates : []).some((t: any) => t.id === row.templateId);
        if (group === 'systemSettings') return SETTINGS.has(row.key);
        if (group !== 'schedules') return true;
        const internal = row.kind === 'unread_email_fallback' || row.variables?.quietRelease || row.variables?.unreadEmailFallback;
        if (internal || !['PENDING', 'PAUSED'].includes(row.status)) {
          body.warnings.push(`未导出运行记录关联/终态任务 ${row.id}；完整灾备需要数据库与 Redis 备份`);
          return false;
        }
        return true;
      }).map((row: any) => {
        const result: Record<string, any> = { ...(group === 'systemSettings' ? {} : { id: row.id }), ...pick(row, FIELDS[group]) };
        if (group === 'projects') result.bindings = (row.bindings || []).map((b: any) => pick(b, ['channelId', 'enabled', 'isDefault', 'isBackup', 'priority']));
        if (group === 'schedules') result.status = row.status;
        if (group === 'channels' && options.redact) result.config = { redacted: true };
        return result;
      });
    }
    if (!options.password) return body;
    if (options.password.length < 12 || options.password.length > 1024) throw new BadRequestException('备份密码须为 12–1024 个字符');
    const salt = randomBytes(16), iv = randomBytes(12);
    const key = await deriveKey(options.password, salt, 32) as Buffer;
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('msghub-backup-v3'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
    return { version: 3, encrypted: true, algorithm: 'aes-256-gcm+scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }

  private async decode(input: any, options: Options) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('无效的备份对象');
    if (input.encrypted) {
      if (!options.password || options.password.length > 1024) throw new BadRequestException('请提供备份密码');
      try {
        if (input.version !== 3 || input.algorithm !== 'aes-256-gcm+scrypt') throw Error();
        const salt = Buffer.from(input.salt, 'base64'), iv = Buffer.from(input.iv, 'base64'), tag = Buffer.from(input.tag, 'base64');
        if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || typeof input.ciphertext !== 'string' || input.ciphertext.length > 28_000_000) throw Error();
        const key = await deriveKey(options.password, salt, 32) as Buffer;
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.from('msghub-backup-v3')); decipher.setAuthTag(tag);
        input = JSON.parse(Buffer.concat([decipher.update(Buffer.from(input.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
      } catch { throw new BadRequestException('备份密码错误或文件已损坏'); }
    }
    if (input.redacted) throw new BadRequestException('脱敏备份仅供审查，不能用于恢复凭据');
    if (input.version !== 3) throw new BadRequestException('仅支持稳定 ID 的 v3 备份；请在原实例升级后重新导出，旧版按名称恢复存在歧义');
    const body = JSON.parse(JSON.stringify(input));
    for (const group of GROUPS) {
      body[group] ??= [];
      if (!Array.isArray(body[group]) || body[group].length > 100_000) throw new BadRequestException(`${group} 必须是数组且不超过 100000 项`);
      const seen = new Set<string>();
      for (const row of body[group]) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new BadRequestException(`${group} 行无效`);
        const id = group === 'systemSettings' ? row.key : row.id;
        if (typeof id !== 'string' || !/^[\w.:-]{1,200}$/.test(id) || seen.has(id)) throw new BadRequestException(`${group} 存在无效或重复 ID`);
        seen.add(id);
      }
    }
    const projectIds = new Set(body.projects.map((p: any) => p.id));
    const channelIds = new Set(body.channels.map((c: any) => c.id));
    const historyKeys = new Set<string>();
    for (const history of body.templateRevisions) {
      const templates = history.kind === 'email' ? body.emailTemplates : history.kind === 'push' ? body.pushTemplates : [];
      const template = templates.find((t: any) => t.id === history.templateId);
      const key = JSON.stringify([history.kind, history.templateId, history.revision]);
      if (!template || !Number.isInteger(history.revision) || history.revision < 1 || history.revision >= (template.revision || 1) || !history.snapshot || typeof history.snapshot !== 'object' || Array.isArray(history.snapshot) || historyKeys.has(key)) throw new BadRequestException('模板历史引用或版本无效');
      historyKeys.add(key);
    }
    for (const group of ['emailTemplates', 'pushTemplates', 'emailSuppress', 'eventDefinitions', 'schedules']) {
      const naturalKeys = new Set<string>();
      for (const row of body[group]) {
        if ((row.projectId && !projectIds.has(row.projectId)) || (group === 'schedules' && !row.projectId)) throw new BadRequestException(`${group} 项目引用不存在`);
        if (row.channelId && !channelIds.has(row.channelId)) throw new BadRequestException('定时任务渠道引用不存在');
        if (group !== 'schedules') {
          const natural = JSON.stringify([row.projectId || null, row.code || row.address]);
          if (naturalKeys.has(natural)) throw new BadRequestException(`${group} 同一范围存在重复 code/address`);
          naturalKeys.add(natural);
        }
        if (group === 'schedules') {
          if (row.kind === 'unread_email_fallback' || row.variables?.quietRelease || row.variables?.unreadEmailFallback) throw new BadRequestException('不能导入依赖原消息记录的内部任务');
          if (!['push', 'email'].includes(row.kind || 'push') || !['PENDING', 'PAUSED'].includes(row.status || 'PAUSED')) throw new BadRequestException('任务类型或状态无效');
          if (!Number.isFinite(Date.parse(row.runAt))) throw new BadRequestException('任务 runAt 无效');
          validateScheduleRule(row.cron);
          validateScheduleTimezone(row.timezone);
        }
      }
    }
    for (const p of body.projects) {
      if (!p.name || typeof p.name !== 'string') throw new BadRequestException('项目名称不能为空');
      if (p.quietTimezone) { try { new Intl.DateTimeFormat('en', { timeZone: p.quietTimezone }); } catch { throw new BadRequestException('项目时区无效'); } }
      for (const key of ['dailyEmailQuota', 'rateLimitPerMin', 'unreadEmailFallbackHours', 'idempotencyTtlMin']) if (p[key] != null && (!Number.isInteger(p[key]) || p[key] < 0)) throw new BadRequestException(`项目 ${key} 无效`);
      if (!Array.isArray(p.bindings || [])) throw new BadRequestException('bindings 必须是数组');
      const bound = new Set();
      for (const b of p.bindings || []) { if (!channelIds.has(b.channelId) || bound.has(b.channelId)) throw new BadRequestException('绑定渠道引用不存在或重复'); bound.add(b.channelId); }
      if ((p.bindings || []).filter((b: any) => b.isDefault).length > 1) throw new BadRequestException('项目只能有一个默认渠道');
    }
    for (const row of [...body.emailTemplates, ...body.pushTemplates]) {
      if (row.revision !== undefined && (!Number.isInteger(row.revision) || row.revision < 1)) throw new BadRequestException('模板 revision 无效');
      if (row.draft != null && (typeof row.draft !== 'object' || Array.isArray(row.draft))) throw new BadRequestException('模板 draft 无效');
    }
    for (const ch of body.channels) {
      try { this.adapters.get(ch.type).validateConfig(ch.config || {}); } catch(e: any) { throw new BadRequestException(`渠道 ${ch.name} 无效：${e.message}`); }
    }
    for (const s of body.systemSettings) if (!SETTINGS.has(s.key) || typeof s.value !== 'string') throw new BadRequestException(`不允许恢复设置 ${s.key}`);
    for (const p of body.partners) for (const field of ['url', 'logoUrl']) if (p[field]) { try { if (!['https:', 'http:'].includes(new URL(p[field]).protocol)) throw Error(); } catch { throw new BadRequestException('合作站链接仅允许 HTTP/HTTPS'); } }
    return body;
  }

  private async plan(body: any, db: any) {
    const result: any = { warnings: [...(Array.isArray(body.warnings) ? body.warnings : []), '新建项目需要重新生成 API Key；运行记录和认证数据不包含在配置备份中', '新导入任务默认暂停，审核后恢复执行'], bindings: { created: 0, updated: 0 } };
    const existing: Record<string, Map<string, any>> = {};
    for (const group of GROUPS) {
      const rows = await db[MODELS[group]].findMany({});
      existing[group] = new Map(rows.map((r: any) => [group === 'systemSettings' ? r.key : r.id, r]));
      result[group] = { created: 0, updated: 0, skipped: 0 };
      for (const row of body[group]) {
        const id = group === 'systemSettings' ? row.key : row.id;
        const prior = existing[group].get(id);
        if (prior && ['emailTemplates', 'pushTemplates', 'emailSuppress', 'eventDefinitions', 'schedules'].includes(group) && (prior.projectId || null) !== (row.projectId || null)) throw new BadRequestException(`${group} 身份范围冲突，拒绝移动现有记录`);
        if (group === 'templateRevisions') {
          const conflict = rows.find((r: any) => r.kind === row.kind && r.templateId === row.templateId && r.revision === row.revision);
          if ((prior && (prior.kind !== row.kind || prior.templateId !== row.templateId || prior.revision !== row.revision)) || (conflict && !isDeepStrictEqual(conflict.snapshot, row.snapshot))) throw new BadRequestException('模板历史身份或内容冲突');
          if (conflict) { result[group].skipped++; continue; }
        }
        if (prior && ['emailTemplates', 'pushTemplates'].includes(group)) {
          if (row.revision !== undefined && prior.revision > row.revision) throw new BadRequestException('备份模板版本落后于现有版本，请通过版本回滚处理');
          const liveFields = FIELDS[group].filter((key) => !['draft', 'revision', 'projectId', 'code'].includes(key));
          if ((row.revision === undefined || row.revision === prior.revision) && liveFields.some((key) => row[key] !== undefined && !isDeepStrictEqual(row[key], prior[key]))) throw new BadRequestException('同版本模板内容冲突，请先发布新版本或显式回滚');
        }
        if (['emailTemplates', 'pushTemplates', 'emailSuppress', 'eventDefinitions'].includes(group)) {
          const key = group === 'emailSuppress' ? 'address' : 'code';
          const conflict = rows.find((r: any) => r.id !== row.id && (r.projectId || null) === (row.projectId || null) && r[key] === row[key]);
          if (conflict) throw new BadRequestException(`${group} 的 ${row[key]} 与现有 ID 不同，拒绝覆盖`);
        }
        if (group === 'schedules' && prior) { result[group].skipped++; continue; }
        result[group][prior ? 'updated' : 'created']++;
      }
    }
    return { result, existing };
  }

  async previewImport(input: unknown, options: Options = {}) {
    const body = await this.decode(input, options);
    return (await this.plan(body, this.prisma)).result;
  }

  async importConfig(input: unknown, options: Options = {}) {
    const body = await this.decode(input, options);
    return this.prisma.$transaction(async (db) => {
      const { result, existing } = await this.plan(body, db);
      for (const group of GROUPS) {
        const model = (db as any)[MODELS[group]];
        for (const row of body[group]) {
          const id = group === 'systemSettings' ? row.key : row.id;
          const prior = existing[group].get(id);
          if (group === 'schedules' && prior) continue;
          if (group === 'templateRevisions' && [...existing[group].values()].some((r: any) => r.kind === row.kind && r.templateId === row.templateId && r.revision === row.revision)) continue;
          const data = pick(row, FIELDS[group]);
          for (const field of ['variables', 'draft']) if (data[field] === null) data[field] = Prisma.DbNull;
          if (group === 'projects' && !prior) {
            const key = generateApiKey(); data.apiKeyHash = hashApiKey(key); data.apiKeyPrefix = apiKeyPrefix(key);
          }
          if (group === 'schedules') data.status = 'PAUSED';
          if (data.runAt) data.runAt = new Date(data.runAt);
          if (data.expiresAt) data.expiresAt = new Date(data.expiresAt);
          if (data.createdAt) data.createdAt = new Date(data.createdAt);
          if (group === 'systemSettings') await model.upsert({ where: { key: id }, create: data, update: { value: data.value } });
          else if (prior) await model.update({ where: { id }, data });
          else await model.create({ data: { id, ...data } });
        }
      }
      for (const p of body.projects) {
        const selectedDefault = (p.bindings || []).find((b: any) => b.isDefault === true);
        if (selectedDefault) await db.projectChannel.updateMany({ where: { projectId: p.id, channelId: { not: selectedDefault.channelId } }, data: { isDefault: false } });
        for (const b of p.bindings || []) {
          const prior = await db.projectChannel.findFirst({ where: { projectId: p.id, channelId: b.channelId } });
          const data = { projectId: p.id, ...pick(b, ['channelId', 'enabled', 'isDefault', 'isBackup', 'priority']) };
          if (prior) { await db.projectChannel.update({ where: { id: prior.id }, data: data as any }); result.bindings.updated++; }
          else { await db.projectChannel.create({ data: data as any }); result.bindings.created++; }
        }
      }
      return result;
    }, { isolationLevel: 'Serializable', timeout: 120_000 });
  }
}
