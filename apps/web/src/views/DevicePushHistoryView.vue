<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">设备推送历史</div>
        <div class="page-subtitle">
          按 Registration ID 查看棱镜 / 极光推送 · 已读状态 · 未读可重推（仍未读则走邮件兜底）
        </div>
      </div>
      <n-button type="primary" secondary @click="reload">刷新</n-button>
    </div>

    <div class="page-card p-3 md:p-4 space-y-3">
      <div class="filters-row">
        <n-input
          v-model:value="filters.registrationId"
          clearable
          placeholder="Registration ID"
          class="w-full sm:w-72"
          @keyup.enter="reload"
          @clear="reload"
        />
        <n-select
          v-model:value="filters.knownPick"
          clearable
          filterable
          placeholder="从已知 RID 选择"
          class="w-full sm:w-64"
          :options="ridOptions"
          @update:value="onPickRid"
        />
        <n-select
          v-model:value="filters.projectId"
          clearable
          placeholder="全部项目"
          class="w-full sm:w-44"
          :options="projectOptions"
          @update:value="reload"
        />
        <n-input
          v-model:value="filters.q"
          clearable
          placeholder="关键词"
          class="w-full sm:w-44"
          @keyup.enter="reload"
          @clear="reload"
        />
        <div class="flex items-center gap-2 text-sm text-slate-600">
          <n-switch v-model:value="filters.unreadOnly" @update:value="reload" />
          <span>仅未读</span>
        </div>
        <n-button @click="reload">查询</n-button>
      </div>

      <div class="table-shell !border-0 !shadow-none !p-0">
        <n-data-table
          :columns="columns"
          :data="items"
          :loading="loading"
          :bordered="false"
          :pagination="pagination"
          :scroll-x="1280"
          @update:page="onPage"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NDataTable,
  NInput,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui';
import { messagesApi, projectsApi } from '@/api';
import { formatTime, STATUS_LABELS, statusTagType } from '@/utils/labels';

const message = useMessage();
const loading = ref(false);
const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const projectOptions = ref<{ label: string; value: string }[]>([]);
const knownRids = ref<{ registrationId: string; channelName: string }[]>([]);

const filters = reactive({
  registrationId: '',
  knownPick: null as string | null,
  projectId: null as string | null,
  q: '',
  unreadOnly: false,
});

const ridOptions = computed(() => {
  const map = new Map<string, string>();
  for (const r of knownRids.value) {
    const short =
      r.registrationId.length > 18
        ? r.registrationId.slice(0, 10) + '…' + r.registrationId.slice(-6)
        : r.registrationId;
    map.set(r.registrationId, `${short} · ${r.channelName}`);
  }
  for (const it of items.value) {
    if (it.registrationId && !map.has(it.registrationId)) {
      map.set(it.registrationId, it.registrationId);
    }
  }
  return Array.from(map.entries()).map(([value, label]) => ({ label, value }));
});

function onPickRid(v: string | null) {
  if (v) filters.registrationId = v;
  reload();
}

const pagination = computed(() => ({
  page: page.value,
  pageSize,
  itemCount: total.value,
  showSizePicker: false,
}));

