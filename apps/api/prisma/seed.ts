import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_TEMPLATES = [
  {
    code: 'login',
    name: '登录验证码',
    subject: '【{{appName}}】登录验证码',
    htmlBody: `<!DOCTYPE html>
<html><body style="font-family:sans-serif;background:#f5f7fb;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,.06);">
    <h2 style="margin:0 0 12px;color:#1f2937;">登录验证码</h2>
    <p style="color:#4b5563;line-height:1.6;">您正在登录 <strong>{{appName}}</strong>，验证码为：</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb;margin:20px 0;">{{code}}</div>
    <p style="color:#6b7280;font-size:14px;">有效期 {{expireMinutes}} 分钟，请勿泄露给他人。</p>
    {{#if ip}}<p style="color:#9ca3af;font-size:12px;">来源 IP：{{ip}} · {{time}}</p>{{/if}}
  </div>
</body></html>`,
    variables: ['appName', 'code', 'expireMinutes', 'ip', 'time'],
  },
  {
    code: 'register',
    name: '注册欢迎',
    subject: '欢迎注册 {{appName}}',
    htmlBody: `<!DOCTYPE html>
<html><body style="font-family:sans-serif;background:#f5f7fb;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 12px;color:#1f2937;">欢迎加入 {{appName}}</h2>
    <p style="color:#4b5563;line-height:1.6;">你好 {{username}}，感谢注册！</p>
    {{#if code}}<p>验证码：<strong style="color:#2563eb;font-size:24px;">{{code}}</strong></p>{{/if}}
    {{#if verifyUrl}}<p><a href="{{verifyUrl}}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">完成验证</a></p>{{/if}}
  </div>
</body></html>`,
    variables: ['appName', 'username', 'code', 'verifyUrl'],
  },
  {
    code: 'reset_password',
    name: '找回密码',
    subject: '【{{appName}}】重置密码',
    htmlBody: `<!DOCTYPE html>
<html><body style="font-family:sans-serif;background:#f5f7fb;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 12px;color:#1f2937;">重置密码</h2>
    <p style="color:#4b5563;">你好 {{username}}，请使用以下方式重置 <strong>{{appName}}</strong> 密码：</p>
    {{#if code}}<div style="font-size:28px;font-weight:700;color:#2563eb;margin:16px 0;">{{code}}</div>{{/if}}
    {{#if resetUrl}}<p><a href="{{resetUrl}}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">重置密码</a></p>{{/if}}
    <p style="color:#6b7280;font-size:14px;">链接/验证码 {{expireMinutes}} 分钟内有效。</p>
  </div>
</body></html>`,
    variables: ['appName', 'username', 'resetUrl', 'expireMinutes', 'code'],
  },
  {
    code: 'notification',
    name: '通用通知',
    subject: '【{{appName}}】{{title}}',
    htmlBody: `<!DOCTYPE html>
<html><body style="font-family:sans-serif;background:#f5f7fb;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 12px;color:#1f2937;">{{title}}</h2>
    <div style="color:#4b5563;line-height:1.7;">{{{body}}}</div>
    {{#if actionUrl}}<p style="margin-top:24px;"><a href="{{actionUrl}}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">查看详情</a></p>{{/if}}
  </div>
</body></html>`,
    variables: ['appName', 'title', 'body', 'actionUrl'],
  },
];

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe@123456';
  const passwordHash = await bcrypt.hash(password, 10);

  const forceReset = process.env.FORCE_RESET_ADMIN_PASSWORD === 'true';
  const existing = await prisma.adminUser.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) {
    await prisma.adminUser.deleteMany({ where: { NOT: { id: existing.id } } });
    if (forceReset) {
      await prisma.adminUser.update({
        where: { id: existing.id },
        data: { username, passwordHash },
      });
      console.log('Admin password force-reset by FORCE_RESET_ADMIN_PASSWORD');
    } else if (existing.username !== username) {
      await prisma.adminUser.update({
        where: { id: existing.id },
        data: { username },
      });
    }
  } else {
    await prisma.adminUser.create({ data: { username, passwordHash } });
  }
  for (const t of DEFAULT_TEMPLATES) {
    const found = await prisma.emailTemplate.findFirst({
      where: { projectId: null, code: t.code },
    });
    if (!found) {
      await prisma.emailTemplate.create({
        data: {
          projectId: null,
          code: t.code,
          name: t.name,
          subject: t.subject,
          htmlBody: t.htmlBody,
          variables: t.variables,
          isSystem: true,
          enabled: true,
        },
      });
    }
  }


  // 推送模板示例
  const PUSH_DEFAULTS = [
    {
      code: 'alert',
      name: '系统告警',
      titleTpl: '【{{appName}}】{{level}}告警',
      contentTpl: '告警级别：{{level}}\n服务：{{service}}\n时间：{{time}}\n详情：{{message}}',
      variables: ['appName', 'level', 'service', 'time', 'message', 'host', 'link'],
    },
    {
      code: 'order_paid',
      name: '订单支付成功',
      titleTpl: '【{{appName}}】支付成功',
      contentTpl: '你好 {{username}}，\n订单 {{orderId}} 已支付成功。\n金额：¥{{amount}}\n商品：{{product}}',
      variables: ['appName', 'username', 'orderId', 'amount', 'product', 'time', 'remark'],
    },
    {
      code: 'deploy',
      name: '部署完成通知',
      titleTpl: '【部署】{{appName}} {{env}} {{status}}',
      contentTpl: '应用：{{appName}}\n环境：{{env}}\n状态：{{status}}\n版本：{{version}}\n操作人：{{operator}}',
      variables: ['appName', 'env', 'status', 'version', 'operator', 'duration', 'commit', 'link'],
    },
    {
      code: 'login_notice',
      name: '登录提醒',
      titleTpl: '【{{appName}}】账号登录提醒',
      contentTpl: '你的账号 {{username}} 刚刚登录。\n时间：{{time}}\nIP：{{ip}}',
      variables: ['appName', 'username', 'time', 'ip', 'location', 'device'],
    },
    {
      code: 'server_status',
      name: '服务器状态摘要',
      titleTpl: '【巡检】{{appName}} {{date}}',
      contentTpl: 'CPU：{{cpu}}%  内存：{{memory}}%  磁盘：{{disk}}%\n状态：{{status}}',
      variables: ['appName', 'date', 'cpu', 'memory', 'disk', 'load', 'status', 'note'],
    },
    {
      code: 'custom_text',
      name: '通用文本通知',
      titleTpl: '{{title}}',
      contentTpl: '{{content}}',
      variables: ['title', 'content', 'footer'],
    },
  ];
  for (const t of PUSH_DEFAULTS) {
    const found = await prisma.pushTemplate.findFirst({
      where: { projectId: null, code: t.code },
    });
    if (!found) {
      await prisma.pushTemplate.create({
        data: {
          projectId: null,
          code: t.code,
          name: t.name,
          titleTpl: t.titleTpl,
          contentTpl: t.contentTpl,
          variables: t.variables,
          enabled: true,
        },
      });
    }
  }

  // 全局默认站内渠道：不外发，仅入库 + 后台弹窗
  const inbox = await prisma.channel.findFirst({
    where: { type: 'INBOX' },
    orderBy: { createdAt: 'asc' },
  });
  let inboxId = inbox?.id;
  if (!inbox) {
    const created = await prisma.channel.create({
      data: {
        name: '站内通知',
        type: 'INBOX',
        config: {},
        enabled: true,
        isDefault: true,
      },
    });
    inboxId = created.id;
    console.log('Inbox channel created (global default)');
  } else {
    await prisma.channel.update({
      where: { id: inbox.id },
      data: { enabled: true },
    });
    // 若尚无任何全局默认，把站内设为默认
    const anyDefault = await prisma.channel.findFirst({ where: { isDefault: true } });
    if (!anyDefault) {
      await prisma.channel.update({
        where: { id: inbox.id },
        data: { isDefault: true },
      });
    }
  }

  // 已有项目全部自动绑定站内渠道（幂等）
  if (inboxId) {
    const projects = await prisma.project.findMany({ select: { id: true } });
    for (const p of projects) {
      const existingBind = await prisma.projectChannel.findUnique({
        where: {
          projectId_channelId: { projectId: p.id, channelId: inboxId },
        },
      });
      if (existingBind) continue;
      const hasDefault = await prisma.projectChannel.findFirst({
        where: { projectId: p.id, isDefault: true },
      });
      await prisma.projectChannel.create({
        data: {
          projectId: p.id,
          channelId: inboxId,
          enabled: true,
          isDefault: !hasDefault,
          isBackup: false,
          priority: 0,
        },
      });
    }
    if (projects.length) {
      console.log(`Inbox channel bound to ${projects.length} project(s)`);
    }
  }

  console.log(`Seed done. Single admin: ${username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
