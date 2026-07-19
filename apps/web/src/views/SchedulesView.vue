<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">定时发送</div>
        <div class="page-subtitle">一次性或每日重复的定时推送任务</div>
      </div>
      <n-button type="primary" @click="openCreate">新建定时</n-button>
    </div>

    <div class="page-card p-3 md:p-4 space-y-3">
      <div class="filters-row">
        <n-select
          v-model:value="filters.projectId"
          clearable
          placeholder="全部项目"
          class="w-full sm:w-48"
          :options="projectOptions"
          @update:value="load"
        />
        <n-select
          v-model:value="filters.status"
          clearable
          placeholder="全部状态"
          class="w-full sm:w-36"
          :options="statusOptions"
          @update:value="load"
        />
        <n-button @click="load">刷新</n-button>
      </div>

      <div class="table-shell !border-0 !shadow-none !p-0">
        <n-data-table
          :columns="columns"
          :data="list"
          :loading="loading"
          :bordered="false"
          :scroll-x="1100"
        />
      </div>
    </div>

    <n-modal
      v-model:show="showCreate"
      preset="card"
      content-scrollable
      title="新建定时发送"
      class="modal-allow-overflow"
      style="width: min(560px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="项目" required>
          <n-select
            v-model:value="form.projectId"
            :options="projectOptions"
            placeholder="选择项目"
            @update:value="onProjectChange"
          />
        </n-form-item>
        <n-form-item label="渠道类型">
          <n-select
            v-model:value="form.channelType"
            clearable
            :options="channelOptions"
            :loading="loadingChannels"
            :placeholder="channelPlaceholder"
          />
          <div class="mt-1 text-xs text-slate-400">
            {{ channelHint }}
          </div>
        </n-form-item>
        <n-form-item label="标题">
          <n-input v-model:value="form.title" placeholder="通知标题" />
        </n-form-item>
        <n-form-item label="内容">
          <n-input v-model:value="form.content" type="textarea" :rows="4" placeholder="正文" />
        </n-form-item>
        <n-form-item label="执行时间" required>
          <n-date-picker
            v-model:value="form.runAt"
            type="datetime"
            class="w-full"
            clearable
            placement="top-start"
            :actions="['clear', 'confirm']"
          />
        </n-form-item>
        <n-form-item label="每日重复">
          <n-switch v-model:value="form.daily" />
          <span class="ml-2 text-xs text-slate-400">开启后 cron=daily，成功后顺延 24 小时</span>
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
import {
  NButton,
  NDataTable,
  NSelect,
  NTag,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NDatePicker,
  NSwitch,
  NSpace,
  useMessage,
  useDialog,
} from 'naive-ui';
import { schedulesApi, projectsApi, channelsApi } from '@/api';
import {
  CHANNEL_TYPE_LABELS,
  formatTime,
} from '@/utils/labels';

const list = ref<any[]>([]);
const loading = ref(false);
const showCreate = ref(false);
const creating = ref(false);
const loadingChannels = ref(false);
const message = useMessage();
const dialog = useDialog();
const projectOptions = ref<{ label: string; value: string }[]>([]);
/** 当前项目已启用的外发渠道类型（不含 INBOX） */
const projectChannelTypes = ref<string[]>([]);

const filters = reactive({
  projectId: null as string | null,
  status: null as string | null,
});

const form = reactive({
  projectId: null as string | null,
  channelType: null as string | null,
  title: '定时通知',
  content: '这是一条定时发送的消息',
  runAt: null as number | null,
  daily: false,
});

const statusOptions = [
  { label: '待执行', value: 'PENDING' },
  { label: '执行中', value: 'RUNNING' },
  { label: '成功', value: 'SUCCESS' },
  { label: '失败', value: 'FAILED' },
  { label: '已取消', value: 'CANCELLED' },
];

const channelOptions = computed(() =>
  projectChannelTypes.value.map((t) => ({
    label: CHANNEL_TYPE_LABELS[t] || t,
    value: t,
  })),
);

const channelPlaceholder = computed(() =>
  projectChannelTypes.value.length
    ? '留空=项目策略自动派发；或指定已配置类型'
    : '无外发渠道，将使用站内通知',
);

const channelHint = computed(() => {
  if (!form.projectId) return '请先选择项目';
  if (!projectChannelTypes.value.length) {
    return '该项目未启用外发渠道，创建后将按站内通知处理（不选渠道类型即可）。';
  }
  return `可选：${projectChannelTypes.value.map((t) => CHANNEL_TYPE_LABELS[t] || t).join('、')}；留空则走项目策略派发。`;
});

