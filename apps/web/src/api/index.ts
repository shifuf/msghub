import http from './http';
import axios from 'axios';
import { useAuthStore } from '@/stores/auth';

export const authApi = {
  login: (username: string, password: string, code?: string) =>
    http.post('/admin/auth/login', { username, password, ...(code ? { code } : {}) }),
  me: () => http.get('/admin/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    http.post('/admin/auth/change-password', { oldPassword, newPassword }),
  revokeSessions: () => http.post('/admin/auth/revoke-sessions'),
  setupTotp: (password: string) => http.post('/admin/auth/totp/setup', { password }),
  enableTotp: (code: string) => http.post('/admin/auth/totp/enable', { code }),
  disableTotp: (password: string, code: string) => http.post('/admin/auth/totp/disable', { password, code }),
};

/** 健康检查（公共 /api，无需管理端鉴权） */
export const healthApi = {
  check: () => http.get('/health'),
  ready: () => http.get('/health/ready'),
};

export const dashboardApi = {
  stats: () => http.get('/admin/dashboard/stats'),
  notifications: (params: { since?: string; cursor?: string; limit?: number } = {}) =>
    http.get('/admin/dashboard/notifications', { params }),
  charts: (days = 7) => http.get('/admin/dashboard/charts', { params: { days } }),
  errorClusters: (days = 7) =>
    http.get('/admin/dashboard/error-clusters', { params: { days } }),
};

export const realtimeApi = {
  ticket: () => http.post('/admin/realtime/ticket'),
};

export const conversationsApi = {
  list: (params: { status?: 'open' | 'closed' | 'all'; unread?: boolean; search?: string; page?: number; pageSize?: number } = {}) =>
    http.get('/admin/conversations', { params }),
  update: (id: string, data: { status: 'open' | 'closed' }) =>
    http.patch(`/admin/conversations/${encodeURIComponent(id)}`, data),
};

export const projectsApi = {
  list: () => http.get('/admin/projects'),
  get: (id: string) => http.get(`/admin/projects/${id}`),
  create: (data: { name: string; description?: string }) =>
    http.post('/admin/projects', data),
  update: (id: string, data: any) => http.patch(`/admin/projects/${id}`, data),
  remove: (id: string) => http.delete(`/admin/projects/${id}`),
  resetKey: (id: string) => http.post(`/admin/projects/${id}/reset-key`),
  listKeys: (id: string) => http.get(`/admin/projects/${id}/keys`),
  createKey: (id: string, data: { name: string; expiresAt?: string }) =>
    http.post(`/admin/projects/${id}/keys`, data),
  revokeKey: (id: string, keyId: string) =>
    http.post(`/admin/projects/${id}/keys/${keyId}/revoke`),
  deleteKey: (id: string, keyId: string) =>
    http.delete(`/admin/projects/${id}/keys/${keyId}`),
  inboundErrors: (id: string, limit = 20) =>
    http.get(`/admin/projects/${id}/inbound-errors`, { params: { limit } }),
  simulateSend: (id: string, data: any = {}) =>
    http.post(`/admin/projects/${id}/simulate-send`, data),
};

export const settingsApi = {
  get: () => http.get('/admin/settings'),
  update: (data: Record<string, any>) => http.put('/admin/settings', data),
};

export const partnersApi = {
  list: () => http.get('/admin/partners'),
  create: (data: any) => http.post('/admin/partners', data),
  update: (id: string, data: any) => http.patch(`/admin/partners/${id}`, data),
  remove: (id: string) => http.delete(`/admin/partners/${id}`),
};

export const publicSiteApi = {
  site: () => http.get('/public/site'),
  partners: () => http.get('/public/partners'),
};

export const channelsApi = {
  list: () => http.get('/admin/channels'),
  create: (data: any) => http.post('/admin/channels', data),
  update: (id: string, data: any) => http.patch(`/admin/channels/${id}`, data),
  remove: (id: string) => http.delete(`/admin/channels/${id}`),
  test: (id: string) => http.post(`/admin/channels/${id}/test`),
  probe: (id: string) => http.post(`/admin/channels/${id}/probe`),
  health: () => http.get('/admin/channels/health'),
  probeAll: () => http.post('/admin/channels/health/probe'),
  setDefault: (id: string) => http.post(`/admin/channels/${id}/set-default`),
  listBindings: (projectId: string) =>
    http.get(`/admin/projects/${projectId}/channels`),
  listOptions: (projectId: string) =>
    http.get(`/admin/projects/${projectId}/channel-options`),
  bind: (
    projectId: string,
    data: {
      channelId: string;
      enabled?: boolean;
      isDefault?: boolean;
      isBackup?: boolean;
      priority?: number;
    },
  ) => http.post(`/admin/projects/${projectId}/channels`, data),
  updateBinding: (
    projectId: string,
    channelId: string,
    data: {
      enabled?: boolean;
      isDefault?: boolean;
      isBackup?: boolean;
      priority?: number;
    },
  ) => http.patch(`/admin/projects/${projectId}/channels/${channelId}`, data),
  unbind: (projectId: string, channelId: string) =>
    http.delete(`/admin/projects/${projectId}/channels/${channelId}`),
  setProjectDefault: (projectId: string, channelId: string) =>
    http.post(`/admin/projects/${projectId}/channels/${channelId}/set-default`),
  setProjectBackup: (projectId: string, channelId: string) =>
    http.post(`/admin/projects/${projectId}/channels/${channelId}/set-backup`),
  /** channelIds 数组顺序即兜底优先级（从前到后） */
  reorder: (projectId: string, channelIds: string[]) =>
    http.post(`/admin/projects/${projectId}/channel-options/reorder`, { channelIds }),
};

export const templatesApi = {
  versions: (id: string) => http.get(`/admin/templates/${id}/versions`),
  draft: (id: string, data: any) => http.put(`/admin/templates/${id}/draft`, data),
  publish: (id: string) => http.post(`/admin/templates/${id}/publish`),
  rollback: (id: string, revision: number) => http.post(`/admin/templates/${id}/rollback`, { revision }),
  list: (
    params:
      | { projectId?: string; enabled?: boolean; includeGlobal?: boolean }
      | string = {},
  ) => {
    const p =
      typeof params === 'string'
        ? { projectId: params, includeGlobal: 'true' }
        : {
            ...(params.projectId ? { projectId: params.projectId } : {}),
            ...(params.enabled === undefined ? {} : { enabled: String(params.enabled) }),
            ...(params.includeGlobal ? { includeGlobal: 'true' } : {}),
          };
    return http.get('/admin/templates', { params: p });
  },
  get: (id: string) => http.get(`/admin/templates/${id}`),
  create: (data: any) => http.post('/admin/templates', data),
  update: (id: string, data: any) => http.patch(`/admin/templates/${id}`, data),
  remove: (id: string) => http.delete(`/admin/templates/${id}`),
  copy: (id: string, data: any = {}) => http.post(`/admin/templates/${id}/copy`, data),
  preview: (id: string, variables: Record<string, unknown> = {}) =>
    http.post(`/admin/templates/${id}/preview`, { variables }),
  seedDefaults: (projectId?: string | null) =>
    http.post('/admin/templates/seed-defaults', { projectId: projectId ?? null }),
};

export const pushTemplatesApi = {
  versions: (id: string) => http.get(`/admin/push-templates/${id}/versions`),
  draft: (id: string, data: any) => http.put(`/admin/push-templates/${id}/draft`, data),
  publish: (id: string) => http.post(`/admin/push-templates/${id}/publish`),
  rollback: (id: string, revision: number) => http.post(`/admin/push-templates/${id}/rollback`, { revision }),
  list: (
    params:
      | { projectId?: string; enabled?: boolean; includeGlobal?: boolean }
      | string = {},
  ) => {
    const p =
      typeof params === 'string'
        ? { projectId: params, includeGlobal: 'true' }
        : {
            ...(params.projectId ? { projectId: params.projectId } : {}),
            ...(params.enabled === undefined ? {} : { enabled: String(params.enabled) }),
            ...(params.includeGlobal ? { includeGlobal: 'true' } : {}),
          };
    return http.get('/admin/push-templates', { params: p });
  },
  get: (id: string) => http.get(`/admin/push-templates/${id}`),
  create: (data: any) => http.post('/admin/push-templates', data),
  update: (id: string, data: any) => http.patch(`/admin/push-templates/${id}`, data),
  remove: (id: string) => http.delete(`/admin/push-templates/${id}`),
  preview: (id: string, variables: Record<string, unknown> = {}) =>
    http.post(`/admin/push-templates/${id}/preview`, { variables }),
  seedDefaults: (projectId?: string | null) =>
    http.post('/admin/push-templates/seed-defaults', { projectId: projectId ?? null }),
};

export const messagesApi = {
  conversation: (id: string, params: { before?: string; limit?: number } = {}) => http.get(`/admin/messages/${encodeURIComponent(id)}/conversation`, { params }),
  reply: (id: string, data: { content: string; clientId: string }) => http.post(`/admin/messages/${encodeURIComponent(id)}/reply`, data),
  retention: () => http.get('/admin/messages/retention'),
  setRetention: (days: number) => http.post('/admin/messages/retention', { days }),
  timeline: (id: string) => http.get(`/admin/messages/${id}/timeline`),
  list: (params: Record<string, any> = {}) =>
    http.get('/admin/messages', { params }),
  get: (id: string) => http.get(`/admin/messages/${id}`),
  send: (data: any) => http.post('/admin/messages/send', data),
  batch: (data: any) => http.post('/admin/messages/batch', data),
  batchPreview: (data: any) => http.post('/admin/messages/batch-preview', data),
  batchResend: (data: any) => http.post('/admin/messages/batch-resend', data),
  resend: (id: string) => http.post(`/admin/messages/${id}/resend`),
  resendUnread: (id: string) => http.post(`/admin/messages/${id}/resend-unread`),
  deviceHistory: (params: Record<string, any> = {}) =>
    http.get('/admin/messages/device-history', { params }),
  clear: (data: { projectId?: string; onlyFailed?: boolean; before?: string } = {}) =>
    http.post('/admin/messages/clear', data),
  markRead: (ids: string[]) => http.post('/admin/messages/mark-read', { ids }),
  archive: (ids: string[], archived = true) =>
    http.post('/admin/messages/archive', { ids, archived }),
  cleanup: (data: any = {}) => http.post('/admin/messages/cleanup', data),
  recipientTimeline: (params: { address: string; projectId?: string; limit?: number }) =>
    http.get('/admin/recipients/timeline', { params }),
  /** CSV 下载（绕过解包拦截器） */
  exportCsv: async (params: Record<string, any> = {}) => {
    const auth = useAuthStore();
    const res = await axios.get('/api/admin/messages/export', {
      params,
      responseType: 'blob',
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
    });
    return res.data as Blob;
  },
};

export const suppressApi = {
  list: (params: Record<string, any> = {}) =>
    http.get('/admin/suppress', { params }),
  add: (data: any) => http.post('/admin/suppress', data),
  remove: (id: string) => http.delete(`/admin/suppress/${id}`),
};

export const projectHealthApi = {
  get: (id: string) => http.get(`/admin/projects/${id}/health`),
};

export const schedulesApi = {
  resolve: (id: string, data: { action: 'delivered' | 'retry'; acknowledgeDuplicateRisk?: boolean }) => http.post(`/admin/schedules/${id}/resolve`, data),
  list: (params: Record<string, any> = {}) =>
    http.get('/admin/schedules', { params }),
  create: (data: any) => http.post('/admin/schedules', data),
  cancel: (id: string) => http.delete(`/admin/schedules/${id}`),
  get: (id: string) => http.get(`/admin/schedules/${id}`),
  executions: (id: string, params: { page?: number; pageSize?: number } = {}) => http.get(`/admin/schedules/${encodeURIComponent(id)}/executions`, { params }),
  update: (id: string, data: any) => http.patch(`/admin/schedules/${id}`, data),
  pause: (id: string) => http.post(`/admin/schedules/${id}/pause`),
  resume: (id: string) => http.post(`/admin/schedules/${id}/resume`),
};

export const devicesApi = {
  list: () => http.get('/admin/devices'),
  createPairingCode: (channelId: string) => http.post('/admin/devices/pair-codes', { channelId }),
  revoke: (id: string) => http.delete(`/admin/devices/${encodeURIComponent(id)}`),
};

export const operationsApi = {
  version: () => http.get('/admin/operations/version'),
  backupStatus: () => http.get('/admin/operations/backup/status'),
  updateBackupConfig: (data: { enabled?: boolean; intervalHours?: number; retentionCount?: number; verifyAfterBackup?: boolean }) => http.put('/admin/operations/backup/config', data),
  runBackup: () => http.post('/admin/operations/backup/run'),
  verifyBackup: (backupId: string) => http.post('/admin/operations/backup/verify', { backupId }),
};

export const queueApi = {
  stats: () => http.get('/admin/queue/stats'),
  failed: () => http.get('/admin/queue/failed', { params: { limit: 200 } }),
  delayed: () => http.get('/admin/queue/delayed', { params: { limit: 200 } }),
  retry: (id: string) => http.post(`/admin/queue/failed/${encodeURIComponent(id)}/retry`),
  remove: (id: string) => http.post(`/admin/queue/failed/${encodeURIComponent(id)}/remove`),
};

export const backupApi = {
  export: (options: { password?: string; redact?: boolean } = {}) => http.post('/admin/backup/export', options),
  preview: (data: any) => http.post('/admin/backup/preview', data),
  import: (data: any) => http.post('/admin/backup/import', data),
};

export const activityApi = {
  list: (params: Record<string, any> = {}) =>
    http.get('/admin/activity', { params }),
  clear: (data: { action?: string; resource?: string; before?: string } = {}) =>
    http.post('/admin/activity/clear', data),
};

export const eventsApi = {
  list: (projectId?: string) =>
    http.get('/admin/events', { params: projectId ? { projectId } : {} }),
  get: (id: string) => http.get(`/admin/events/${id}`),
  create: (data: any) => http.post('/admin/events', data),
  update: (id: string, data: any) => http.patch(`/admin/events/${id}`, data),
  remove: (id: string) => http.delete(`/admin/events/${id}`),
};

export const publicApi = {
  unsubscribePreview: (token: string) =>
    http.get('/public/unsubscribe/preview', { params: { token } }),
  unsubscribe: (token: string) => http.post('/public/unsubscribe', { token }),
};
