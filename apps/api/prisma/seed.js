const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEFAULT_TEMPLATES = [
  {
    code: 'login',
    name: '登录验证码',
    subject: '【{{appName}}】登录验证码',
    htmlBody: '<p>验证码：{{code}}</p>',
    variables: ['appName', 'code', 'expireMinutes', 'ip', 'time'],
  },
  {
    code: 'register',
    name: '注册欢迎',
    subject: '欢迎注册 {{appName}}',
    htmlBody: '<p>你好 {{username}}</p>',
    variables: ['appName', 'username', 'code', 'verifyUrl'],
  },
  {
    code: 'reset_password',
    name: '找回密码',
    subject: '【{{appName}}】重置密码',
    htmlBody: '<p>重置码：{{code}}</p>',
    variables: ['appName', 'username', 'resetUrl', 'expireMinutes', 'code'],
  },
  {
    code: 'notification',
    name: '通用通知',
    subject: '【{{appName}}】{{title}}',
    htmlBody: '<h2>{{title}}</h2><div>{{{body}}}</div>',
    variables: ['appName', 'title', 'body', 'actionUrl'],
  },
];

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

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe@123456';
  const forceReset = process.env.FORCE_RESET_ADMIN_PASSWORD === 'true';
  const passwordHash = await bcrypt.hash(password, 10);

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
    console.log('Admin created:', username);
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
  let inboxId = inbox && inbox.id;
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
    const anyDefault = await prisma.channel.findFirst({ where: { isDefault: true } });
    if (!anyDefault) {
      await prisma.channel.update({
        where: { id: inbox.id },
        data: { isDefault: true },
      });
    }
  }

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
      console.log('Inbox channel bound to', projects.length, 'project(s)');
    }
  }

  console.log('Seed done. Single admin:', username);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });