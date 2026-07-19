<template>
  <div>
    <div class="page-header">
      <div>
        <div class="page-title">事件目录</div>
        <div class="text-slate-500 text-sm mt-1">
          业务侧传 event + variables，平台按事件绑定模板与默认优先级
        </div>
      </div>
      <n-button type="primary" @click="openCreate">新建事件</n-button>
    </div>

    <div class="page-card table-shell">
      <n-data-table
        :columns="columns"
        :data="items"
        :loading="loading"
        :bordered="false"
        :scroll-x="960"
      />
    </div>

    <n-modal v-model:show="show" preset="card" :title="editing ? '编辑事件' : '新建事件'" style="width: 520px">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="code">
          <n-input v-model:value="form.code" :disabled="!!editing" placeholder="comment.reply" />
        </n-form-item>
        <n-form-item label="名称">
          <n-input v-model:value="form.name" />
        </n-form-item>
        <n-form-item label="说明">
          <n-input v-model:value="form.description" type="textarea" :rows="2" />
        </n-form-item>
        <n-form-item label="默认优先级">
          <n-select v-model:value="form.defaultPriority" :options="priorityOptions" />
        </n-form-item>
        <n-form-item label="推送模板">
          <n-input v-model:value="form.pushTemplateCode" placeholder="可选 code" />
        </n-form-item>
        <n-form-item label="邮件模板">
          <n-input v-model:value="form.emailTemplateCode" placeholder="可选 code" />
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
  NModal,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui';
import { eventsApi } from '@/api';
import { PRIORITY_LABELS, formatTime } from '@/utils/labels';

const message = useMessage();
const loading = ref(false);
const saving = ref(false);
const items = ref<any[]>([]);
const show = ref(false);
const editing = ref<any>(null);
const form = reactive({
  code: '',
  name: '',
  description: '',
  defaultPriority: 'NORMAL',
  pushTemplateCode: '',
  emailTemplateCode: '',
  enabled: true,
});

const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({
  label,
  value,
}));

const columns = [
  { title: 'code', key: 'code', width: 160 },
  { title: '名称', key: 'name' },
  {
    title: '优先级',
    key: 'defaultPriority',
    width: 90,
    render: (r: any) => PRIORITY_LABELS[r.defaultPriority] || r.defaultPriority,
  },
  {
    title: '模板',
    key: 'tpl',
    render: (r: any) =>
      [r.pushTemplateCode && `push:${r.pushTemplateCode}`, r.emailTemplateCode && `mail:${r.emailTemplateCode}`]
        .filter(Boolean)
        .join(' / ') || '-',
  },
  {
    title: '范围',
    key: 'scope',
    width: 100,
    render: (r: any) =>
      h(NTag, { size: 'small', type: r.isSystem ? 'info' : 'default' }, {
        default: () => (r.isSystem ? '系统' : r.project?.name || '项目'),
      }),
  },
  {
    title: '状态',
    key: 'enabled',
    width: 80,
    render: (r: any) =>
      h(NTag, { size: 'small', type: r.enabled ? 'success' : 'default' }, {
        default: () => (r.enabled ? '启用' : '停用'),
      }),
  },
  {
    title: '更新',
    key: 'updatedAt',
    width: 160,
    render: (r: any) => formatTime(r.updatedAt),
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
        !r.isSystem
          ? h(
              NButton,
              { size: 'tiny', quaternary: true, type: 'error', onClick: () => remove(r) },
              { default: () => '删除' },
            )
          : null,
      ]),
  },
];

async function load() {
  loading.value = true;
  try {
    items.value = await eventsApi.list();
  } catch (e: any) {
    message.error(e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  Object.assign(form, {
    code: '',
    name: '',
    description: '',
    defaultPriority: 'NORMAL',
    pushTemplateCode: '',
    emailTemplateCode: '',
    enabled: true,
  });
  show.value = true;
}

function openEdit(row: any) {
  editing.value = row;
  Object.assign(form, {
    code: row.code,
    name: row.name,
    description: row.description || '',
    defaultPriority: row.defaultPriority || 'NORMAL',
    pushTemplateCode: row.pushTemplateCode || '',
    emailTemplateCode: row.emailTemplateCode || '',
    enabled: row.enabled !== false,
  });
  show.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (editing.value) {
      await eventsApi.update(editing.value.id, {
        name: form.name,
        description: form.description,
        defaultPriority: form.defaultPriority,
        pushTemplateCode: form.pushTemplateCode || null,
        emailTemplateCode: form.emailTemplateCode || null,
        enabled: form.enabled,
      });
    } else {
      await eventsApi.create({ ...form });
    }
    message.success('已保存');
    show.value = false;
    await load();
  } catch (e: any) {
    message.error(e?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(row: any) {
  try {
    await eventsApi.remove(row.id);
    message.success('已删除');
    await load();
  } catch (e: any) {
    message.error(e?.message || '删除失败');
  }
}

onMounted(load);
</script>
