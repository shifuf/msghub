<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">仪表盘</div>
        <div class="page-subtitle">概览、趋势与渠道分布</div>
      </div>
      <div class="flex flex-wrap gap-2">
        <n-select
          v-model:value="days"
          :options="dayOptions"
          class="w-32"
          size="small"
          @update:value="loadCharts"
        />
        <n-button secondary @click="$router.push('/channels')">渠道管理</n-button>
        <n-button type="primary" @click="$router.push('/messages')">发送记录</n-button>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
      <div v-for="card in cards" :key="card.label" class="stat-card">
        <div class="stat-label">{{ card.label }}</div>
        <div class="stat-value">{{ card.value }}</div>
      </div>
    </div>

    <div class="page-card p-4 md:p-5 space-y-3">
      <div>
        <div class="font-semibold text-slate-800">近 {{ days }} 日投递质量</div>
        <p class="text-xs text-slate-500 mt-1">按 {{ charts.timezone || 'UTC' }} 日期统计。外发成功表示服务商接受发送请求；SMTP 接受不代表用户已阅读。P95 表示 95% 的样本耗时不超过该值。</p>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div v-for="card in qualityCards" :key="card.label" class="stat-card">
          <div class="stat-label">{{ card.label }}</div>
          <div class="text-xl font-semibold text-slate-800 mt-2">{{ card.value }}</div>
          <div class="text-xs text-slate-400 mt-1">{{ card.note }}</div>
        </div>
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-4">
      <div class="page-card p-4 md:p-5 lg:col-span-2">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="font-semibold text-slate-800">近 {{ days }} 日发送趋势</div>
            <div class="text-xs text-slate-400 mt-0.5">{{ charts.timezone || 'UTC' }} 日期 · 记录成功率 {{ charts.successRate ?? 0 }}%（含站内接收）</div>
          </div>
        </div>
        <div class="chart-bars" v-if="charts.trend?.length">
          <div v-for="row in charts.trend" :key="row.date" class="bar-col" :title="tip(row)">
            <div class="bar-stack">
              <div class="bar success" :style="{ height: barH(row.success) }"></div>
              <div class="bar failed" :style="{ height: barH(row.failed) }"></div>
              <div class="bar pending" :style="{ height: barH(row.pending) }"></div>
            </div>
            <div class="bar-label">{{ row.date.slice(5) }}</div>
            <div class="bar-total">{{ row.total }}</div>
          </div>
        </div>
        <div v-else class="empty">暂无数据</div>
        <div class="legend">
          <span><i class="dot success"></i>成功</span>
          <span><i class="dot failed"></i>失败</span>
          <span><i class="dot pending"></i>排队</span>
        </div>
      </div>

      <div class="page-card p-4 md:p-5">
        <div class="font-semibold text-slate-800 mb-3">渠道分布</div>
        <div v-if="charts.byChannel?.length" class="space-y-2">
          <div v-for="c in charts.byChannel" :key="c.type" class="dist-row">
            <div class="dist-label">{{ CHANNEL_TYPE_LABELS[c.type] || c.type }}</div>
            <div class="dist-track">
              <div class="dist-fill" :style="{ width: pct(c.count) + '%' }"></div>
            </div>
            <div class="dist-count">{{ c.count }}</div>
          </div>
        </div>
        <div v-else class="empty">暂无数据</div>
      </div>
    </div>

    <div class="grid lg:grid-cols-2 gap-4">
      <div class="page-card p-4 md:p-5">
        <div class="font-semibold text-slate-800 mb-3">项目发送 TOP</div>
        <n-data-table
          :columns="projectColumns"
          :data="charts.byProject || []"
          :bordered="false"
          size="small"
          :scroll-x="720"
        />
      </div>

      <div class="page-card p-4 md:p-5">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="font-semibold text-slate-800">最近发送</div>
            <div class="text-xs text-slate-400 mt-0.5">最新 10 条</div>
          </div>
          <n-button text type="primary" @click="$router.push('/messages')">全部</n-button>
        </div>
        <n-data-table :columns="recentColumns" :data="recent" :bordered="false" size="small" :scroll-x="520" />
      </div>
    </div>

    <div class="page-card p-4 md:p-5">
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="font-semibold text-slate-800">失败原因聚类</div>
          <div class="text-xs text-slate-400 mt-0.5">近 {{ days }} 天 · 共 {{ clusters.totalFailed || 0 }} 条失败</div>
          <div v-if="clusters.sampled" class="text-xs text-amber-700 mt-1">以下聚类基于最近 {{ clusters.sampleSize ?? 2000 }} 条样本，不代表全部失败记录的分布。</div>
        </div>
        <n-button text type="primary" @click="loadClusters">刷新</n-button>
      </div>
      <n-data-table
        :columns="clusterColumns"
        :data="clusters.clusters || []"
        :bordered="false"
        size="small"
        :scroll-x="640"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NDataTable, NSelect, NTag } from 'naive-ui';