function statusType(s: string) {
  if (s === 'SUCCESS') return 'success';
  if (s === 'FAILED') return 'error';
  if (s === 'PENDING') return 'warning';
  if (s === 'RUNNING') return 'info';
  return 'default';
}

function statusLabel(s: string) {
  return statusOptions.find((o) => o.value === s)?.label || s;
}

const columns = [
  {
    title: '执行时间',
    key: 'runAt',
    width: 170,
    render: (r: any) => formatTime(r.runAt),
  },
  {
    title: '项目',
    key: 'project',
    width: 140,
    render: (r: any) => r.project?.name || '-',
  },
  {
    title: '渠道',
    key: 'channelType',
    width: 130,
    render: (r: any) =>
      CHANNEL_TYPE_LABELS[r.channelType] || r.channelType || '项目策略/站内',
  },
  { title: '标题', key: 'title', ellipsis: { tooltip: true } },
  {
    title: '重复',
    key: 'cron',
    width: 90,
    render: (r: any) =>
      r.cron
        ? h(NTag, { size: 'small', type: 'info' }, { default: () => r.cron })
        : h('span', { class: 'text-slate-400' }, '一次'),
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (r: any) =>
      h(NTag, { size: 'small', type: statusType(r.status) }, { default: () => statusLabel(r.status) }),
  },
  {
    title: '错误',
    key: 'lastError',
    width: 160,
    ellipsis: { tooltip: true },
    render: (r: any) => r.lastError || '-',
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 160,
    render: (r: any) => formatTime(r.createdAt),
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    fixed: 'right' as const,
    render: (r: any) =>
      r.status === 'PENDING'
        ? h(
            NButton,
            {
              size: 'small',
              type: 'error',
              secondary: true,
              onClick: () => cancel(r),
            },
            { default: () => '取消' },
          )
        : h('span', { class: 'text-slate-300' }, '-'),
  },
];

async function load() {
  loading.value = true;
  try {
    list.value =
      (await schedulesApi.list({
        projectId: filters.projectId || undefined,
        status: filters.status || undefined,
      })) || [];
  } catch (e: any) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadProjectChannels(projectId: string | null) {
  projectChannelTypes.value = [];
  form.channelType = null;
  if (!projectId) return;
  loadingChannels.value = true;
  try {
    const opts: any[] = (await channelsApi.listOptions(projectId)) || [];
    const types = new Set<string>();
    for (const o of opts) {
      if (!o.bindingEnabled || !o.bound) continue;
      if (o.type === 'INBOX' || o.type === 'SMTP') continue;
      if (o.type) types.add(o.type);
    }
    projectChannelTypes.value = Array.from(types);
  } catch (e: any) {
    message.error(e.message || '加载项目渠道失败');
  } finally {
    loadingChannels.value = false;
  }
}

async function onProjectChange(v: string | null) {
  await loadProjectChannels(v);
}

function openCreate() {
  if (!form.projectId && projectOptions.value[0]) {
    form.projectId = projectOptions.value[0].value;
  }
  void loadProjectChannels(form.projectId);
  showCreate.value = true;
}

async function create() {
  if (!form.projectId) {
    message.warning('请选择项目');
    return;
  }
  if (!form.runAt) {
    message.warning('请选择执行时间');
    return;
  }
  if (form.channelType && !projectChannelTypes.value.includes(form.channelType)) {
    message.warning('所选渠道类型未在该项目启用，请先到项目详情绑定');
    return;
  }
  creating.value = true;
  try {
    await schedulesApi.create({
      projectId: form.projectId,
      channelType: form.channelType || undefined,
      title: form.title,
      content: form.content,
      runAt: new Date(form.runAt).toISOString(),
      cron: form.daily ? 'daily' : undefined,
    });
    message.success('已创建');
    showCreate.value = false;
    await load();
  } catch (e: any) {
    message.error(e.message);
  } finally {
    creating.value = false;
  }
}

function cancel(row: any) {
  dialog.warning({
    title: '取消定时',
    content: `确认取消「${row.title || row.id}」？`,
    positiveText: '取消任务',
    negativeText: '返回',
    onPositiveClick: async () => {
      try {
        await schedulesApi.cancel(row.id);
        message.success('已取消');
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
    if (projs[0]) form.projectId = projs[0].id;
  } catch (e) {
    console.error(e);
  }
  await load();
});
</script>
