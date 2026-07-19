<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">推送模板</div>
        <div class="page-subtitle">
          项目与全局严格隔离；筛选某项目只看该项目。一键示例写入当前筛选范围
        </div>
      </div>
      <n-space wrap>
        <n-button secondary :loading="seeding" @click="seedDefaults">一键示例模板</n-button>
        <n-button type="primary" @click="openCreate">新建模板</n-button>
      </n-space>
    </div>

    <div class="page-card p-4 text-sm text-slate-600 space-y-2">
      <div class="font-semibold text-slate-800">示例模板说明</div>
      <div class="sample-grid">
        <div class="sample-item" v-for="s in samples" :key="s.code">
          <code>{{ s.code }}</code>
          <span>{{ s.name }}</span>
        </div>
      </div>
      <div class="text-xs text-slate-400">
        调用示例：开放 API <code>POST /api/webhook</code>（Bearer）传
        <code>pushTemplate: "alert"</code> 与
        <code>variables: { appName, level, service, ... }</code>
        · 仅<strong>启用</strong>模板可被发送引用
      </div>
    </div>

    <div class="page-card p-3 md:p-4 space-y-3">
      <div class="filters-row">
        <n-select
          v-model:value="filterProjectId"
          clearable
          placeholder="全部范围"
          class="w-full sm:w-52"
          :options="filterProjectOptions"
          @update:value="load"
        />
        <n-select
          v-model:value="filterEnabled"
          clearable
          placeholder="全部状态"
          class="w-full sm:w-36"
          :options="enabledOptions"
          @update:value="load"
        />
        <n-button @click="load">刷新</n-button>
      </div>

      <n-data-table
        :columns="columns"
        :data="list"
        :loading="loading"
        :bordered="false"
        :scroll-x="960"
      />
    </div>

    <n-drawer v-model:show="showDrawer" :width="drawerWidth" placement="right">
      <n-drawer-content :title="editingId ? '编辑推送模板' : '新建推送模板'" closable>
        <n-form label-placement="top">
          <n-form-item label="Code" required>
            <n-input
              v-model:value="form.code"
              :disabled="!!editingId"
              placeholder="alert / order_paid / custom_xxx"
            />
          </n-form-item>
          <n-form-item label="名称" required>
            <n-input v-model:value="form.name" />
          </n-form-item>
          <n-form-item label="所属范围">
            <n-select
              v-model:value="form.projectId"
              clearable
              :disabled="!!editingId"
              placeholder="空 = 系统全局（默认）"
              :options="projectOptions"
            />
          </n-form-item>
          <n-form-item label="标题模板">
            <n-input v-model:value="form.titleTpl" placeholder="【{{appName}}】{{title}}" />
          </n-form-item>
          <n-form-item label="正文模板" required>
            <n-input
              v-model:value="form.contentTpl"
              type="textarea"
              :rows="6"
              placeholder="{{name}} 你好，订单 {{orderId}} 已支付"
            />
          </n-form-item>
          <n-form-item label="启用">
            <n-switch v-model:value="form.enabled" />
          </n-form-item>
        </n-form>

        <div class="mt-4 space-y-3">
          <div class="text-sm font-semibold text-slate-800">预览</div>
          <n-input
            v-model:value="previewVarsText"
            type="textarea"
            :rows="4"
            placeholder='变量 JSON，例如 {"name":"张三","orderId":"A001"}'
          />
          <n-button secondary :loading="previewing" :disabled="!editingId" @click="doPreview">
            {{ editingId ? '渲染预览' : '保存后可预览' }}
          </n-button>
          <div v-if="previewResult" class="bg-slate-50 rounded-lg p-3 text-sm space-y-2">
            <div>
              <span class="text-slate-400">标题：</span>{{ previewResult.title || '（空）' }}
            </div>
            <div class="whitespace-pre-wrap">
              <span class="text-slate-400">正文：</span>{{ previewResult.content || '（空）' }}
            </div>
          </div>
        </div>

        <template #footer>
          <n-space justify="end">
            <n-button @click="showDrawer = false">取消</n-button>
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
  NButton,
  NDataTable,
  NSelect,
  NTag,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NSwitch,
  NSpace,
  useMessage,
  useDialog,
} from 'naive-ui';
import { pushTemplatesApi, projectsApi } from '@/api';
import { formatTime } from '@/utils/labels';