import { dashboardApi } from '@/api';
import {
  CHANNEL_TYPE_LABELS,
  ERROR_CLUSTER_LABELS,
  STATUS_LABELS,
  formatTime,
  statusTagType,
} from '@/utils/labels';

const router = useRouter();
const stats = ref<any>({});
const recent = ref<any[]>([]);
const charts = ref<any>({ trend: [], byChannel: [], byProject: [], successRate: 0 });
const clusters = ref<any>({ clusters: [], totalFailed: 0 });
const days = ref(7);
const dayOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 14 天', value: 14 },
  { label: '近 30 天', value: 30 },
];

const maxTotal = computed(() =>
  Math.max(1, ...(charts.value.trend || []).map((r: any) => r.total || 0)),
);
const maxChannel = computed(() =>
  Math.max(1, ...(charts.value.byChannel || []).map((r: any) => r.count || 0)),
);

const cards = computed(() => [
  { label: '项目数', value: stats.value.projectCount ?? '-' },
  { label: '渠道数', value: stats.value.channelCount ?? '-' },
  { label: '不健康渠道', value: stats.value.unhealthyChannelCount ?? 0 },
  { label: '总发送量', value: stats.value.totalMessages ?? '-' },
  { label: '近24h成功', value: stats.value.success24h ?? '-' },
  { label: '近24h失败', value: stats.value.failed24h ?? '-' },
  { label: '静默延迟', value: stats.value.delayedCount ?? 0 },
  { label: '未读', value: stats.value.unreadCount ?? 0 },
]);

