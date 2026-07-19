<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">渠道管理</div>
        <div class="page-subtitle">
          全局配置推送渠道，在项目详情中一键启用即可使用
        </div>
      </div>
      <n-button type="primary" @click="openCreate">新增渠道</n-button>
    </div>

    <div class="table-shell">
      <n-data-table
        :columns="columns"
        :data="list"
        :loading="loading"
        :bordered="false"
        :scroll-x="900"
      />
    </div>

    <n-drawer v-model:show="showForm" :width="drawerWidth" placement="right">
      <n-drawer-content :title="editing ? '编辑渠道' : '新增渠道'" closable>
        <n-form label-placement="top">
          <n-form-item label="名称" required>
            <n-input v-model:value="form.name" placeholder="例如：生产告警钉钉" />
          </n-form-item>
          <n-form-item label="类型" required>
            <n-select
              v-model:value="form.type"
              :options="typeOptions"
              :disabled="!!editing"
              @update:value="onTypeChange"
            />
          </n-form-item>

          <template v-if="form.type === 'SERVERCHAN'">
            <n-form-item label="SendKey" required>
              <n-input v-model:value="form.config.sendKey" placeholder="SCTxxxx" />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'PUSHPLUS'">
            <n-form-item label="Token" required>
              <n-input v-model:value="form.config.token" />
            </n-form-item>
            <n-form-item label="模板">
              <n-input v-model:value="form.config.template" placeholder="html / markdown / txt" />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'DINGTALK'">
            <n-form-item label="Webhook" required>
              <n-input v-model:value="form.config.webhook" type="textarea" />
            </n-form-item>
            <n-form-item label="加签 Secret">
              <n-input v-model:value="form.config.secret" placeholder="可选" />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'TELEGRAM'">
            <n-form-item label="Bot Token" required>
              <n-input v-model:value="form.config.botToken" />
            </n-form-item>
            <n-form-item label="Chat ID" required>
              <n-input v-model:value="form.config.chatId" />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'WEBHOOK'">
            <n-alert type="info" :bordered="false" class="mb-3">
              标准 Webhook：仅 HTTPS；系统以 POST 发送；密钥以
              <code>Authorization: Bearer &lt;密钥&gt;</code> 写入请求头。可选 HMAC：
              <code>X-Timestamp</code> + 签名头。
            </n-alert>
            <n-form-item label="Webhook 地址（HTTPS）" required>
              <n-input
                v-model:value="form.config.url"
                placeholder="https://example.com/hooks/notify"
              />
            </n-form-item>
            <n-form-item label="接口凭证（Bearer 密钥）">
              <n-input
                v-model:value="form.config.secret"
                type="password"
                show-password-on="click"
                placeholder="对方用于校验的密钥，可空"
              />
            </n-form-item>
            <n-form-item label="HMAC Secret">
              <n-input
                v-model:value="form.config.hmacSecret"
                type="password"
                show-password-on="click"
                placeholder="可选，签名串 timestamp.body"
              />
            </n-form-item>
            <n-form-item label="HMAC 头名">
              <n-input v-model:value="form.config.hmacHeader" placeholder="默认 X-Signature-256" />
            </n-form-item>
            <n-form-item label="签名格式">
              <n-select
                v-model:value="form.config.signMode"
                :options="[
                  { label: 'sha256 hex（sha256=...）', value: 'sha256_hex' },
                  { label: 'sha256 base64', value: 'sha256_base64' },
                ]"
                clearable
                placeholder="默认 hex"
              />
            </n-form-item>
            <n-form-item label="Body 模板 (Handlebars，可选)">
              <n-input v-model:value="form.config.bodyTemplate" type="textarea" :rows="4" />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'FEISHU'">
            <n-alert type="info" :bordered="false" class="mb-3">
              飞书自定义机器人 Webhook，仅 HTTPS。
            </n-alert>
            <n-form-item label="Webhook" required>
              <n-input
                v-model:value="form.config.webhook"
                type="textarea"
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
              />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'DISCORD'">
            <n-alert type="info" :bordered="false" class="mb-3">
              Discord Incoming Webhook，仅 HTTPS。
            </n-alert>
            <n-form-item label="Webhook URL" required>
              <n-input
                v-model:value="form.config.webhookUrl"
                type="textarea"
                placeholder="https://discord.com/api/webhooks/..."
              />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'SMTP'">
            <n-form-item label="Host" required>
              <n-input v-model:value="form.config.host" placeholder="smtp.example.com" />
            </n-form-item>
            <n-form-item label="Port" required>
              <n-input-number v-model:value="form.config.port" class="w-full" />
            </n-form-item>
            <n-form-item label="Secure (SSL)">
              <n-switch v-model:value="form.config.secure" />
            </n-form-item>
            <n-form-item label="用户名" required>
              <n-input v-model:value="form.config.user" />
            </n-form-item>
            <n-form-item label="密码" required>
              <n-input v-model:value="form.config.pass" type="password" show-password-on="click" />
            </n-form-item>
            <n-form-item label="发件人 From" required>
              <n-input v-model:value="form.config.from" placeholder="noreply@example.com" />
            </n-form-item>
            <n-form-item label="发件人名称">
              <n-input v-model:value="form.config.fromName" />
            </n-form-item>
            <n-form-item label="测试收件人">
              <n-input v-model:value="form.config.testTo" placeholder="连通测试时发送到此邮箱" />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'INBOX'">
            <n-alert type="info" :bordered="false" class="mb-3">
              站内渠道不需要任何外部配置。消息只写入本平台发送记录，并通过后台实时弹窗提醒。
            </n-alert>
          </template>
          <template v-else-if="form.type === 'BARK'">
            <n-alert type="info" :bordered="false" class="mb-3">
              Bark 推送到 iOS。开放接入地址为
              <code>POST /api/bark</code>，凭证统一用项目 API Key（Bearer）。
            </n-alert>
            <n-form-item label="Device Key" required>
              <n-input
                v-model:value="form.config.deviceKey"
                type="password"
                show-password-on="click"
                placeholder="Bark App 中的设备 Key"
              />
            </n-form-item>
            <n-form-item label="服务器地址">
              <n-input
                v-model:value="form.config.serverUrl"
                placeholder="默认 https://api.day.app，可填自建"
              />
            </n-form-item>
            <n-form-item label="默认分组 group">
              <n-input v-model:value="form.config.group" placeholder="可选" />
            </n-form-item>
            <n-form-item label="默认铃声 sound">
              <n-input v-model:value="form.config.sound" placeholder="可选，如 alarm" />
            </n-form-item>
            <n-form-item label="默认图标 icon">
              <n-input v-model:value="form.config.icon" placeholder="可选，HTTPS 图片 URL" />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'GOTIFY'">
            <n-alert type="info" :bordered="false" class="mb-3">
              Gotify 自托管推送。开放接入
              <code>POST /api/gotify</code>，凭证统一用项目 API Key（Bearer）。
            </n-alert>
            <n-form-item label="服务器地址" required>
              <n-input
                v-model:value="form.config.serverUrl"
                placeholder="https://gotify.example.com"
              />
            </n-form-item>
            <n-form-item label="App Token" required>
              <n-input
                v-model:value="form.config.appToken"
                type="password"
                show-password-on="click"
                placeholder="Gotify 应用 Token"
              />
            </n-form-item>
            <n-form-item label="默认优先级 priority（0-10）">
              <n-input-number
                v-model:value="form.config.priority"
                :min="0"
                :max="10"
                class="w-full"
                placeholder="默认 5"
              />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'JPUSH'">
            <n-alert type="info" :bordered="false" class="mb-3">
              极光推送 Android。默认按 <b>Registration ID</b> 下发到棱镜浏览器。
              AppKey / Master Secret 仅保存在服务端，勿写入 APK。
              客户端设置页可复制 RID。
            </n-alert>
            <n-form-item label="AppKey" required>
              <n-input
                v-model:value="form.config.appKey"
                type="password"
                show-password-on="click"
                placeholder="极光控制台 AppKey"
              />
            </n-form-item>
            <n-form-item label="Master Secret" required>
              <n-input
                v-model:value="form.config.masterSecret"
                type="password"
                show-password-on="click"
                placeholder="极光控制台 Master Secret"
              />
            </n-form-item>
            <n-form-item label="发送方式">
              <n-select
                v-model:value="form.config.audienceMode"
                :options="[
                  { label: '按 Registration ID（推荐）', value: 'registration_id' },
                  { label: '按 Alias', value: 'alias' },
                  { label: '广播 all（慎用）', value: 'all' },
                ]"
              />
            </n-form-item>
            <n-form-item
              v-if="form.config.audienceMode !== 'alias' && form.config.audienceMode !== 'all'"
              label="Registration ID"
              required
            >
              <n-input
                v-model:value="form.config.registrationId"
                type="textarea"
                :rows="2"
                placeholder="从棱镜设置 → 推送 → 复制 RID；多个用逗号分隔"
              />
            </n-form-item>
            <n-form-item v-if="form.config.audienceMode === 'alias'" label="Alias" required>
              <n-input v-model:value="form.config.alias" placeholder="设备别名" />
            </n-form-item>
            <n-form-item label="离线保留秒数 timeToLive">
              <n-input-number
                v-model:value="form.config.timeToLive"
                :min="60"
                :max="864000"
                class="w-full"
                placeholder="默认 86400"
              />
            </n-form-item>
            <n-alert type="warning" :bordered="false" class="mb-3">
              timeToLive 只控制「手机离线时极光保留推送多久」，
              <b>不是</b>未读邮件兜底时间。未读邮件兜底请在「项目详情 → 未读邮件兜底」设置（分钟）。
            </n-alert>
          </template>

          <n-form-item label="全局默认">
            <n-switch v-model:value="form.isDefault" />
          </n-form-item>
          <n-form-item label="启用">
            <n-switch v-model:value="form.enabled" />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="showForm = false">取消</n-button>
            <n-button type="primary" :loading="saving" @click="save">保存</n-button>
          </n-space>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import {
  NAlert,
  NButton,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NSpace,
  NTag,
  useMessage,
  useDialog,
} from 'naive-ui';
import { channelsApi } from '@/api';
import { CHANNEL_TYPE_LABELS, CHANNEL_TYPES, formatTime } from '@/utils/labels';