const columns = [
  {
    title: '时间',
    key: 'createdAt',
    width: 160,
    render: (r: any) => formatTime(r.createdAt),
  },
  {
    title: '项目',
    key: 'project',
    width: 120,
    render: (r: any) => r.project?.name || '-',
  },
  {
    title: 'Registration ID',
    key: 'registrationId',
    width: 200,
    ellipsis: { tooltip: true },
    render: (r: any) => r.registrationId || r.toAddress || '-',
  },
  {
    title: '标题',
    key: 'title',
    width: 200,
    ellipsis: { tooltip: true },
    render: (r: any) => r.title || '-',
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (r: any) =>
      h(NTag, { size: 'small', type: statusTagType(r.status), round: true }, {
        default: () => STATUS_LABELS[r.status] || r.status,
      }),
  },
  {
    title: '已读',
    key: 'readAt',
    width: 190,
    render: (r: any) => {
      if (r.emailFallback || r.readVia === 'email_fallback') {
        return h(
          NTag,
          { size: 'small', type: 'info' },
          {
            default: () =>
              `邮箱兜底已读${r.emailFallbackAt ? ' · ' + formatTime(r.emailFallbackAt) : ''}`,
          },
        );
      }
      if (r.readAt) {
        return h(NTag, { size: 'small', type: 'success' }, {
          default: () => formatTime(r.readAt),
        });
      }
      return h(NTag, { size: 'small', type: 'warning' }, { default: () => '未读' });
    },
  },
  {
    title: '邮件兜底',
    key: 'fallback',
    width: 200,
    render: (r: any) => {
      if (r.emailFallback || r.readVia === 'email_fallback') {
        return h('div', { class: 'text-xs leading-snug' }, [
          h(NTag, { size: 'small', type: 'success' }, { default: () => '已使用邮箱兜底' }),
          h(
            'div',
            { class: 'text-slate-500 mt-1' },
            `发送：${r.emailFallbackAt ? formatTime(r.emailFallbackAt) : '-'}`,
          ),
          r.emailFallbackTo
            ? h('div', { class: 'text-slate-400' }, `收件：${r.emailFallbackTo}`)
            : null,
        ]);
      }
      if (r.fallbackPending) {
        return h('div', { class: 'text-xs leading-snug' }, [
          h(NTag, { size: 'small', type: 'info' }, { default: () => '已排程' }),
          h(
            'div',
            { class: 'text-slate-500 mt-1' },
            `计划：${r.fallbackRunAt ? formatTime(r.fallbackRunAt) : '-'}`,
          ),
        ]);
      }
      if (r.unread) {
        return h('span', { class: 'text-slate-400 text-xs' }, '无排程/未开启');
      }
      return '-';
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    fixed: 'right' as const,
    render: (r: any) =>
      h(NSpace, { wrap: false, size: 6 }, {
        default: () => {
          const btns = [
            h(
              NButton,
              {
                size: 'small',
                secondary: true,
                onClick: () => copyText(r.registrationId || r.toAddress || '', 'RID'),
              },
              { default: () => '复制 RID' },
            ),
          ];
          // 已读或已邮件兜底的记录不允许重发
          const locked =
            r.canResend === false ||
            !!r.readAt ||
            !!r.emailFallback ||
            r.readVia === 'email_fallback' ||
            !r.unread;
          if (!locked) {
            btns.push(
              h(
                NButton,
                {
                  size: 'small',
                  type: 'primary',
                  secondary: true,
                  onClick: () => resendUnread(r),
                },
                { default: () => '重推' },
              ),
              h(
                NButton,
                {
                  size: 'small',
                  secondary: true,
                  onClick: () => markRead(r),
                },
                { default: () => '标已读' },
              ),
            );
          }
          return btns;
        },
      }),
  },
];

function copyText(text: string, label = '内容') {
  if (!text) {
    message.warning('无内容可复制');
    return;
  }
  navigator.clipboard?.writeText(text).then(
    () => message.success(`已复制${label}`),
    () => message.error('复制失败'),
  );
}

async function reload() {
  loading.value = true;
  try {
    const res: any = await messagesApi.deviceHistory({
      registrationId: filters.registrationId || undefined,
      projectId: filters.projectId || undefined,
      q: filters.q || undefined,
      unreadOnly: filters.unreadOnly || undefined,
      page: page.value,
      pageSize,
    });
    items.value = res?.items || [];
    total.value = res?.total || 0;
    knownRids.value = res?.knownRegistrationIds || [];
  } catch (e: any) {
    message.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function onPage(p: number) {
  page.value = p;
  reload();
}

async function markRead(row: any) {
  try {
    await messagesApi.markRead([row.id]);
    message.success('已标已读，邮件兜底已取消');
    await reload();
  } catch (e: any) {
    message.error(e.message);
  }
}

async function resendUnread(row: any) {
  if (row.emailFallback || row.readAt || row.canResend === false) {
    message.warning('已读或已邮箱兜底，无法重发');
    return;
  }
  try {
    await messagesApi.resendUnread(row.id);
    message.success('已重新下发推送；若仍未读将继续邮件兜底');
    await reload();
  } catch (e: any) {
    message.error(e.message);
  }
}

onMounted(async () => {
  try {
    const list: any[] = (await projectsApi.list()) || [];
    projectOptions.value = list.map((p) => ({ label: p.name, value: p.id }));
  } catch {
    /* ignore */
  }
  await reload();
});
</script>