function latency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '无样本';
  return Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(2)} 秒` : `${Math.round(Number(value))} ms`;
}
const qualityCards = computed(() => {
  const metrics = charts.value.metrics || {};
  return [
    { label: '外发成功率', value: metrics.externalSuccessRate == null ? '-' : `${metrics.externalSuccessRate}%`, note: `已接受 ${metrics.delivered ?? 0} / 外发记录 ${metrics.externalAttempts ?? 0}` },
    { label: '兜底记录比例', value: metrics.fallbackRate == null ? '-' : `${metrics.fallbackRate}%`, note: '按兜底标记或关联记录统计' },
    { label: '投递耗时 P95', value: latency(metrics.latencyP95Ms), note: '创建至服务商接受' },
    { label: '队列等待 P95', value: latency(metrics.queueWaitP95Ms), note: '创建至开始投递' },
    { label: '等待超过 5 分钟', value: metrics.stalePending ?? '-', note: '统计范围内的排队记录' },
    { label: '站内接收', value: metrics.inboxAccepted ?? '-', note: '成功写入站内的记录' },
  ];
});

function barH(n: number) {
  return `${Math.max(2, Math.round(((n || 0) / maxTotal.value) * 120))}px`;
}
function pct(n: number) {
  return Math.round(((n || 0) / maxChannel.value) * 100);
}
function tip(row: any) {
  return `${row.date} 共${row.total} 成功${row.success} 失败${row.failed}`;
}

const projectColumns = [
  { title: '项目', key: 'name' },
  { title: '总量', key: 'count', width: 70 },
  { title: '成功', key: 'success', width: 70 },
  { title: '失败', key: 'failed', width: 70 },
  { title: '外发已接受', key: 'delivered', width: 105, render: (row: any) => row.delivered ?? '-' },
  { title: '兜底记录', key: 'fallback', width: 90, render: (row: any) => row.fallback ?? '-' },
  { title: '投递 P95', key: 'latencyP95Ms', width: 110, render: (row: any) => latency(row.latencyP95Ms) },
];

const recentColumns = [
  {
    title: '时间',
    key: 'createdAt',
    width: 150,
    render: (row: any) => formatTime(row.createdAt),
  },
  {
    title: '项目',
    key: 'project',
    render: (row: any) => row.project?.name || '-',
  },
  {
    title: '渠道',
    key: 'channelType',
    render: (row: any) => CHANNEL_TYPE_LABELS[row.channelType] || row.channelType || '-',
  },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render: (row: any) =>
      h(NTag, { type: statusTagType(row.status), size: 'small' }, {
        default: () => STATUS_LABELS[row.status] || row.status,
      }),
  },
];

const clusterColumns = [
  {
    title: '类型',
    key: 'key',
    width: 120,
    render: (r: any) => ERROR_CLUSTER_LABELS[r.key] || r.key,
  },
  { title: '次数', key: 'count', width: 80 },
  {
    title: '样例错误',
    key: 'sampleError',
    ellipsis: { tooltip: true },
  },
  {
    title: '操作',
    key: 'op',
    width: 100,
    fixed: 'right' as const,
    render: (r: any) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          size: 'tiny',
          onClick: () =>
            router.push({
              path: '/messages',
              query: { hasError: '1', q: r.sampleError?.slice(0, 40) || '' },
            }),
        },
        { default: () => '查看' },
      ),
  },
];

async function loadCharts() {
  try {
    charts.value = (await dashboardApi.charts(days.value)) || {};
    await loadClusters();
  } catch (e) {
    console.error(e);
  }
}

async function loadClusters() {
  try {
    clusters.value = (await dashboardApi.errorClusters(days.value)) || {
      clusters: [],
      totalFailed: 0,
    };
  } catch (e) {
    console.error(e);
  }
}

onMounted(async () => {
  try {
    const data: any = await dashboardApi.stats();
    stats.value = data || {};
    recent.value = data?.recent || [];
  } catch (e) {
    console.error(e);
  }
  await loadCharts();
});
</script>

<style scoped>
.chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 160px;
  padding: 8px 0 0;
  overflow-x: auto;
}
.bar-col {
  flex: 1;
  min-width: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.bar-stack {
  width: 100%;
  max-width: 28px;
  display: flex;
  flex-direction: column-reverse;
  justify-content: flex-start;
  height: 120px;
  border-radius: 8px 8px 4px 4px;
  overflow: hidden;
  background: #f1f5f9;
}
.bar {
  width: 100%;
  min-height: 0;
  transition: height 0.2s ease;
}
.bar.success { background: #10b981; }
.bar.failed { background: #ef4444; }
.bar.pending { background: #f59e0b; }
.bar-label { font-size: 10px; color: #94a3b8; }
.bar-total { font-size: 11px; font-weight: 600; color: #475569; }
.legend {
  display: flex;
  gap: 14px;
  margin-top: 12px;
  font-size: 12px;
  color: #64748b;
}
.legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}
.legend .dot.success { background: #10b981; }
.legend .dot.failed { background: #ef4444; }
.legend .dot.pending { background: #f59e0b; }
.dist-row {
  display: grid;
  grid-template-columns: 90px 1fr 36px;
  gap: 8px;
  align-items: center;
}
.dist-label { font-size: 12px; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dist-track { height: 8px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }
.dist-fill { height: 100%; background: #2563eb; border-radius: 999px; }
.dist-count { font-size: 12px; font-weight: 600; color: #0f172a; text-align: right; }
.empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }
</style>