const list = ref<any[]>([]);
const loading = ref(false);
const showForm = ref(false);
const saving = ref(false);
const editing = ref<any>(null);
const message = useMessage();
const dialog = useDialog();

const drawerWidth = computed(() =>
  typeof window !== 'undefined' && window.innerWidth < 640 ? Math.min(window.innerWidth - 16, 480) : 480,
);

const typeOptions = CHANNEL_TYPES.map((t) => ({ label: CHANNEL_TYPE_LABELS[t], value: t }));

const emptyConfig = () => ({
  sendKey: '',
  token: '',
  template: 'html',
  webhook: '',
  webhookUrl: '',
  secret: '',
  hmacSecret: '',
  hmacHeader: '',
  signMode: '' as string,
  botToken: '',
  chatId: '',
  url: '',
  method: 'POST',
  bodyTemplate: '',
  host: '',
  port: 465 as number | null,
  secure: true,
  user: '',
  pass: '',
  from: '',
  fromName: '',
  testTo: '',
  deviceKey: '',
  serverUrl: '',
  group: '',
  sound: '',
  icon: '',
  appToken: '',
  priority: 5 as number | null,
  appKey: '',
  masterSecret: '',
  registrationId: '',
  alias: '',
  audienceMode: 'registration_id',
  timeToLive: 86400 as number | null,
});

