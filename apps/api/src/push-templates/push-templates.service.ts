import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import Handlebars from 'handlebars';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

const SYSTEM_DEFAULTS = [
  {
    code: 'alert',
    name: '系统告警',
    titleTpl: '【{{appName}}】{{level}}告警',
    contentTpl: `告警级别：{{level}}
服务：{{service}}
时间：{{time}}
详情：{{message}}
{{#if host}}主机：{{host}}{{/if}}
{{#if link}}查看：{{link}}{{/if}}`,
    variables: ['appName', 'level', 'service', 'time', 'message', 'host', 'link'],
  },
  {
    code: 'order_paid',
    name: '订单支付成功',
    titleTpl: '【{{appName}}】支付成功',
    contentTpl: `你好 {{username}}，
订单 {{orderId}} 已支付成功。
金额：¥{{amount}}
商品：{{product}}
时间：{{time}}
{{#if remark}}备注：{{remark}}{{/if}}`,
    variables: ['appName', 'username', 'orderId', 'amount', 'product', 'time', 'remark'],
  },
  {
    code: 'deploy',
    name: '部署完成通知',
    titleTpl: '【部署】{{appName}} {{env}} {{status}}',
    contentTpl: `应用：{{appName}}
环境：{{env}}
状态：{{status}}
版本：{{version}}
操作人：{{operator}}
耗时：{{duration}}
{{#if commit}}提交：{{commit}}{{/if}}
{{#if link}}详情：{{link}}{{/if}}`,
    variables: ['appName', 'env', 'status', 'version', 'operator', 'duration', 'commit', 'link'],
  },
  {
    code: 'login_notice',
    name: '登录提醒',
    titleTpl: '【{{appName}}】账号登录提醒',
    contentTpl: `你的账号 {{username}} 刚刚登录。
时间：{{time}}
IP：{{ip}}
{{#if location}}地点：{{location}}{{/if}}
{{#if device}}设备：{{device}}{{/if}}
如非本人操作，请立即修改密码。`,
    variables: ['appName', 'username', 'time', 'ip', 'location', 'device'],
  },
  {
    code: 'server_status',
    name: '服务器状态摘要',
    titleTpl: '【巡检】{{appName}} {{date}}',
    contentTpl: `日期：{{date}}
CPU：{{cpu}}%
内存：{{memory}}%
磁盘：{{disk}}%
负载：{{load}}
状态：{{status}}
{{#if note}}说明：{{note}}{{/if}}`,
    variables: ['appName', 'date', 'cpu', 'memory', 'disk', 'load', 'status', 'note'],
  },
  {
    code: 'custom_text',
    name: '通用文本通知',
    titleTpl: '{{title}}',
    contentTpl: `{{content}}
{{#if footer}}

—— {{footer}}{{/if}}`,
    variables: ['title', 'content', 'footer'],
  },
];

@Injectable()
export class PushTemplatesService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  /**
   * 管理列表默认精确范围（项目互不影响）。
   * 发送选型 includeGlobal=true 时合并全局。
   */
  async list(
    projectId?: string | null,
    enabled?: boolean,
    includeGlobal = false,
  ) {
    const where: Record<string, unknown> =
      projectId === undefined
        ? {}
        : projectId === null || projectId === 'system'
          ? { projectId: null }
          : includeGlobal
            ? { OR: [{ projectId }, { projectId: null }] }
            : { projectId };
    if (enabled !== undefined) where.enabled = enabled;

    return this.prisma.pushTemplate.findMany({
      where,
      orderBy: [{ code: 'asc' }, { createdAt: 'desc' }],
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async get(id: string) {
    const t = await this.prisma.pushTemplate.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!t) throw new NotFoundException('推送模板不存在');
    return t;
  }

  async create(data: {
    projectId?: string | null;
    code: string;
    name: string;
    titleTpl?: string;
    contentTpl: string;
    variables?: string[];
    enabled?: boolean;
  }) {
    if (!data.code?.trim()) throw new BadRequestException('模板 code 不能为空');
    if (!data.contentTpl?.trim()) throw new BadRequestException('contentTpl 不能为空');
    const projectId = data.projectId || null;
    const existing = await this.prisma.pushTemplate.findFirst({
      where: { projectId, code: data.code.trim() },
    });
    if (existing) throw new BadRequestException('同项目下 code 已存在');

    return this.prisma.pushTemplate.create({
      data: {
        projectId,
        code: data.code.trim(),
        name: data.name.trim(),
        titleTpl: data.titleTpl ?? '',
        contentTpl: data.contentTpl,
        variables: data.variables || [],
        enabled: data.enabled ?? true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      titleTpl?: string;
      contentTpl?: string;
      variables?: string[];
      enabled?: boolean;
    },
  ) {
    await this.get(id);
    return this.prisma.pushTemplate.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        titleTpl: data.titleTpl,
        contentTpl: data.contentTpl,
        variables: data.variables,
        enabled: data.enabled,
      },
    });
  }

  async remove(id: string) {
    const t = await this.get(id);
    await this.prisma.pushTemplate.delete({ where: { id } });
    await this.activity.log({
      action: 'push_template.delete',
      resource: 'PushTemplate',
      resourceId: id,
      resourceName: t.name,
      detail: { code: t.code },
    });
    return { deleted: true };
  }

  async seedDefaults(projectId?: string | null) {
    const pid = projectId || null;
    const created: string[] = [];
    for (const d of SYSTEM_DEFAULTS) {
      const existing = await this.prisma.pushTemplate.findFirst({
        where: { projectId: pid, code: d.code },
      });
      if (existing) continue;
      await this.prisma.pushTemplate.create({
        data: {
          projectId: pid,
          code: d.code,
          name: d.name,
          titleTpl: d.titleTpl,
          contentTpl: d.contentTpl,
          variables: d.variables,
          enabled: true,
        },
      });
      created.push(d.code);
    }
    return { created, samples: SYSTEM_DEFAULTS.map((d) => d.code) };
  }

  async resolve(projectId: string, code: string) {
    const projectTpl = await this.prisma.pushTemplate.findFirst({
      where: { projectId, code, enabled: true },
    });
    if (projectTpl) return projectTpl;
    const systemTpl = await this.prisma.pushTemplate.findFirst({
      where: { projectId: null, code, enabled: true },
    });
    if (!systemTpl) throw new NotFoundException(`推送模板不存在: ${code}`);
    return systemTpl;
  }

  render(template: string, variables: Record<string, unknown>) {
    try {
      return Handlebars.compile(template || '')(variables || {});
    } catch (e: any) {
      throw new BadRequestException(`模板渲染失败: ${e?.message || e}`);
    }
  }

  async renderForSend(
    projectId: string,
    code: string,
    variables: Record<string, unknown> = {},
  ) {
    const tpl = await this.resolve(projectId, code);
    return {
      code: tpl.code,
      title: this.render(tpl.titleTpl, variables),
      content: this.render(tpl.contentTpl, variables),
      titleTpl: tpl.titleTpl,
      contentTpl: tpl.contentTpl,
      variables: Array.isArray(tpl.variables) ? tpl.variables : [],
    };
  }

  async preview(id: string, variables: Record<string, unknown> = {}) {
    const t = await this.get(id);
    return {
      title: this.render(t.titleTpl, variables),
      content: this.render(t.contentTpl, variables),
    };
  }
}
