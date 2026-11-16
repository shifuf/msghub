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
    code: 'login',
    name: '登录验证码',
    subject: '【{{appName}}】登录验证码',
    htmlBody: `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f7fb;padding:24px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;"><h2>登录验证码</h2><p>您正在登录 <strong>{{appName}}</strong>，验证码为：</p><div style="font-size:32px;font-weight:700;color:#2563eb;">{{code}}</div><p>有效期 {{expireMinutes}} 分钟。</p></div></body></html>`,
    variables: ['appName', 'code', 'expireMinutes', 'ip', 'time'],
  },
  {
    code: 'register',
    name: '注册欢迎',
    subject: '欢迎注册 {{appName}}',
    htmlBody: `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;"><h2>欢迎加入 {{appName}}</h2><p>你好 {{username}}，感谢注册！</p>{{#if code}}<p>验证码：<strong>{{code}}</strong></p>{{/if}}{{#if verifyUrl}}<p><a href="{{verifyUrl}}">完成验证</a></p>{{/if}}</div></body></html>`,
    variables: ['appName', 'username', 'code', 'verifyUrl'],
  },
  {
    code: 'reset_password',
    name: '找回密码',
    subject: '【{{appName}}】重置密码',
    htmlBody: `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;"><h2>重置密码</h2><p>你好 {{username}}，请重置 <strong>{{appName}}</strong> 密码。</p>{{#if code}}<div style="font-size:28px;color:#2563eb;">{{code}}</div>{{/if}}{{#if resetUrl}}<p><a href="{{resetUrl}}">重置密码</a></p>{{/if}}<p>{{expireMinutes}} 分钟内有效。</p></div></body></html>`,
    variables: ['appName', 'username', 'resetUrl', 'expireMinutes', 'code'],
  },
  {
    code: 'notification',
    name: '通用通知',
    subject: '【{{appName}}】{{title}}',
    htmlBody: `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;"><h2>{{title}}</h2><div>{{{body}}}</div>{{#if actionUrl}}<p><a href="{{actionUrl}}">查看详情</a></p>{{/if}}</div></body></html>`,
    variables: ['appName', 'title', 'body', 'actionUrl'],
  },
  {
    code: 'comment_reply',
    name: '评论回复通知',
    subject: '【{{siteName}}】《{{articleTitle}}》有新回复',
    htmlBody: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#fff;border:1px solid #e8e8e8;"><tr><td style="padding:20px 24px 12px;border-bottom:1px solid #f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;color:#8c8c8c;">{{siteName}}</td></tr><tr><td style="padding:24px 24px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;"><div style="font-size:18px;font-weight:600;color:#141414;line-height:1.4;margin:0 0 6px;">评论收到新回复</div><div style="font-size:14px;color:#595959;line-height:1.6;margin:0;"><a href="{{viewUrl}}" style="color:#1677ff;text-decoration:none;font-weight:600;">《{{articleTitle}}》</a></div></td></tr><tr><td style="padding:16px 24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;"><div style="font-size:12px;color:#8c8c8c;margin:0 0 8px;">您的评论</div><div style="margin:0;padding:12px 14px;background:#fafafa;border:1px solid #f0f0f0;border-left:3px solid #d9d9d9;font-size:14px;line-height:1.7;color:#595959;">{{{parentSnippetHtml}}}</div></td></tr><tr><td style="padding:18px 24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;"><div style="font-size:12px;color:#8c8c8c;margin:0 0 8px;"><span style="color:#141414;font-weight:600;">{{actorName}}</span> 回复</div><div style="margin:0;padding:12px 14px;background:#fff;border:1px solid #f0f0f0;border-left:3px solid #1677ff;font-size:14px;line-height:1.7;color:#141414;">{{{replySnippetHtml}}}</div></td></tr><tr><td align="left" style="padding:24px 24px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;"><a href="{{viewUrl}}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;font-size:14px;font-weight:600;line-height:1;padding:12px 20px;border-radius:6px;">查看文章评论</a></td></tr>{{#if unsubscribeUrl}}<tr><td style="padding:4px 24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;line-height:1.6;color:#8c8c8c;"><a href="{{unsubscribeUrl}}" style="color:#8c8c8c;">取消后续回复邮件通知</a></td></tr>{{/if}}<tr><td style="padding:14px 24px;border-top:1px solid #f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:12px;color:#bfbfbf;line-height:1.6;">系统自动发送，请勿直接回复。</td></tr></table></td></tr></table></body></html>`,
    textBody:
      '{{siteName}} · 评论回复通知\n\n文章：《{{articleTitle}}》\n链接：{{viewUrl}}\n\n您的评论：\n{{parentSnippet}}\n\n{{actorName}} 回复：\n{{replySnippet}}\n\n{{#if unsubscribeUrl}}取消通知：{{unsubscribeUrl}}{{/if}}',
    variables: [
      'siteName',
      'articleTitle',
      'actorName',
      'parentSnippet',
      'parentSnippetHtml',
      'replySnippet',
      'replySnippetHtml',
      'viewUrl',
      'unsubscribeUrl',
    ],
  },
  {
    code: 'new_article',
    name: '新文订阅通知',
    subject: '【{{siteName}}】新文章：{{articleTitle}}',
    htmlBody: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;"><tr><td align="center" style="padding:32px 16px;"><table width="100%" style="max-width:520px;background:#fff;border:1px solid #e8e8e8;border-radius:12px;"><tr><td style="padding:20px 24px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#8c8c8c;">{{siteName}}</td></tr><tr><td style="padding:24px;"><div style="font-size:18px;font-weight:600;color:#141414;margin-bottom:8px;">发布了新文章</div><div style="font-size:16px;font-weight:600;color:#1677ff;margin-bottom:12px;">《{{articleTitle}}》</div><div style="font-size:14px;color:#595959;line-height:1.7;">{{{body}}}</div><p style="margin:24px 0 0;"><a href="{{viewUrl}}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">阅读全文</a></p>{{#if unsubscribeUrl}}<p style="margin:16px 0 0;font-size:12px;color:#8c8c8c;"><a href="{{unsubscribeUrl}}" style="color:#8c8c8c;">取消订阅</a></p>{{/if}}</td></tr></table></td></tr></table></body></html>`,
    textBody:
      '{{siteName}} 发布了新文章\n\n《{{articleTitle}}》\n阅读：{{viewUrl}}\n\n{{#if unsubscribeUrl}}退订：{{unsubscribeUrl}}{{/if}}',
    variables: [
      'siteName',
      'appName',
      'articleTitle',
      'title',
      'viewUrl',
      'url',
      'body',
      'actionUrl',
      'unsubscribeUrl',
    ],
  },
  {
    code: 'friend_link_review',
    name: '友链审核结果',
    subject: '【{{siteName}}】友链申请{{statusText}}',
    htmlBody: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;"><tr><td align="center" style="padding:32px 16px;"><table width="100%" style="max-width:520px;background:#fff;border:1px solid #e8e8e8;border-radius:12px;"><tr><td style="padding:20px 24px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#8c8c8c;">{{siteName}}</td></tr><tr><td style="padding:24px;"><div style="font-size:18px;font-weight:600;color:#141414;margin-bottom:12px;">{{title}}</div><div style="font-size:14px;color:#595959;line-height:1.7;margin-bottom:12px;">{{{body}}}</div><div style="padding:12px 14px;background:#fafafa;border:1px solid #f0f0f0;border-radius:8px;font-size:14px;line-height:1.7;color:#141414;"><div>站点：<strong>{{friendName}}</strong></div><div>链接：<a href="{{friendUrl}}" style="color:#1677ff;">{{friendUrl}}</a></div><div>结果：{{statusText}}</div></div>{{#if viewUrl}}<p style="margin:24px 0 0;"><a href="{{viewUrl}}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">查看友链页</a></p>{{/if}}</td></tr></table></td></tr></table></body></html>`,
    textBody:
      '{{siteName}} · 友链审核\n\n{{title}}\n{{body}}\n\n站点：{{friendName}}\n链接：{{friendUrl}}\n结果：{{statusText}}\n{{#if viewUrl}}查看：{{viewUrl}}{{/if}}',
    variables: [
      'siteName',
      'friendName',
      'friendUrl',
      'approved',
      'statusText',
      'viewUrl',
      'title',
      'body',
      'actionUrl',
    ],
  },
  {
    code: 'unread_remind',
    name: '未读推送邮件兜底',
    subject: '【未读提醒】{{title}}',
    htmlBody: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body style="margin:0;padding:24px;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e8e8e8;"><div style="font-size:13px;color:#8c8c8c;margin-bottom:12px;">{{appName}} · 未读提醒</div><h2 style="margin:0 0 12px;font-size:18px;color:#141414;">{{title}}</h2><div style="font-size:14px;line-height:1.7;color:#595959;white-space:pre-wrap;">{{content}}</div><p style="margin:20px 0 0;font-size:12px;color:#8c8c8c;">消息 ID：{{messageId}}</p>{{#if viewUrl}}<p style="margin:16px 0 0;"><a href="{{viewUrl}}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">打开管理后台</a></p>{{/if}}</div></body></html>`,
    textBody:
      '【未读提醒】{{title}}\n\n{{content}}\n\n消息 ID：{{messageId}}\n项目：{{projectName}}\n{{#if viewUrl}}查看：{{viewUrl}}{{/if}}',
    variables: [
      'appName',
      'projectName',
      'title',
      'content',
      'messageId',
      'sourceMessageId',
      'viewUrl',
    ],
  },
];

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService, private activity: ActivityService) {}

  /**
   * 管理列表默认「精确范围」：选某项目只返回该项目模板，不混入全局。
   * 发送选型传 includeGlobal=true：项目模板 + 全局启用模板（项目覆盖全局）。
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

    return this.prisma.emailTemplate.findMany({
      where,
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }, { createdAt: 'desc' }],
      include: { project: { select: { id: true, name: true } } },
    });
  }

  async get(id: string) {
    const t = await this.prisma.emailTemplate.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!t) throw new NotFoundException('模板不存在');
    return t;
  }

  async create(data: {
    projectId?: string | null;
    code: string;
    name: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
    variables?: string[];
    enabled?: boolean;
  }) {
    if (!data.code?.trim()) throw new BadRequestException('模板 code 不能为空');
    const projectId = data.projectId || null;
    const existing = await this.prisma.emailTemplate.findFirst({
      where: { projectId, code: data.code.trim() },
    });
    if (existing) throw new BadRequestException('同项目下 code 已存在');

    return this.prisma.emailTemplate.create({
      data: {
        projectId,
        code: data.code.trim(),
        name: data.name.trim(),
        subject: data.subject,
        htmlBody: data.htmlBody,
        textBody: data.textBody || null,
        variables: data.variables || [],
        isSystem: !projectId,
        enabled: data.enabled ?? true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      subject?: string;
      htmlBody?: string;
      textBody?: string;
      variables?: string[];
      enabled?: boolean;
    },
  ) {
    await this.get(id);
    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        subject: data.subject,
        htmlBody: data.htmlBody,
        textBody: data.textBody,
        variables: data.variables,
        enabled: data.enabled,
      },
    });
  }

  async remove(id: string) {
    const t = await this.get(id);
    await this.prisma.emailTemplate.delete({ where: { id } });
    await this.activity.log({
      action: 'email_template.delete',
      resource: 'EmailTemplate',
      resourceId: id,
      resourceName: t.name,
      detail: { code: t.code },
    });
    return { deleted: true };
  }

  async copy(id: string, targetProjectId?: string | null, newCode?: string) {
    const src = await this.get(id);
    const code = newCode?.trim() || `${src.code}_copy`;
    return this.create({
      projectId: targetProjectId === undefined ? src.projectId : targetProjectId,
      code,
      name: `${src.name}（副本）`,
      subject: src.subject,
      htmlBody: src.htmlBody,
      textBody: src.textBody || undefined,
      variables: (src.variables as string[]) || [],
      enabled: true,
    });
  }

  async preview(id: string, variables: Record<string, unknown> = {}) {
    const live = await this.get(id);
    const t = { ...live, ...(live.draft && typeof live.draft === 'object' && !Array.isArray(live.draft) ? live.draft as Record<string, any> : {}) };
    return {
      subject: this.render(t.subject, variables),
      html: this.render(t.htmlBody, variables),
      text: t.textBody ? this.render(t.textBody, variables) : null,
    };
  }

  async seedDefaults(projectId?: string | null) {
    const created: string[] = [];
    for (const d of SYSTEM_DEFAULTS) {
      const existing = await this.prisma.emailTemplate.findFirst({
        where: { projectId: projectId || null, code: d.code },
      });
      if (existing) continue;
      await this.prisma.emailTemplate.create({
        data: {
          projectId: projectId || null,
          code: d.code,
          name: d.name,
          subject: d.subject,
          htmlBody: d.htmlBody,
          textBody: (d as any).textBody || null,
          variables: d.variables,
          isSystem: !projectId,
          enabled: true,
        },
      });
      created.push(d.code);
    }
    return { created };
  }

  /** 项目模板优先，再系统全局 */
  async resolve(projectId: string, code: string) {
    const projectTpl = await this.prisma.emailTemplate.findFirst({
      where: { projectId, code, enabled: true },
    });
    if (projectTpl) return projectTpl;
    const systemTpl = await this.prisma.emailTemplate.findFirst({
      where: { projectId: null, code, enabled: true },
    });
    if (!systemTpl) throw new NotFoundException(`模板不存在: ${code}`);
    return systemTpl;
  }

  render(template: string, variables: Record<string, unknown>) {
    try {
      return Handlebars.compile(template)(variables || {});
    } catch (e: any) {
      throw new BadRequestException(`模板渲染失败: ${e?.message || e}`);
    }
  }
}
