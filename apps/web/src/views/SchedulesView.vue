<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">定时发送</div>
        <div class="page-subtitle">一次性、每日、工作日或每周执行；明确失败继续按周期运行，未知结果需要核实</div>
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
          remote
          :pagination="pagination"
          @update:page="changePage"
        />
      </div>
    </div>

    <n-modal
      v-model:show="showCreate"
      preset="card"
      content-scrollable
      :title="editingId ? '编辑定时发送' : '新建定时发送'"
      class="modal-allow-overflow"
      style="width: min(560px, calc(100vw - 24px))"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="项目" required>
          <n-select
            v-model:value="form.projectId"
            :options="projectOptions"
            :disabled="!!editingId"
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
            :disabled="!!editingId"
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
        <n-form-item label="重复规则">
          <n-select v-model:value="form.cron" :options="recurrenceOptions" />
          <div class="mt-1 text-xs text-slate-400">暂停期间错过的周期会合并一次。失败会记录本次结果并进入下个周期；送达状态未知时暂停，等待人工核实。</div>
        </n-form-item>
        <n-form-item label="时区">
          <n-input v-model:value="form.timezone" placeholder="Asia/Shanghai" />
          <div class="mt-1 text-xs text-slate-400">使用 IANA 时区，例如 Asia/Shanghai 或 America/New_York。</div>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="create">{{ editingId ? '保存' : '创建' }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showHistory" preset="card" :title="historySchedule ? `执行历史：${historySchedule.title || historySchedule.id}` : '执行历史'" style="width: min(740px, calc(100vw - 24px))">
      <div class="mb-3 text-sm text-slate-500">时间按任务时区 {{ historySchedule?.timezone || 'Asia/Shanghai' }} 显示。未知送达结果会保留为待核实记录。</div>
      <n-data-table :columns="historyColumns" :data="historyItems" :loading="loadingHistory" :bordered="false" :pagination="false" />
      <n-space justify="end" class="mt-4">
        <span class="mr-auto text-xs text-slate-400">共 {{ historyTotal }} 次执行</span>
        <n-button :disabled="historyPage <= 1 || loadingHistory" @click="changeHistoryPage(historyPage - 1)">上一页</n-button>
        <n-button :disabled="historyPage * historyPageSize >= historyTotal || loadingHistory" @click="changeHistoryPage(historyPage + 1)">下一页</n-button>
      </n-space>
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
const showHistory = ref(false);
const creating = ref(false);
const editingId = ref<string | null>(null);
const historySchedule = ref<any | null>(null);
const historyItems = ref<any[]>([]);
const historyTotal = ref(0);
const historyPage = ref(1);
const historyPageSize = 10;
const loadingHistory = ref(false);
const pagination = reactive({ page: 1, pageSize: 20, itemCount: 0 });
function changePage(page: number) { pagination.page = page; void load(); }
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
  cron: '',
  timezone: 'Asia/Shanghai',
});

const recurrenceOptions = [
  { label: '一次执行', value: '' },
  { label: '每日', value: 'daily' },
  { label: '工作日（周一至周五）', value: 'weekdays' },
  { label: '每周（与首次日期同一星期）', value: 'weekly' },
];

const statusOptions = [
  { label: '待执行', value: 'PENDING' },
  { label: '执行中', value: 'RUNNING' },
  { label: '已暂停', value: 'PAUSED' },
  { label: '结果待核实', value: 'UNCERTAIN' },
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
    width: 205,
    render: (r: any) => formatScheduleTime(r.runAt, r.timezone),
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
    width: 140,
    render: (r: any) => recurrenceLabel(r.cron),
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
    width: 300,
    fixed: 'right' as const,
    render: (r: any) => {
      const actions = [h(NButton, { size: 'small', onClick: () => openHistory(r) }, { default: () => '执行历史' })];
      if (['PENDING', 'PAUSED'].includes(r.status)) actions.push(
        h(NButton, { size: 'small', onClick: () => edit(r) }, { default: () => '编辑' }),
        h(NButton, { size: 'small', onClick: () => togglePause(r) }, { default: () => r.status === 'PAUSED' ? '恢复' : '暂停' }),
        h(NButton, { size: 'small', type: 'error', onClick: () => cancel(r) }, { default: () => '取消' }),
      );
      if (r.status === 'UNCERTAIN') actions.push(
        h(NButton, { size: 'small', onClick: () => resolveUncertain(r, 'delivered') }, { default: () => '确认已送达' }),
        h(NButton, { size: 'small', type: 'warning', onClick: () => resolveUncertain(r, 'retry') }, { default: () => '确认后重试' }),
      );
      return h(NSpace, { wrap: false }, { default: () => actions });
    },
  },
];

