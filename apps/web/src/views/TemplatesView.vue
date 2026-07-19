<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">邮件模板</div>
        <div class="page-subtitle">
          项目与全局严格隔离；筛选某项目只看该项目。一键默认写入当前筛选范围
        </div>
      </div>
      <n-space wrap>
        <n-button secondary @click="seedDefaults">一键默认模板</n-button>
        <n-button type="primary" @click="openCreate">新建模板</n-button>
      </n-space>
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

    <n-modal
      v-model:show="showCreate"
      preset="card"
      content-scrollable
      title="新建邮件模板"
      class="app-modal"
      style="width: min(480px, calc(100vw - 24px))"
      :bordered="false"
      :mask-closable="false"
    >
      <n-form label-placement="top" class="mt-1">
        <n-form-item label="Code" required>
          <n-input v-model:value="form.code" placeholder="login / register / custom_xxx" />
        </n-form-item>
        <n-form-item label="名称" required>
          <n-input v-model:value="form.name" />
        </n-form-item>
        <n-form-item label="所属范围">
          <n-select
            v-model:value="form.projectId"
            clearable
            placeholder="空 = 系统全局（默认）"
            :options="projectOptions"
          />
        </n-form-item>
        <n-form-item label="主题">
          <n-input v-model:value="form.subject" placeholder="【{{appName}}】通知" />
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="form.enabled" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="create">创建</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
  useDialog,
} from 'naive-ui';
import { templatesApi, projectsApi } from '@/api';
import { formatTime } from '@/utils/labels';

const list = ref<any[]>([]);
const loading = ref(false);
const showCreate = ref(false);
const creating = ref(false);
const togglingId = ref<string | null>(null);
const message = useMessage();
const dialog = useDialog();
const router = useRouter();

const filterProjectId = ref<string | null>(null);
const filterEnabled = ref<boolean | null>(null);
const projectOptions = ref<{ label: string; value: string }[]>([]);

const form = reactive({
  code: '',
  name: '',
  projectId: null as string | null,
  subject: '【{{appName}}】通知',
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
    width: 220,
    fixed: 'right' as const,
    render: (r: any) =>
      h(NSpace, { wrap: false }, {
        default: () => [
          h(
            NButton,
            { size: 'small', onClick: () => router.push(`/templates/${r.id}`) },
            { default: () => '编辑' },
          ),
          h(NButton, { size: 'small', secondary: true, onClick: () => copy(r) }, { default: () => '复制' }),
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
    list.value = (await templatesApi.list(params)) || [];
  } catch (e: any) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadProjects() {
  try {
    const projs: any = (await projectsApi.list()) || [];
    projectOptions.value = projs.map((p: any) => ({ label: p.name, value: p.id }));
  } catch {
    projectOptions.value = [];
  }
}

function openCreate() {
  form.code = '';
  form.name = '';
  form.projectId =
    filterProjectId.value && filterProjectId.value !== 'system'
      ? filterProjectId.value
      : null;
  form.subject = '【{{appName}}】通知';
  form.enabled = true;
  showCreate.value = true;
}

async function create() {
  if (!form.code.trim() || !form.name.trim()) {
    message.warning('请填写 code 与名称');
    return;
  }
  creating.value = true;
  try {
    const res: any = await templatesApi.create({
      code: form.code.trim(),
      name: form.name.trim(),
      projectId: form.projectId,
      subject: form.subject,
      htmlBody: '<p>你好，{{appName}}</p>',
      variables: ['appName'],
      enabled: form.enabled,
    });
    message.success('已创建');
    showCreate.value = false;
    router.push(`/templates/${res.id}`);
  } catch (e: any) {
    message.error(e.message);
  } finally {
    creating.value = false;
  }
}

async function toggleEnabled(row: any, enabled: boolean) {
  togglingId.value = row.id;
  try {
    await templatesApi.update(row.id, { enabled });
    row.enabled = enabled;
    message.success(enabled ? '已启用' : '已禁用');
  } catch (e: any) {
    message.error(e.message);
  } finally {
    togglingId.value = null;
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
    title: '写入默认模板',
    content: `将把缺失的默认模板写入「${scopeLabel}」，不会覆盖已有 code。确认继续？`,
    positiveText: '写入',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res: any = await templatesApi.seedDefaults(target);
        message.success(`已写入: ${(res.created || []).join(', ') || '无新增'}`);
        await load();
      } catch (e: any) {
        message.error(e.message);
      }
    },
  });
}

async function copy(row: any) {
  try {
    const res: any = await templatesApi.copy(row.id, {});
    message.success('已复制');
    router.push(`/templates/${res.id}`);
  } catch (e: any) {
    message.error(e.message);
  }
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
      await templatesApi.remove(row.id);
      message.success('已删除');
      await load();
    },
  });
}

onMounted(async () => {
  await loadProjects();
  await load();
});
</script>
