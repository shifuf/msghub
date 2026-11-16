<template>
  <div class="settings-page space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">系统设置</div>
        <div class="page-subtitle">账号、通知偏好、配置备份与开放 API</div>
      </div>
    </div>

    <div class="settings-grid">
      <div class="page-card settings-card">
        <div class="card-head">
          <div class="card-icon c-blue">
            <AppIcon name="person" :size="20" color="#fff" />
          </div>
          <div>
            <div class="card-title">账号安全</div>
            <div class="card-sub">当前登录的超级管理员</div>
          </div>
        </div>
        <div class="account-row">
          <div class="account-avatar">
            <AppIcon name="person" :size="22" color="#fff" />
          </div>
          <div class="min-w-0">
            <div class="account-name">{{ auth.user?.username || 'admin' }}</div>
            <div class="account-tip">个人单用户模式 · 无多管理员</div>
          </div>
        </div>
        <n-form label-placement="top" class="mt-3">
          <n-form-item label="原密码">
            <n-input
              v-model:value="form.oldPassword"
              type="password"
              show-password-on="click"
              autocomplete="current-password"
              placeholder="请输入原密码"
            />
          </n-form-item>
          <n-form-item label="新密码">
            <n-input
              v-model:value="form.newPassword"
              type="password"
              show-password-on="click"
              autocomplete="new-password"
              placeholder="12–72 位"
            />
          </n-form-item>
          <n-form-item label="确认新密码">
            <n-input
              v-model:value="form.confirm"
              type="password"
              show-password-on="click"
              autocomplete="new-password"
              placeholder="再次输入新密码"
            />
          </n-form-item>
          <n-button type="primary" block :loading="loading" @click="submit">
            <template #icon><AppIcon name="key" :size="16" /></template>
            保存新密码
          </n-button>
        </n-form>
        <div class="mt-4 space-y-3">
          <div>双重验证：{{ auth.user?.totpEnabled ? '已开启' : '未开启' }}</div>
          <n-input v-model:value="totpPassword" type="password" placeholder="确认当前密码" autocomplete="current-password" />
          <n-button v-if="!auth.user?.totpEnabled" @click="setupTotp">配置验证器</n-button>
          <div v-if="totpSecret" class="break-all text-sm">在验证器中添加密钥：<code>{{ totpSecret }}</code></div>
          <n-input v-model:value="totpCode" placeholder="验证器中的 6 位验证码" :maxlength="6" autocomplete="one-time-code" />
          <n-button v-if="totpSecret" type="primary" @click="enableTotp">确认开启</n-button>
          <n-button v-if="auth.user?.totpEnabled" @click="disableTotp">关闭双重验证</n-button>
          <n-button block secondary @click="revokeSessions">撤销所有登录会话</n-button>
        </div>
      </div>

      <div class="page-card settings-card">
        <div class="card-head">
          <div class="card-icon c-amber">
            <AppIcon name="bell" :size="20" color="#fff" />
          </div>
          <div>
            <div class="card-title">桌面通知</div>
            <div class="card-sub">浏览器系统级失败提醒</div>
          </div>
        </div>
        <p class="card-desc">
          开启后，发送失败会通过浏览器 Notification 提醒（需授权）。偏好保存在本地
          <code>msg_desktop_notify</code>。
        </p>
        <div class="status-row">
          <div class="status-item">
            <div class="status-label">浏览器权限</div>
            <n-tag size="small" :type="permissionTagType">{{ permissionLabel }}</n-tag>
          </div>
          <div class="status-item">
            <div class="status-label">本地偏好</div>
            <n-tag size="small" :type="desktopEnabled ? 'success' : 'default'">
              {{ desktopEnabled ? '已开启' : '未开启' }}
            </n-tag>
          </div>
        </div>
        <div class="btn-stack">
          <n-button type="primary" secondary block @click="requestDesktopNotify">
            <template #icon><AppIcon name="bell" :size="16" /></template>
            请求通知权限
          </n-button>
          <n-button v-if="desktopEnabled" block @click="disableDesktopNotify">关闭偏好</n-button>
          <n-button
            v-else
            block
            :disabled="notifyPermission !== 'granted'"
            @click="enableDesktopNotify"
          >
            开启偏好
          </n-button>
        </div>
      </div>

      <div class="page-card settings-card">
        <div class="card-head">
          <div class="card-icon c-green">
            <AppIcon name="mail" :size="20" color="#fff" />
          </div>
          <div>
            <div class="card-title">全局管理员邮箱</div>
            <div class="card-sub">项目未填邮箱时的邮件兜底收件人</div>
          </div>
        </div>
        <p class="card-desc">
          派发链：外发渠道失败后，发 SMTP 到「项目 adminEmail → 全局 adminEmail」；再不行写站内。
        </p>
        <n-form label-placement="top">
          <n-form-item label="全局管理员邮箱">
            <n-input
              v-model:value="siteForm.globalAdminEmail"
              placeholder="admin@example.com"
            />
          </n-form-item>
          <n-button type="primary" block :loading="savingSite" @click="saveSite">
            保存
          </n-button>
        </n-form>
      </div>

      <div class="page-card settings-card settings-card-wide">
        <div class="card-head">
          <div class="card-icon c-violet">
            <AppIcon name="document" :size="20" color="#fff" />
          </div>
          <div>
            <div class="card-title">站点信息 / 备案</div>
            <div class="card-sub">门户页底部展示 · 备案号可填</div>
          </div>
        </div>
        <n-form label-placement="top" class="site-form-grid">
          <n-form-item label="站点名称">
            <n-input v-model:value="siteForm.siteName" placeholder="消息推送平台" />
          </n-form-item>
          <n-form-item label="站点简介">
            <n-input v-model:value="siteForm.siteDescription" placeholder="一句话介绍" />
          </n-form-item>
          <n-form-item label="ICP 备案号">
            <n-input v-model:value="siteForm.siteIcp" placeholder="如 京ICP备xxxxxxxx号" />
          </n-form-item>
          <n-form-item label="公安备案号">
            <n-input v-model:value="siteForm.sitePolice" placeholder="如 京公网安备 xxxxxxxx号" />
          </n-form-item>
          <n-form-item label="公安备案链接">
            <n-input v-model:value="siteForm.sitePoliceUrl" placeholder="https://www.beian.gov.cn/..." />
          </n-form-item>
          <n-form-item label="版权文案">
            <n-input v-model:value="siteForm.siteCopyright" placeholder="留空则显示 © 年份 站点名" />
          </n-form-item>
          <n-form-item label="联系邮箱">
            <n-input v-model:value="siteForm.siteContactEmail" placeholder="可选" />
          </n-form-item>
        </n-form>
        <n-button type="primary" block :loading="savingSite" @click="saveSite">
          保存站点信息
        </n-button>
      </div>

      <div class="page-card settings-card">
        <div class="card-head">
          <div class="card-icon c-green">
            <AppIcon name="cloudDownload" :size="20" color="#fff" />
          </div>
          <div>
            <div class="card-title">配置备份</div>
            <div class="card-sub">换机迁移 / 灾备恢复</div>
          </div>
        </div>
        <p class="card-desc">
          导出/导入渠道、项目绑定、邮件模板与推送模板（不含 API Key 明文与发送记录）。
        </p>
        <div class="btn-stack">
          <n-button type="primary" secondary block :loading="exporting" @click="exportBackup">
            <template #icon><AppIcon name="download" :size="16" /></template>
            导出 JSON
          </n-button>
          <n-button block :loading="importing" @click="triggerImport">
            <template #icon><AppIcon name="upload" :size="16" /></template>
            导入 JSON
          </n-button>
        </div>
        <n-form-item label="备份密码（完整备份需要，至少 12 位）" class="mt-3">
          <n-input v-model:value="backupPassword" type="password" autocomplete="new-password" />
        </n-form-item>
        <n-switch v-model:value="redactBackup" /> <span class="text-sm">仅导出脱敏配置</span>
        <div v-if="pendingImport" class="mt-3">
          <n-button type="warning" :loading="importing" @click="confirmImport">按以下预览执行导入</n-button>
          <n-button text @click="pendingImport = null">取消</n-button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="onImportFile"
        />
        <pre v-if="importResult" class="import-result">{{ JSON.stringify(importResult, null, 2) }}</pre>
      </div>

      <div class="page-card settings-card">
        <div class="card-title">数据保留策略</div>
        <p class="card-desc">仅自动清理已结束的记录；0 表示关闭自动清理。</p>
        <n-form-item label="发送记录（天）"><n-input-number v-model:value="retentionDays" :min="0" :max="3650" :precision="0" /></n-form-item>
        <n-form-item label="操作日志（天）"><n-input-number v-model:value="activityRetentionDays" :min="0" :max="36500" :precision="0" /></n-form-item>
        <n-form-item label="敏感通知正文脱敏（天）"><n-input-number v-model:value="sensitiveRetentionDays" :min="0" :max="36500" :precision="0" /></n-form-item>
        <n-button class="mt-3" @click="saveRetention">保存保留天数</n-button>
      </div>

      <div class="page-card settings-card settings-card-wide">
        <div class="card-head">
          <div class="card-icon c-violet">
            <AppIcon name="code" :size="20" color="#fff" />
          </div>
          <div>
            <div class="card-title">开放 API 速查</div>
            <div class="card-sub">业务系统接入说明</div>
          </div>
        </div>
        <div class="api-grid">
          <div class="api-item" v-for="a in apis" :key="a.path">
            <code class="api-path">{{ a.path }}</code>
            <div class="api-desc">{{ a.desc }}</div>
          </div>
        </div>
        <div class="api-note">
          鉴权：Header <code>Authorization: Bearer msg_xxx</code>（密钥仅创建/重置时显示一次）
          · 接口：<code>/api/webhook</code>、<code>/api/bark</code>、<code>/api/gotify</code>、<code>/api/email</code>
          · 默认账号见环境变量 ADMIN_USERNAME / ADMIN_PASSWORD（上线后请立即修改）
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { NForm, NFormItem, NInput, NInputNumber, NButton, NTag, NSwitch, useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import { getAdminPath } from '@/config';
import { useNotifyStore } from '@/stores/notify';
import { authApi, backupApi, settingsApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import AppIcon from '@/components/AppIcon.vue';

const DESKTOP_KEY = 'msg_desktop_notify';

const auth = useAuthStore();
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const loading = ref(false);
const exporting = ref(false);
const importing = ref(false);
const importResult = ref<any>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const notifyPermission = ref<NotificationPermission | 'unsupported'>('default');
const desktopEnabled = ref(false);
const message = useMessage();
const router = useRouter();
const backupPassword = ref('');
const redactBackup = ref(true);
const pendingImport = ref<any>(null);
const totpPassword = ref('');
const totpCode = ref('');
const totpSecret = ref('');
const retentionDays = ref<number | null>(0);
const activityRetentionDays = ref<number | null>(0);
const sensitiveRetentionDays = ref<number | null>(0);
async function saveRetention() {
  try {
    await settingsApi.update({ messageRetentionDays: String(retentionDays.value ?? 0), activityRetentionDays: String(activityRetentionDays.value ?? 0), sensitiveRetentionDays: String(sensitiveRetentionDays.value ?? 0) });
    message.success('保留策略已保存');
  }
  catch (e: any) { message.error(e.message); }
}
onMounted(async () => {
  try {
    const result: any = await settingsApi.get();
    retentionDays.value = Number(result.messageRetentionDays) || 0;
    activityRetentionDays.value = Number(result.activityRetentionDays) || 0;
    sensitiveRetentionDays.value = Number(result.sensitiveRetentionDays) || 0;
  }
  catch { message.warning('无法加载保留策略'); }
});
function reauthenticate() { useNotifyStore().stop(); auth.logout(); void router.replace(getAdminPath()); }
async function setupTotp() {
  try { const result: any = await authApi.setupTotp(totpPassword.value); totpSecret.value = result.secret; }
  catch (e: any) { message.error(e.message); }
}
async function enableTotp() {
  try { await authApi.enableTotp(totpCode.value); message.success('双重验证已开启，请重新登录'); reauthenticate(); }
  catch (e: any) { message.error(e.message); }
}
async function disableTotp() {
  try { await authApi.disableTotp(totpPassword.value, totpCode.value); reauthenticate(); }
  catch (e: any) { message.error(e.message); }
}
async function revokeSessions() {
  try { await authApi.revokeSessions(); reauthenticate(); }
  catch (e: any) { message.error(e.message); }
}
const siteForm = reactive({
  globalAdminEmail: '',
  siteName: '',
  siteIcp: '',
  sitePolice: '',
  sitePoliceUrl: '',
  siteCopyright: '',
  siteContactEmail: '',
  siteDescription: '',
});
const savingSite = ref(false);

const apis = [
  { path: 'POST /api/webhook', desc: '项目策略派发：外发 → 管理员邮箱 → 站内' },
  { path: 'POST /api/bark', desc: 'Bark 入站：POST + Bearer 项目 API Key' },
  { path: 'POST /api/gotify', desc: 'Gotify 入站：POST + Bearer 项目 API Key' },
  { path: 'POST /api/email', desc: '指定 to 发 SMTP（评论回邮等）' },
  { path: 'GET /api/health', desc: '健康检查' },
];

const permissionLabel = computed(() => {
  if (notifyPermission.value === 'unsupported') return '浏览器不支持';
  if (notifyPermission.value === 'granted') return '已授权';
  if (notifyPermission.value === 'denied') return '已拒绝';
  return '未请求';
});

const permissionTagType = computed(() => {
  if (notifyPermission.value === 'granted') return 'success';
  if (notifyPermission.value === 'denied') return 'error';
  return 'default';
});

function refreshNotifyState() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    notifyPermission.value = 'unsupported';
  } else {
    notifyPermission.value = Notification.permission;
  }
  desktopEnabled.value = localStorage.getItem(DESKTOP_KEY) === '1';
}