const list = ref<any[]>([]);
const loading = ref(false);
const seeding = ref(false);
const showDrawer = ref(false);
const saving = ref(false);
const previewing = ref(false);
const togglingId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const filterProjectId = ref<string | null>(null);
const filterEnabled = ref<boolean | null>(null);
const projectOptions = ref<{ label: string; value: string }[]>([]);
const message = useMessage();
const dialog = useDialog();
const previewVarsText = ref('{\n  "name": "张三",\n  "orderId": "A001"\n}');
const previewResult = ref<{ title?: string; content?: string } | null>(null);
const samples = [
  { code: 'alert', name: '系统告警' },
  { code: 'order_paid', name: '订单支付成功' },
  { code: 'deploy', name: '部署完成通知' },
  { code: 'login_notice', name: '登录提醒' },
  { code: 'server_status', name: '服务器状态摘要' },
  { code: 'custom_text', name: '通用文本通知' },
];

const form = reactive({
  code: '',
  name: '',
  projectId: null as string | null,
  titleTpl: '',
  contentTpl: '',
  enabled: true,
});

const enabledOptions = [
  { label: '仅启用', value: true },
  { label: '仅禁用', value: false },
];

const filterProjectOptions = computed(() => [
  { label: '仅系统全局', value: 'system' },
  ...projectOptions.value,
]);

const drawerWidth = computed(() =>
  typeof window !== 'undefined' && window.innerWidth < 640 ? window.innerWidth - 16 : 520,
);

const columns = [
  { title: 'Code', key: 'code', width: 140 },
  { title: '名称', key: 'name', ellipsis: { tooltip: true } },
  {
    title: '范围',
    key: 'scope',
    width: 150,
    render: (r: any) =>
      r.projectId
        ? h(NTag, { size: 'small', type: 'warning' }, {
            default: () => r.project?.name || '项目',
          })
        : h(NTag, { size: 'small', type: 'info' }, { default: () => '系统全局' }),
  },
  {
    title: '启用',
    key: 'enabled',
    width: 90,
    render: (r: any) =>
      h(NSwitch, {
        value: !!r.enabled,
        loading: togglingId.value === r.id,
        size: 'small',
        onUpdateValue: (v: boolean) => toggleEnabled(r, v),
      }),
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
    width: 180,
    fixed: 'right' as const,
    render: (r: any) =>
      h(NSpace, { wrap: false }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(r) }, { default: () => '编辑' }),
          h(
            NButton,
            { size: 'small', type: 'error', secondary: true, onClick: () => remove(r) },
            { default: () => '删除' },
          ),
        ],
      }),
  },
];

async function load() {
  loading.value = true;
  try {
    const params: { projectId?: string; enabled?: boolean } = {};
    if (filterProjectId.value) params.projectId = filterProjectId.value;
    if (filterEnabled.value !== null && filterEnabled.value !== undefined) {
      params.enabled = filterEnabled.value;
    }
    list.value = (await pushTemplatesApi.list(params)) || [];
  } catch (e: any) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.code = '';
  form.name = '';
  form.projectId = null;
  form.titleTpl = '';
  form.contentTpl = '';
  form.enabled = true;
  previewResult.value = null;
}

function openCreate() {
  editingId.value = null;
  resetForm();
  form.projectId =
    filterProjectId.value && filterProjectId.value !== 'system'
      ? filterProjectId.value
      : null;
  form.titleTpl = '【{{appName}}】{{title}}';
  form.contentTpl = '你好 {{username}}，\n{{content}}\n时间：{{time}}';
  previewVarsText.value = JSON.stringify(
    {
      appName: '消息推送',
      title: '测试通知',
      username: '张三',
      content: '这是一条示例正文',
      time: '2026-07-11 16:00',
    },
    null,
    2,
  );
  showDrawer.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  form.code = row.code;
  form.name = row.name;
  form.projectId = row.projectId || null;
  form.titleTpl = row.titleTpl || '';
  form.contentTpl = row.contentTpl || '';
  form.enabled = row.enabled ?? true;
  previewResult.value = null;
  const vars = Array.isArray(row.variables) ? row.variables : [];
  const demo: Record<string, string> = {
    appName: '消息推送',
    level: 'P1',
    service: 'api',
    time: '2026-07-11 16:00:00',
    message: 'CPU 持续超过 90%',
    host: 'prod-1',
    link: 'https://example.com/alerts/1',
    username: '张三',
    orderId: 'ORD-10086',
    amount: '99.00',
    product: '会员年卡',
    env: 'production',
    status: '成功',
    version: 'v1.4.0',
    operator: 'ci-bot',
    duration: '42s',
    commit: 'a1b2c3d',
    ip: '203.0.113.10',
    location: '上海',
    device: 'Chrome / Windows',
    date: '2026-07-11',
    cpu: '23',
    memory: '61',
    disk: '48',
    load: '0.42',
    note: '运行正常',
    title: '通用通知',
    content: '这是一条自定义正文',
    footer: 'Notify Hub',
    remark: '感谢支持',
  };
  const picked: Record<string, string> = {};
  for (const k of vars.length ? vars : Object.keys(demo).slice(0, 6)) {
    picked[k] = demo[k] ?? `示例${k}`;
  }
  previewVarsText.value = JSON.stringify(picked, null, 2);
  showDrawer.value = true;
}