const historyColumns = [
  { title: '开始时间', key: 'startedAt', width: 190, render: (r: any) => formatScheduleTime(r.startedAt, historySchedule.value?.timezone) },
  { title: '结束时间', key: 'finishedAt', width: 190, render: (r: any) => r.finishedAt ? formatScheduleTime(r.finishedAt, historySchedule.value?.timezone) : '执行中' },
  { title: '结果', key: 'status', width: 100, render: (r: any) => h(NTag, { size: 'small', type: statusType(r.status) }, { default: () => statusLabel(r.status) }) },
  { title: '消息 ID', key: 'messageId', width: 150, ellipsis: { tooltip: true }, render: (r: any) => r.messageId || '-' },
  { title: '错误', key: 'error', ellipsis: { tooltip: true }, render: (r: any) => r.error || '-' },
];

function formatScheduleTime(value: string | Date, timezone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone || 'Asia/Shanghai' }).format(date); }
  catch { return formatTime(date); }
}

function recurrenceLabel(cron?: string | null) {
  return ({ daily: '每日', weekdays: '工作日', weekly: '每周' } as Record<string, string>)[cron || ''] || '一次';
}

async function openHistory(row: any) {
  historySchedule.value = row;
  historyPage.value = 1;
  showHistory.value = true;
  await loadHistory();
}

async function loadHistory() {
  if (!historySchedule.value) return;
  loadingHistory.value = true;
  try {
    const result: any = await schedulesApi.executions(historySchedule.value.id, { page: historyPage.value, pageSize: historyPageSize });
    historyItems.value = result?.items || [];
    historyTotal.value = result?.total || 0;
  } catch (e: any) { message.error(e.message || '加载执行历史失败'); }
  finally { loadingHistory.value = false; }
}

async function changeHistoryPage(page: number) { historyPage.value = page; await loadHistory(); }

async function load() {
  loading.value = true;
  try {
    const result: any = await schedulesApi.list({
        projectId: filters.projectId || undefined,
        status: filters.status || undefined,
        page: pagination.page, pageSize: pagination.pageSize,
      });
    list.value = result?.items || [];
    pagination.itemCount = result?.total || 0;
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
  editingId.value = null;
  form.cron = '';
  form.timezone = 'Asia/Shanghai';
  if (!form.projectId && projectOptions.value[0]) {
    form.projectId = projectOptions.value[0].value;
  }
  void loadProjectChannels(form.projectId);
  showCreate.value = true;
}

async function edit(row: any) {
  editingId.value = row.id;
  form.projectId = row.projectId;
  await loadProjectChannels(row.projectId);
  Object.assign(form, { channelType: row.channelType, title: row.title || '', content: row.content || '', runAt: new Date(row.runAt).getTime(), cron: row.cron || '', timezone: row.timezone || 'Asia/Shanghai' });
  showCreate.value = true;
}
async function togglePause(row: any) {
  try { await (row.status === 'PAUSED' ? schedulesApi.resume(row.id) : schedulesApi.pause(row.id)); await load(); }
  catch (e: any) { message.error(e.message); }
}

function resolveUncertain(row: any, action: 'delivered' | 'retry') {
  dialog.warning({
    title: action === 'retry' ? '确认重复发送风险' : '确认已核实送达',
    content: action === 'retry'
      ? `「${row.title || row.id}」可能已经发送成功。重试可能让收件人再次收到同一通知。请先检查接收端，再确认是否立即重试。`
      : `请确认已通过接收端或服务商记录核实「${row.title || row.id}」已经送达。此操作仅记录核实结果。`,
    positiveText: action === 'retry' ? '接受重复风险并重试' : '已核实送达',
    negativeText: '返回',
    onPositiveClick: async () => {
      try {
        await schedulesApi.resolve(row.id, { action, ...(action === 'retry' ? { acknowledgeDuplicateRisk: true } : {}) });
        message.success(action === 'retry' ? '已重新排程' : '已记录核实结果'); await load();
      } catch (e: any) { message.error(e.message); }
    },
  });
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
  if (!editingId.value && form.channelType && !projectChannelTypes.value.includes(form.channelType)) {
    message.warning('所选渠道类型未在该项目启用，请先到项目详情绑定');
    return;
  }
  creating.value = true;
  try {
    const data = {
      channelType: form.channelType || undefined,
      title: form.title,
      content: form.content,
      runAt: new Date(form.runAt).toISOString(),
      cron: form.cron || null,
      timezone: form.timezone.trim() || 'Asia/Shanghai',
    };
    if (editingId.value) {
      const { channelType, ...editable } = data;
      await schedulesApi.update(editingId.value, editable);
    }
    else await schedulesApi.create({ ...data, projectId: form.projectId });
    message.success(editingId.value ? '已保存' : '已创建');
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