const form = reactive({
  name: '',
  type: 'DINGTALK',
  config: emptyConfig(),
  enabled: true,
  isDefault: false,
});

const columns = [
  {
    title: '名称',
    key: 'name',
    render: (r: any) => h('div', { class: 'font-semibold text-slate-800' }, r.name),
  },
  {
    title: '类型',
    key: 'type',
    width: 120,
    render: (r: any) => CHANNEL_TYPE_LABELS[r.type] || r.type,
  },
  {
    title: '默认',
    key: 'isDefault',
    width: 80,
    render: (r: any) =>
      r.isDefault ? h(NTag, { type: 'info', size: 'small' }, { default: () => '默认' }) : '-',
  },
  {
    title: '状态',
    key: 'enabled',
    width: 80,
    render: (r: any) =>
      h(NTag, { type: r.enabled ? 'success' : 'default', size: 'small' }, {
        default: () => (r.enabled ? '启用' : '禁用'),
      }),
  },
  {
    title: '绑定项目',
    key: 'bindings',
    width: 100,
    render: (r: any) => r._count?.bindings ?? 0,
  },
  {
    title: '更新时间',
    key: 'updatedAt',
    width: 170,
    render: (r: any) => formatTime(r.updatedAt),
  },
  {
    title: '操作',
    key: 'actions',
    width: 280,
    fixed: 'right' as const,
    render: (r: any) =>
      h(NSpace, { wrap: false }, {
        default: () => {
          const btns = [
            h(NButton, { size: 'small', onClick: () => openEdit(r) }, { default: () => '编辑' }),
            h(
              NButton,
              { size: 'small', type: 'primary', secondary: true, onClick: () => test(r) },
              { default: () => '测试' },
            ),
            h(
              NButton,
              { size: 'small', secondary: true, onClick: () => setDefault(r) },
              { default: () => '设默认' },
            ),
          ];
          if (r.type !== 'INBOX') {
            btns.push(
              h(
                NButton,
                { size: 'small', type: 'error', secondary: true, onClick: () => remove(r) },
                { default: () => '删除' },
              ),
            );
          }
          return btns;
        },
      }),
  },
];

