<template>
  <div class="space-y-5">
    <div class="page-header">
      <div><div class="page-title">发送队列</div><div class="page-subtitle">排队状态、失败处理与延迟任务</div></div>
      <n-button :loading="loading" @click="load">刷新</n-button>
    </div>
    <div class="page-card p-4 space-y-3">
      <n-alert v-if="error" type="error">{{ error }}</n-alert>
      <div class="flex flex-wrap gap-3">
        <n-tag v-for="(label, key) in stateLabels" :key="key">{{ label }} {{ stats?.counts?.[key] ?? '-' }}</n-tag>
        <n-tag v-if="stats?.isPaused" type="warning">队列已暂停</n-tag>
      </div>
      <p class="text-sm text-slate-500">送达结果未知的消息需要先核实，不能在这里直接重试。失败任务重试仍由服务端检查实际投递状态。</p>
    </div>
    <div class="page-card p-4 space-y-3">
      <h3 class="font-semibold">失败任务（最近 200 条）</h3>
      <n-data-table :columns="failedColumns" :data="failed" :loading="loading" :scroll-x="900" :bordered="false" />
    </div>
    <div class="page-card p-4 space-y-3">
      <h3 class="font-semibold">延迟任务（最近 200 条）</h3>
      <n-data-table :columns="delayedColumns" :data="delayed" :loading="loading" :scroll-x="700" :bordered="false" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NAlert, NButton, NDataTable, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
import { queueApi } from '@/api';
import { formatTime, CHANNEL_TYPE_LABELS } from '@/utils/labels';
const stats = ref<any>(null);
const failed = ref<any[]>([]);
const delayed = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const dialog = useDialog();
const message = useMessage();
const router = useRouter();
const stateLabels = { waiting: '等待', active: '执行', completed: '完成', failed: '失败', delayed: '延迟', paused: '暂停' };
const baseColumns = [
  { title: '任务', key: 'id', width: 220, ellipsis: { tooltip: true } },
  { title: '消息', key: 'messageId', width: 220, render: (row: any) => h(NButton, { text: true, type: 'primary', onClick: () => router.push({ path: '/messages', query: { open: row.data?.messageId } }) }, { default: () => row.data?.messageId || '-' }) },
  { title: '渠道', key: 'type', width: 120, render: (row: any) => CHANNEL_TYPE_LABELS[row.data?.channelType] || row.data?.kind || '-' },
  { title: '尝试次数', key: 'attemptsMade', width: 90 },
];
const failedColumns = [...baseColumns,
  { title: '失败原因', key: 'failedReason', width: 250, ellipsis: { tooltip: true } },
  { title: '操作', key: 'actions', width: 150, render: (row: any) => h(NSpace, {}, { default: () => [
    h(NButton, { size: 'small', type: 'warning', disabled: /DELIVERY_UNKNOWN|结果未知|结果待核实/.test(row.failedReason || ''), onClick: () => act(row, 'retry') }, { default: () => '重试' }),
    h(NButton, { size: 'small', onClick: () => act(row, 'remove') }, { default: () => '移除' }),
  ] }) },
];
const delayedColumns = [...baseColumns, { title: '计划执行', key: 'runAt', width: 180, render: (row: any) => formatTime(new Date(Number(row.timestamp) + Number(row.delay || 0))) }];
async function load() {
  loading.value = true; error.value = '';
  try {
    const [state, failures, delays]: any[] = await Promise.all([queueApi.stats(), queueApi.failed(), queueApi.delayed()]);
    stats.value = state;
    failed.value = Array.isArray(failures) ? failures : failures.items || [];
    delayed.value = Array.isArray(delays) ? delays : delays.items || [];
    error.value = state.error || failures.error || delays.error || '';
  } catch (e: any) { error.value = e.message || '队列加载失败'; }
  finally { loading.value = false; }
}
function act(row: any, action: 'retry' | 'remove') {
  dialog.warning({ title: action === 'retry' ? '重试失败任务' : '移除失败任务',
    content: action === 'retry' ? '仅应重试已确定发送失败的任务。请先查看消息详情，核实没有送达。' : '移除队列中的失败任务，保留发送记录。此操作无法撤销。',
    positiveText: action === 'retry' ? '已核实失败，重试' : '移除', negativeText: '取消',
    onPositiveClick: async () => {
      try { await queueApi[action](row.id); await load(); message.success(action === 'retry' ? '已安排重试' : '已移除'); }
      catch (e: any) { message.error(e.message); }
    },
  });
}
onMounted(load);
</script>
