<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">项目管理</div>
        <div class="page-subtitle">按业务拆分项目，每个项目独立 API Key，渠道从全局库启用</div>
      </div>
      <n-button type="primary" @click="showCreate = true">新建项目</n-button>
    </div>

    <div class="table-shell">
      <n-data-table
        :columns="columns"
        :data="list"
        :loading="loading"
        :bordered="false"
        :scroll-x="1100"
      />
    </div>

    <n-modal
      v-model:show="showCreate"
      preset="card"
      content-scrollable
      title="新建项目"
      class="responsive-modal"
      style="width: min(480px, calc(100vw - 24px))"
      :bordered="false"
      :segmented="{ content: true, footer: 'soft' }"
    >
      <n-form class="mt-1" label-placement="top">
        <n-form-item label="项目名称" required>
          <n-input v-model:value="form.name" placeholder="例如：官网 / 小程序" />
        </n-form-item>
        <n-form-item label="描述">
          <n-input v-model:value="form.description" type="textarea" placeholder="可选" :rows="3" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="create">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showKey"
      preset="card"
      content-scrollable
      title="请保存 API Key"
      style="width: min(520px, calc(100vw - 24px))"
      :bordered="false"
    >
      <n-alert type="warning" :bordered="false" class="mb-3">
        此密钥仅显示一次，关闭后无法再次查看明文，请立即复制保存。
      </n-alert>
      <n-input :value="createdKey" readonly type="textarea" :rows="3" />
      <n-button class="mt-3" block type="primary" @click="copyKey">复制密钥</n-button>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NTag,
  NSpace,
  NAlert,
  useMessage,
  useDialog,
} from 'naive-ui';
import { projectsApi } from '@/api';
import { formatTime } from '@/utils/labels';

const list = ref<any[]>([]);
const loading = ref(false);
const creating = ref(false);
const showCreate = ref(false);
const showKey = ref(false);
const createdKey = ref('');
const form = reactive({ name: '', description: '' });
const message = useMessage();
const dialog = useDialog();
const router = useRouter();

const columns = [
  {
    title: '名称',
    key: 'name',
    render: (r: any) =>
      h('div', { class: 'font-semibold text-slate-800' }, r.name),
  },
  {
    title: '描述',
    key: 'description',
    ellipsis: { tooltip: true },
    render: (r: any) => r.description || '-',
  },
  {
    title: 'API Key',
    key: 'apiKey',
    width: 190,
    render: (r: any) => h('code', null, r.apiKey),
  },
  {
    title: '状态',
    key: 'enabled',
    width: 90,
    render: (r: any) =>
      h(
        NTag,
        { type: r.enabled ? 'success' : 'default', size: 'small' },
        { default: () => (r.enabled ? '启用' : '禁用') },
      ),
  },
  {
    title: '渠道/消息',
    key: 'counts',
    width: 110,
    render: (r: any) => `${r._count?.channels ?? 0} / ${r._count?.messages ?? 0}`,
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 170,
    render: (r: any) => formatTime(r.createdAt),
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    fixed: 'right' as const,
    render: (r: any) =>
      h(NSpace, { wrap: false, size: 6 }, {
        default: () => [
          h(
            NButton,
            { size: 'small', type: 'primary', secondary: true, onClick: () => router.push(`/projects/${r.id}`) },
            { default: () => '详情' },
          ),
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
        ],
      }),
  },
];

async function load() {
  loading.value = true;
  try {
    list.value = (await projectsApi.list()) || [];
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (!form.name.trim()) {
    message.warning('请填写项目名称');
    return;
  }
  creating.value = true;
  try {
    const res: any = await projectsApi.create({
      name: form.name.trim(),
      description: form.description || undefined,
    });
    createdKey.value = res.apiKey;
    showCreate.value = false;
    showKey.value = true;
    form.name = '';
    form.description = '';
    await load();
    message.success('创建成功');
  } catch (e: any) {
    message.error(e.message);
  } finally {
    creating.value = false;
  }
}

function copyKey() {
  navigator.clipboard.writeText(createdKey.value);
  message.success('已复制');
}

function remove(row: any) {
  dialog.warning({
    title: '确认删除',
    content: `确定删除项目「${row.name}」？绑定关系与消息记录将一并处理。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await projectsApi.remove(row.id);
        message.success('已删除');
        await load();
      } catch (e: any) {
        message.error(e.message);
      }
    },
  });
}

onMounted(load);
</script>
