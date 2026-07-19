<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">邮件抑制名单</div>
        <div class="page-subtitle">黑名单 / 自动失败拉黑 / 退信 / 退订 · 命中后 /api/email 直接拒绝</div>
      </div>
      <n-button type="primary" @click="showAdd = true">添加</n-button>
    </div>

    <div class="page-card p-3 md:p-4 space-y-3">
      <div class="filters-row">
        <n-input
          v-model:value="q"
          clearable
          placeholder="搜索邮箱 / 原因"
          class="w-full sm:w-56"
          @keyup.enter="reload"
          @clear="reload"
        />
        <n-select
          v-model:value="projectId"
          clearable
          placeholder="全部项目"
          class="w-full sm:w-44"
          :options="projectOptions"
          @update:value="reload"
        />
        <n-button @click="reload">刷新</n-button>
      </div>

      <div class="table-shell !border-0 !shadow-none !p-0">
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
    </div>

    <n-modal v-model:show="showAdd" preset="card" title="添加抑制地址" style="width: min(480px, calc(100vw - 24px))">
      <n-form label-placement="top">
        <n-form-item label="项目（空=全局）">
          <n-select v-model:value="form.projectId" clearable :options="projectOptions" placeholder="全局" />
        </n-form-item>
        <n-form-item label="邮箱或域名" required>
          <n-input v-model:value="form.address" placeholder="user@example.com 或 @bad-domain.com" />
        </n-form-item>
        <n-form-item label="原因">
          <n-input v-model:value="form.reason" placeholder="可选" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="doAdd">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  useDialog,
  useMessage,
} from 'naive-ui';
import { projectsApi, suppressApi } from '@/api';
import { formatTime } from '@/utils/labels';

const message = useMessage();
const dialog = useDialog();
const items = ref<any[]>([]);
const loading = ref(false);
const saving = ref(false);
const showAdd = ref(false);
const q = ref('');
const projectId = ref<string | null>(null);
const page = ref(1);
const pageSize = 20;
const projectOptions = ref<{ label: string; value: string }[]>([]);
const form = reactive({
  projectId: null as string | null,
  address: '',
  reason: '',
});
const pagination = reactive({
  page: 1,
  pageSize,
  itemCount: 0,
  showSizePicker: false,
});

const columns = [
  {
    title: '地址',
    key: 'address',
    ellipsis: { tooltip: true },
  },
  {
    title: '项目',
    key: 'project',
    width: 140,
    render: (r: any) => r.project?.name || '全局',
  },
  {
    title: '来源',
    key: 'source',
    width: 110,
  },
  {
    title: '原因',
    key: 'reason',
    ellipsis: { tooltip: true },
    render: (r: any) => r.reason || '-',
  },
  {
    title: '时间',
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
      h(
        NButton,
        {
          size: 'small',
          type: 'error',
          secondary: true,
          onClick: () => remove(r),
        },
        { default: () => '删除' },
      ),
  },
];

async function load() {
  loading.value = true;
  try {
    const res: any = await suppressApi.list({
      q: q.value.trim() || undefined,
      projectId: projectId.value || undefined,
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

async function doAdd() {
  if (!form.address.trim()) {
    message.warning('请填写地址');
    return;
  }
  saving.value = true;
  try {
    await suppressApi.add({
      projectId: form.projectId || undefined,
      address: form.address.trim(),
      reason: form.reason.trim() || undefined,
      source: 'MANUAL',
    });
    message.success('已添加');
    showAdd.value = false;
    form.address = '';
    form.reason = '';
    await load();
  } catch (e: any) {
    message.error(e?.message || '添加失败');
  } finally {
    saving.value = false;
  }
}

function remove(row: any) {
  dialog.warning({
    title: '删除抑制记录',
    content: `确定删除 ${row.address}？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await suppressApi.remove(row.id);
        message.success('已删除');
        load();
      } catch (e: any) {
        message.error(e?.message || '删除失败');
      }
    },
  });
}

onMounted(async () => {
  try {
    const projs: any = (await projectsApi.list()) || [];
    projectOptions.value = projs.map((p: any) => ({ label: p.name, value: p.id }));
  } catch {
    /* ignore */
  }
  await load();
});
</script>
