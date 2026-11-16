import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Handlebars from 'handlebars';
import { Prisma } from '@prisma/client';

type Kind = 'email' | 'push';
const fields = {
  email: ['name', 'subject', 'htmlBody', 'textBody', 'variables', 'enabled'],
  push: ['name', 'titleTpl', 'contentTpl', 'variables', 'enabled'],
};

@Injectable()
export class TemplateVersionsService {
  constructor(private prisma: PrismaService) {}
  private model(db: any, kind: Kind) { return kind === 'email' ? db.emailTemplate : db.pushTemplate; }
  private snapshot(kind: Kind, row: any) {
    return Object.fromEntries(fields[kind].filter(k => row[k] !== undefined).map(k => [k, k === 'variables' && row[k] === null ? [] : row[k]]));
  }
  private validate(kind: Kind, data: any) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('模板内容无效');
    for (const key of Object.keys(data)) if (!fields[kind].includes(key)) throw new BadRequestException(`不允许修改字段 ${key}`);
    for (const key of fields[kind].filter(k => !['variables', 'enabled'].includes(k))) {
      if (data[key] === undefined || (key === 'textBody' && data[key] === null)) continue;
      if (typeof data[key] !== 'string' || data[key].length > 500_000) throw new BadRequestException(`${key} 必须是有效文本`);
      if (['subject', 'htmlBody', 'textBody', 'titleTpl', 'contentTpl'].includes(key)) {
        try { Handlebars.precompile(data[key]); } catch { throw new BadRequestException(`${key} 模板语法无效`); }
      }
    }
    if (data.variables !== undefined && (!Array.isArray(data.variables) || data.variables.some((v: any) => typeof v !== 'string' || !/^[A-Za-z_][\w.]*$/.test(v)))) throw new BadRequestException('变量名必须为有效标识符');
    if (data.enabled !== undefined && typeof data.enabled !== 'boolean') throw new BadRequestException('enabled 必须是布尔值');
    return this.snapshot(kind, data);
  }
  async history(kind: Kind, id: string) {
    if (!await this.model(this.prisma, kind).findUnique({ where: { id } })) throw new NotFoundException('模板不存在');
    return this.prisma.templateRevision.findMany({ where: { kind, templateId: id }, orderBy: { revision: 'desc' }, take: 100 });
  }
  async saveDraft(kind: Kind, id: string, data: unknown) {
    const model = this.model(this.prisma, kind);
    const current = await model.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('模板不存在');
    const partial = this.validate(kind, data);
    const changed = await model.updateMany({ where: { id, revision: current.revision || 1, updatedAt: current.updatedAt }, data: { draft: { ...this.snapshot(kind, current), ...(current.draft || {}), ...partial } } });
    if (!changed.count) throw new ConflictException('模板已被其他操作更新，请刷新后重试');
    return model.findUnique({ where: { id } });
  }
  async publish(kind: Kind, id: string, changes?: unknown) {
    return this.prisma.$transaction(async (db) => {
      const model = this.model(db, kind);
      const current = await model.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('模板不存在');
      if (!changes && !current.draft) throw new BadRequestException('没有待发布草稿');
      const next = { ...this.snapshot(kind, current), ...this.validate(kind, changes || current.draft) };
      if (!next.name?.trim() || (kind === 'push' && !next.contentTpl?.trim())) throw new BadRequestException('模板名称/正文不能为空');
      const revision = current.revision || 1;
      const claimed = await model.updateMany({ where: { id, revision, updatedAt: current.updatedAt }, data: { ...next, revision: revision + 1, draft: Prisma.DbNull } });
      if (!claimed.count) throw new ConflictException('模板已被其他操作更新，请刷新后重试');
      await db.templateRevision.create({ data: { kind, templateId: id, revision, snapshot: this.snapshot(kind, current) as any } });
      return model.findUnique({ where: { id } });
    });
  }
  async rollback(kind: Kind, id: string, revision: number) {
    if (!Number.isInteger(revision) || revision < 1) throw new BadRequestException('版本号无效');
    const old = await this.prisma.templateRevision.findFirst({ where: { kind, templateId: id, revision } });
    if (!old) throw new NotFoundException('历史版本不存在');
    return this.publish(kind, id, old.snapshot);
  }
}