async function requestDesktopNotify() {
  if (!('Notification' in window)) {
    message.warning('当前浏览器不支持桌面通知');
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    notifyPermission.value = perm;
    if (perm === 'granted') {
      localStorage.setItem(DESKTOP_KEY, '1');
      desktopEnabled.value = true;
      message.success('已授权并开启桌面通知');
    } else if (perm === 'denied') {
      localStorage.setItem(DESKTOP_KEY, '0');
      desktopEnabled.value = false;
      message.warning('通知权限被拒绝');
    } else {
      message.info('未授予通知权限');
    }
  } catch (e: any) {
    message.error(e.message || '请求权限失败');
  }
}

function enableDesktopNotify() {
  if (Notification.permission !== 'granted') {
    message.warning('请先授权通知权限');
    return;
  }
  localStorage.setItem(DESKTOP_KEY, '1');
  desktopEnabled.value = true;
  message.success('已开启桌面通知偏好');
}

function disableDesktopNotify() {
  localStorage.setItem(DESKTOP_KEY, '0');
  desktopEnabled.value = false;
  message.success('已关闭桌面通知偏好');
}

async function saveSite() {
  savingSite.value = true;
  try {
    const res: any = await settingsApi.update({ ...siteForm });
    Object.assign(siteForm, {
      globalAdminEmail: res?.globalAdminEmail || '',
      siteName: res?.siteName || '',
      siteIcp: res?.siteIcp || '',
      sitePolice: res?.sitePolice || '',
      sitePoliceUrl: res?.sitePoliceUrl || '',
      siteCopyright: res?.siteCopyright || '',
      siteContactEmail: res?.siteContactEmail || '',
      siteDescription: res?.siteDescription || '',
    });
    message.success('站点信息已保存');
  } catch (e: any) {
    message.error(e.message || '保存失败');
  } finally {
    savingSite.value = false;
  }
}

