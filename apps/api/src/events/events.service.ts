import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MessagePriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  list(projectId?: string) {
    const where =
      projectId === undefined
        ? {}
        : projectId === 'system' || projectId === ''
          ? { projectId: null }
          : { OR: [{ projectId }, { projectId: null }] };
    return this.prisma.eventDefinition.findMany({
      where,
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async get(id: string) {
    const row = await this.prisma.eventDefinition.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('事件不存在');
    return row;
  }

  async create(data: {
    code: string;
    name: string;
    description?: string;
    defaultPriority?: MessagePriority;
    pushTemplateCode?: string;
    emailTemplateCode?: string;
    projectId?: string | null;
    enabled?: boolean;
  }) {
    const code = (data.code || '').trim();
    if (!code) throw new BadRequestException('code 不能为空');
    if (!data.name?.trim()) throw new BadRequestException('name 不能为空');
    try {
      return await this.prisma.eventDefinition.create({
        data: {
          code,
          name: data.name.trim(),
          description: data.description?.trim() || null,
          defaultPriority: data.defaultPriority || MessagePriority.NORMAL,
          pushTemplateCode: data.pushTemplateCode || null,
          emailTemplateCode: data.emailTemplateCode || null,
          projectId: data.projectId || null,
          enabled: data.enabled !== false,
          isSystem: false,
        },
      });
    } catch {
      throw new BadRequestException('事件 code 已存在');
    }
  }

  async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      defaultPriority?: MessagePriority;
      pushTemplateCode?: string | null;
      emailTemplateCode?: string | null;
      enabled?: boolean;
    },
  ) {
    const row = await this.get(id);
    return this.prisma.eventDefinition.update({
      where: { id: row.id },
      data: {
        name: data.name?.trim(),
        description:
          data.description === undefined ? undefined : data.description?.trim() || null,
        defaultPriority: data.defaultPriority,
        pushTemplateCode:
          data.pushTemplateCode === undefined
            ? undefined
            : data.pushTemplateCode || null,
        emailTemplateCode:
          data.emailTemplateCode === undefined
            ? undefined
            : data.emailTemplateCode || null,
        enabled: data.enabled,
      },
    });
  }

  async remove(id: string) {
    const row = await this.get(id);
    if (row.isSystem) throw new BadRequestException('系统事件不可删除');
    await this.prisma.eventDefinition.delete({ where: { id } });
    return { deleted: true };
  }
}
