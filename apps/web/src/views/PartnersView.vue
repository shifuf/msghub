<template>
  <div>
    <div class="page-header">
      <div>
        <div class="page-title">合作站 / 友链</div>
        <div class="page-subtitle">展示在门户页底部，可排序与启停</div>
      </div>
      <n-button type="primary" @click="openCreate">新增</n-button>
    </div>

    <div class="page-card table-shell">
      <n-data-table
        :columns="columns"
        :data="items"
        :loading="loading"
        :bordered="false"
        :scroll-x="860"
      />
    </div>

    <n-modal v-model:show="show" preset="card" :title="editing ? '编辑合作站' : '新增合作站'" style="width: 520px">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="名称" required>
          <n-input v-model:value="form.name" maxlength="80" />
        </n-form-item>
        <n-form-item label="链接" required>
          <n-input v-model:value="form.url" placeholder="https://..." />
        </n-form-item>
        <n-form-item label="Logo URL">
          <n-input v-model:value="form.logoUrl" placeholder="可选 https://..." />
        </n-form-item>
        <n-form-item label="简介">
          <n-input v-model:value="form.description" type="textarea" :rows="2" maxlength="200" />
        </n-form-item>
        <n-form-item label="排序">
          <n-input-number v-model:value="form.displayOrder" class="w-full" />
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="form.enabled" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="show = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </div>
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
  NInputNumber,
  NModal,
  NSwitch,
  NTag,
  useDialog,
  useMessage,
} from 'naive-ui';
import { partnersApi } from '@/api';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const saving = ref(false);
const items = ref<any[]>([]);
const show = ref(false);
const editing = ref<any>(null);
const form = reactive({
  name: '',
  url: '',
  logoUrl: '',
  description: '',
  displayOrder: 0,
  enabled: true,
});

const columns = [
  {
    title: '名称',
    key: 'name',
    render: (r: any) =>
      h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', class: 'text-blue-600' }, r.name),
  },
  { title: '简介', key: 'description', ellipsis: { tooltip: true }, render: (r: any) => r.description || '-' },
  { title: '排序', key: 'displayOrder', width: 80 },
  {
    title: '状态',
    key: 'enabled',
    width: 90,
    render: (r: any) =>
      h(NTag, { size: 'small', type: r.enabled ? 'success' : 'default' }, {
        default: () => (r.enabled ? '启用' : '停用'),
      }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 140,
    fixed: 'right' as const,
    render: (r: any) =>
      h('div', { class: 'flex gap-2' }, [
        h(
          NButton,
          { size: 'tiny', secondary: true, type: 'primary', onClick: () => openEdit(r) },
          { default: () => '编辑' },
        ),
        h(
          NButton,
          { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(r) },
          { default: () => '删除' },
        ),
      ]),
  },
];

async function load() {
  loading.value = true;
  try {
    items.value = (await partnersApi.list()) || [];
  } catch (e: any) {
    message.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    name: '',
    url: '',
    logoUrl: '',
    description: '',
    displayOrder: 0,
    enabled: true,
  });
  show.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  Object.assign(form, {
    name: row.name,
    url: row.url,
    logoUrl: row.logoUrl || '',
    description: row.description || '',
    displayOrder: row.displayOrder ?? 0,
    enabled: row.enabled !== false,
  });
  show.value = true;
}

async function save() {
  if (!form.name.trim() || !form.url.trim()) {
    message.warning('请填写名称和链接');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      logoUrl: form.logoUrl.trim() || undefined,
      description: form.description.trim() || undefined,
      displayOrder: form.displayOrder ?? 0,
      enabled: form.enabled,
    };
    if (editing.value) {
      await partnersApi.update(editing.value.id, payload);
    } else {
      await partnersApi.create(payload);
    }
    message.success('已保存');
    show.value = false;
    await load();
  } catch (e: any) {
    message.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function remove(row: any) {
  dialog.warning({
    title: '删除合作站',
    content: `确认删除「${row.name}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await partnersApi.remove(row.id);
        message.success('已删除');
        await load();
      } catch (e: any) {
        message.error(e.message || '删除失败');
      }
    },
  });
}

onMounted(load);
</script>