async function loadGlobalSettings() {
  try {
    const res: any = await settingsApi.get();
    Object.assign(siteForm, {
      globalAdminEmail: res?.globalAdminEmail || '',
      siteName: res?.siteName || '',
      siteIcp: res?.siteIcp || '',
      sitePolice: res?.sitePolice || '',
      sitePoliceUrl: res?.sitePoliceUrl || '',
      siteCopyright: res?.siteCopyright || '',
      siteContactEmail: res?.siteContactEmail || '',
      siteDescription: res?.siteDescription || '',
    });
  } catch {
    /* ignore */
  }
}

async function exportBackup() {
  if (!redactBackup.value && backupPassword.value.length < 12) { message.warning('完整备份请设置至少 12 位加密密码'); return; }
  exporting.value = true;
  try {
    const data: any = await backupApi.export({ redact: redactBackup.value, password: backupPassword.value || undefined });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `msg-backup-${ymd}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('已导出配置');
  } catch (e: any) {
    message.error(e.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

function triggerImport() {
  fileInput.value?.click();
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    pendingImport.value = null;
    const payload = { data, password: backupPassword.value || undefined };
    const res: any = await backupApi.preview(payload);
    importResult.value = res;
    pendingImport.value = payload;
    message.success('预检完成，请检查差异后执行导入');
  } catch (e: any) {
    message.error(e.message || '导入失败');
  } finally {
    importing.value = false;
    input.value = '';
  }
}

async function confirmImport() {
  if (!pendingImport.value) return;
  importing.value = true;
  try { importResult.value = await backupApi.import(pendingImport.value); pendingImport.value = null; message.success('导入完成'); }
  catch (e: any) { message.error(e.message || '导入失败'); }
  finally { importing.value = false; }
}

async function submit() {
  if (!form.oldPassword || !form.newPassword) {
    message.warning('请填写完整');
    return;
  }
  if (form.newPassword.length < 12 || form.newPassword.length > 72) {
    message.warning('新密码需要 12–72 位');
    return;
  }
  if (form.newPassword !== form.confirm) {
    message.warning('两次密码不一致');
    return;
  }
  loading.value = true;
  try {
    await authApi.changePassword(form.oldPassword, form.newPassword);
    message.success('密码已修改');
    form.oldPassword = '';
    form.newPassword = '';
    form.confirm = '';
    reauthenticate();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refreshNotifyState();
  void loadGlobalSettings();
});
</script>

<style scoped>
.settings-page {
  width: 100%;
  max-width: 100%;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.settings-card {
  padding: 20px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.settings-card-wide {
  grid-column: 1 / -1;
}

.site-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
  margin-bottom: 8px;
}

@media (max-width: 720px) {
  .site-form-grid {
    grid-template-columns: 1fr;
  }
}

.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.card-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.c-blue { background: #2563eb; }
.c-amber { background: #d97706; }
.c-green { background: #059669; }
.c-violet { background: #7c3aed; }

.card-title {
  font-size: 16px;
  font-weight: 750;
  color: #0f172a;
  line-height: 1.2;
}

.card-sub {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.card-desc {
  margin: 0 0 14px;
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.05);
}

.account-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #1d4ed8;
  flex-shrink: 0;
}

.account-name {
  font-weight: 700;
  color: #0f172a;
}

.account-tip {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 2px;
}

.status-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}

.status-item {
  padding: 12px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.05);
  min-width: 0;
}

.status-label {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 6px;
}

.btn-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
}

.import-result {
  margin: 12px 0 0;
  font-size: 12px;
  background: #f8fafc;
  border-radius: 12px;
  padding: 12px;
  overflow: auto;
  max-height: 160px;
  white-space: pre-wrap;
  word-break: break-word;
}

.api-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.api-item {
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.05);
  min-width: 0;
}

.api-path {
  display: inline-block;
  font-size: 12px;
  color: #1d4ed8;
  background: #eff6ff;
  padding: 2px 8px;
  border-radius: 6px;
  word-break: break-all;
}

.api-desc {
  margin-top: 6px;
  font-size: 13px;
  color: #64748b;
}

.api-note {
  margin-top: 12px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .settings-card-wide {
    grid-column: auto;
  }
  .api-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .settings-card {
    padding: 16px;
  }
  .status-row {
    grid-template-columns: 1fr;
  }
}
</style>
