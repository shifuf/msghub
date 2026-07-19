<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">操作日志</div>
        <div class="page-subtitle">记录删除等关键操作，便于追溯</div>
      </div>
      <div class="flex flex-wrap gap-2">
        <n-button secondary type="error" :loading="clearing" @click="confirmClear">清空日志</n-button>
        <n-button @click="reload">刷新</n-button>
      </div>
    </div>

    <div class="page-card p-3 md:p-4 space-y-3">
      <div class="filters-row">
        <n-input
          v-model:value="filters.action"
          clearable
          placeholder="动作关键词，如 delete"
          class="w-full sm:w-52"
          @keyup.enter="reload"
        />
        <n-select
          v-model:value="filters.resource"
          clearable
          placeholder="资源类型"
          class="w-full sm:w-44"
          :options="resourceOptions"
          @update:value="reload"
        />
        <n-button type="primary" secondary @click="reload">查询</n-button>
      </div>

      <n-data-table
        :columns="columns"
        :data="items"
        :loading="loading"
        :bordered="false"
        :pagination="pagination"
        :scroll-x="900"
        @update:page="onPage"
      />
    </div>

    <n-drawer v-model:show="showDetail" :width="detailWidth" placement="right">
      <n-drawer-content title="日志详情" closable>
        <template v-if="detail">
          <n-descriptions label-placement="left" :column="1" size="small">
            <n-descriptions-item label="时间">{{ formatTime(detail.createdAt) }}</n-descriptions-item>
            <n-descriptions-item label="动作">{{ detail.action }}</n-descriptions-item>
            <n-descriptions-item label="资源">{{ detail.resource || '-' }}</n-descriptions-item>
            <n-descriptions-item label="名称">{{ detail.resourceName || '-' }}</n-descriptions-item>
            <n-descriptions-item label="资源 ID">
              <span class="break-all">{{ detail.resourceId || '-' }}</span>
            </n-descriptions-item>
          </n-descriptions>
          <div class="mt-4">
            <div class="text-sm font-medium mb-1">详情</div>
            <pre class="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-80 whitespace-pre-wrap">{{
              JSON.stringify(detail.detail, null, 2)
            }}</pre>
          </div>
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
  NDrawer,
  NDrawerContent,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NSelect,
  NTag,
  useMessage,
  useDialog,
} from 'naive-ui';
import { activityApi } from '@/api';
import { formatTime } from '@/utils/labels';

const items = ref<any[]>([]);
const loading = ref(false);
const clearing = ref(false);
const page = ref(1);
const pageSize = 20;
const showDetail = ref(false);
const detail = ref<any>(null);
const message = useMessage();
const dialog = useDialog();
const filters = reactive({ action: '', resource: null as string | null });
const pagination = reactive({ page: 1, pageSize, itemCount: 0, showSizePicker: false });
const detailWidth = computed(() =>
  typeof window !== 'undefined' && window.innerWidth < 640 ? window.innerWidth - 16 : 480,
);

const resourceOptions = [
  { label: '项目', value: 'Project' },
  { label: '渠道', value: 'Channel' },
  { label: '邮件模板', value: 'EmailTemplate' },
  { label: '推送模板', value: 'PushTemplate' },
];

const columns = [
  {
    title: '时间',
    key: 'createdAt',
    width: 170,
    render: (r: any) => formatTime(r.createdAt),
  },
  {
    title: '动作',
    key: 'action',
    width: 180,
    render: (r: any) =>
      h(NTag, { size: 'small', type: r.action?.includes('delete') ? 'error' : 'default' }, {
        default: () => r.action,
      }),
  },
  {
    title: '资源',
    key: 'resource',
    width: 130,
    render: (r: any) => r.resource || '-',
  },
  {
    title: '名称',
    key: 'resourceName',
    ellipsis: { tooltip: true },
    render: (r: any) => r.resourceName || '-',
  },
  {
    title: '操作',
    key: 'actions',
    width: 90,
    fixed: 'right' as const,
    render: (r: any) =>
      h(
        NButton,
        {
          size: 'small',
          onClick: () => {
            detail.value = r;
            showDetail.value = true;
          },
        },
        { default: () => '详情' },
      ),
  },
];

async function load() {
  loading.value = true;
  try {
    const res: any = await activityApi.list({
      action: filters.action || undefined,
      resource: filters.resource || undefined,
      page: page.value,
      pageSize,
    });
    items.value = res?.items || [];
    pagination.itemCount = res?.total || 0;
    pagination.page = page.value;
  } finally {
    loading.value = false;
  }
}

function reload() {
  page.value = 1;
  load();
}

function onPage(p: number) {
  page.value = p;
  load();
}

function confirmClear() {
  const actionLabel = filters.action?.trim() || '全部动作';
  const resourceLabel =
    resourceOptions.find((o) => o.value === filters.resource)?.label ||
    filters.resource ||
    '全部资源';
  dialog.warning({
    title: '清空操作日志',
    content: `确认清空「${actionLabel} / ${resourceLabel}」范围内的操作日志？此操作不可恢复。`,
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      clearing.value = true;
      try {
        const res: any = await activityApi.clear({
          action: filters.action?.trim() || undefined,
          resource: filters.resource || undefined,
        });
        message.success(`已清空 ${res?.deleted ?? 0} 条日志`);
        await reload();
      } catch (e: any) {
        message.error(e.message || '清空失败');
      } finally {
        clearing.value = false;
      }
    },
  });
}

onMounted(load);
</script>