async function save() {
  if (!form.code.trim()) {
    message.warning('请填写 Code');
    return;
  }
  if (!form.name.trim()) {
    message.warning('请填写名称');
    return;
  }
  if (!form.contentTpl.trim()) {
    message.warning('请填写正文模板');
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await pushTemplatesApi.update(editingId.value, {
        name: form.name,
        titleTpl: form.titleTpl,
        contentTpl: form.contentTpl,
        enabled: form.enabled,
      });
      message.success('已更新');
    } else {
      const created: any = await pushTemplatesApi.create({
        code: form.code,
        name: form.name,
        projectId: form.projectId || null,
        titleTpl: form.titleTpl,
        contentTpl: form.contentTpl,
        enabled: form.enabled,
      });
      editingId.value = created?.id || null;
      message.success('已创建');
    }
    await load();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(row: any, enabled: boolean) {
  togglingId.value = row.id;
  try {
    await pushTemplatesApi.update(row.id, { enabled });
    row.enabled = enabled;
    message.success(enabled ? '已启用' : '已禁用');
  } catch (e: any) {
    message.error(e.message);
  } finally {
    togglingId.value = null;
  }
}

async function doPreview() {
  if (!editingId.value) return;
  let variables: Record<string, unknown> = {};
  try {
    variables = previewVarsText.value.trim() ? JSON.parse(previewVarsText.value) : {};
  } catch {
    message.warning('变量 JSON 格式无效');
    return;
  }
  previewing.value = true;
  try {
    previewResult.value = (await pushTemplatesApi.preview(editingId.value, variables)) || null;
  } catch (e: any) {
    message.error(e.message);
  } finally {
    previewing.value = false;
  }
}

async function seedDefaults() {
  const target =
    filterProjectId.value && filterProjectId.value !== 'system'
      ? filterProjectId.value
      : null;
  const scopeLabel = target
    ? projectOptions.value.find((p) => p.value === target)?.label || '当前项目'
    : '系统全局';
  dialog.info({
    title: '写入示例模板',
    content: `将把缺失的示例模板写入「${scopeLabel}」，不会覆盖已有 code。确认继续？`,
    positiveText: '写入',
    negativeText: '取消',
    onPositiveClick: async () => {
      seeding.value = true;
      try {
        const res: any = await pushTemplatesApi.seedDefaults(target);
        const created = res?.created || [];
        message.success(
          created.length ? `已写入示例：${created.join(', ')}` : '示例模板已存在，无需重复写入',
        );
        await load();
      } catch (e: any) {
        message.error(e.message);
      } finally {
        seeding.value = false;
      }
    },
  });
}

function remove(row: any) {
  const scope = row.projectId
    ? `项目「${row.project?.name || row.projectId}」`
    : '系统全局';
  dialog.warning({
    title: '删除模板',
    content: row.projectId
      ? `确认删除${scope}的「${row.name}」（${row.code}）？仅影响本项目。`
      : `确认删除${scope}模板「${row.name}」（${row.code}）？\n各项目若未自建同 code，发送将无法再引用该全局模板。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await pushTemplatesApi.remove(row.id);
        message.success('已删除');
        await load();
      } catch (e: any) {
        message.error(e.message);
      }
    },
  });
}

onMounted(async () => {
  try {
    const projs: any = (await projectsApi.list()) || [];
    projectOptions.value = projs.map((p: any) => ({ label: p.name, value: p.id }));
  } catch (e) {
    console.error(e);
  }
  await load();
});
</script>

<style scoped>
.sample-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.sample-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.05);
  min-width: 0;
}
.sample-item code {
  color: #1d4ed8;
  background: #eff6ff;
}
</style>