async function load() {
  loading.value = true;
  try {
    list.value = (await channelsApi.list()) || [];
  } finally {
    loading.value = false;
  }
}

function onTypeChange() {
  form.config = emptyConfig();
}

function openCreate() {
  editing.value = null;
  form.name = '';
  form.type = 'DINGTALK';
  form.config = emptyConfig();
  form.enabled = true;
  form.isDefault = false;
  showForm.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  form.name = row.name;
  form.type = row.type;
  form.config = { ...emptyConfig(), ...(row.config || {}) };
  form.enabled = row.enabled;
  form.isDefault = row.isDefault;
  showForm.value = true;
}

function buildConfig() {
  if (form.type === 'INBOX') return {};
  const c: any = { ...form.config };
  if (form.type === 'SMTP') {
    c.port = Number(c.port);
  }
  if (form.type === 'GOTIFY' && c.priority != null) {
    c.priority = Number(c.priority);
  }
  if (form.type === 'JPUSH') {
    if (c.timeToLive != null) c.timeToLive = Number(c.timeToLive);
    if (!c.audienceMode) c.audienceMode = 'registration_id';
  }
  return c;
}

async function save() {
  if (!form.name.trim()) {
    message.warning('请填写名称');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await channelsApi.update(editing.value.id, {
        name: form.name,
        config: buildConfig(),
        enabled: form.enabled,
        isDefault: form.isDefault,
      });
    } else {
      await channelsApi.create({
        name: form.name,
        type: form.type,
        config: buildConfig(),
        enabled: form.enabled,
        isDefault: form.isDefault,
      });
    }
    message.success('已保存');
    showForm.value = false;
    await load();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function test(row: any) {
  try {
    const res: any = await channelsApi.test(row.id);
    if (res.success) {
      const parts = [`连通成功（${res.durationMs}ms）`];
      if (res.messageId) parts.push(`消息ID ${String(res.messageId).slice(0, 10)}…`);
      if (res.extras?.hasReadToken) parts.push('已注入 readToken');
      const fb = res.unreadEmailFallback;
      if (fb?.scheduled) {
        parts.push(
          `已排邮件兜底 ${fb.minutes ?? '?'} 分钟` +
            (fb.runAt ? ` · 计划 ${new Date(fb.runAt).toLocaleString('zh-CN', { hour12: false })}` : ''),
        );
      } else if (fb?.reason === 'project_fallback_disabled') {
        parts.push('项目未开启未读邮件兜底');
      } else if (fb?.reason === 'channel_not_bound_to_project') {
        parts.push('渠道未绑定项目，未排兜底');
      }
      message.success(parts.join(' · '));
    } else {
      message.error(res.errorMessage || '测试失败');
    }
  } catch (e: any) {
    message.error(e.message);
  }
}

async function setDefault(row: any) {
  await channelsApi.setDefault(row.id);
  message.success('已设为默认');
  await load();
}

function remove(row: any) {
  if (row.type === 'INBOX') {
    message.warning('站内通知渠道不允许删除');
    return;
  }
  dialog.warning({
    title: '删除渠道',
    content: `确认删除「${row.name}」？已绑定的项目将同步解绑。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await channelsApi.remove(row.id);
      message.success('已删除');
      await load();
    },
  });
}

onMounted(load);
</script>
