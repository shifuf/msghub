export const CHANNEL_TYPE_LABELS: Record<string, string> = {
  INBOX: '站内通知',
  BARK: 'Bark',
  GOTIFY: 'Gotify',
  SERVERCHAN: 'Server酱',
  PUSHPLUS: 'PushPlus',
  DINGTALK: '钉钉机器人',
  TELEGRAM: 'Telegram',
  WEBHOOK: 'Webhook',
  SMTP: '邮件 SMTP',
  FEISHU: '飞书机器人',
  DISCORD: 'Discord',
  JPUSH: '极光推送',
};

export const CHANNEL_TYPES = Object.keys(CHANNEL_TYPE_LABELS);

export const STATUS_LABELS: Record<string, string> = {
  PENDING: '排队中',
  SUCCESS: '成功',
  FAILED: '失败',
  DELAYED: '静默延迟',
  UNCERTAIN: '结果待核实',
  RUNNING: '执行中',
  PAUSED: '已暂停',
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: '低',
  NORMAL: '普通',
  HIGH: '高',
  CRITICAL: '紧急',
};

export const SOURCE_LABELS: Record<string, string> = {
  OPEN_API: '开放 API',
  ADMIN_TEST: '连通测试',
  ADMIN_SEND: '后台发送',
  BACKUP_ALERT: '失败告警',
  RESEND: '重发',
  BATCH: '批量发送',
};

export const ERROR_CLUSTER_LABELS: Record<string, string> = {
  auth: '鉴权失败',
  timeout: '超时',
  rate_limit: '限流 429',
  network: '网络/DNS',
  smtp_reject: 'SMTP 拒信',
  quota: '配额超限',
  upstream_5xx: '上游 5xx',
  unknown: '其他',
};

export function formatTime(v?: string | Date | null) {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function statusTagType(status: string): 'default' | 'success' | 'error' | 'warning' | 'info' {
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'PENDING') return 'warning';
  if (status === 'UNCERTAIN') return 'warning';
  if (status === 'DELAYED') return 'info';
  return 'default';
}


/** 将 HTML/过长错误压成可读短句 */
export function formatErrorMessage(raw?: string | null, max = 240) {
  if (!raw) return '-';
  let s = String(raw);
  // strip tags
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '请求失败（无详细信息）';
  // common status phrases
  const m = s.match(/\b(503|502|504|500|404|403|401)\b\s*([A-Za-z ]+)?/);
  if (m && /unavailable|error|forbidden|not found|unauthorized/i.test(s)) {
    const code = m[1];
    const phrase = (m[2] || '').trim();
    s = phrase ? `${code} ${phrase}` : `${code} 错误`;
  }
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}
