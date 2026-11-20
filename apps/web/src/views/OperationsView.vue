<template>
  <div class="space-y-5">
    <div class="page-header">
      <div>
        <div class="page-title">运行维护</div>
        <div class="page-subtitle">版本状态、就绪检查与完整灾备</div>
      </div>
      <n-button @click="refresh" :loading="loading">刷新</n-button>
    </div>

    <section class="page-card space-y-4 p-4 md:p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-slate-800">版本与服务状态</h2>
          <p class="mt-1 text-sm text-slate-500">渠道状态属于配置检查，不代表供应商已收到消息。</p>
        </div>
        <n-tag :type="health?.status === 'ok' ? 'success' : 'error'" round>{{ health?.status === 'ok' ? '服务就绪' : '服务未就绪' }}</n-tag>
      </div>
      <div v-if="health?.info" class="grid gap-3 sm:grid-cols-3">
        <div v-for="name in ['database', 'redis', 'worker']" :key="name" class="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-slate-700">{{ dependencyLabel(name) }}</span>
            <n-tag size="small" :type="health.info[name]?.status === 'up' ? 'success' : 'error'">{{ health.info[name]?.status === 'up' ? '正常' : '异常' }}</n-tag>
          </div>
          <div v-if="name === 'worker' && health.info.worker?.counts" class="mt-2 text-xs text-slate-500">
            等待 {{ health.info.worker.counts.waiting || 0 }} · 执行中 {{ health.info.worker.counts.active || 0 }} · 延迟 {{ health.info.worker.counts.delayed || 0 }}
          </div>
        </div>
      </div>
      <div v-else class="text-sm text-slate-500">无法读取就绪状态。</div>
      <div class="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg border border-slate-100 p-3"><div class="text-xs text-slate-400">容器提交</div><div class="mt-1 break-all font-medium text-slate-700">{{ version?.appCommit || '未知' }}</div></div>
        <div class="rounded-lg border border-slate-100 p-3"><div class="text-xs text-slate-400">构建时间</div><div class="mt-1 font-medium text-slate-700">{{ formatTime(version?.buildTime) }}</div></div>
        <div class="rounded-lg border border-slate-100 p-3"><div class="text-xs text-slate-400">数据库迁移</div><div class="mt-1 break-all font-medium text-slate-700">{{ version?.migrationVersion || '未知' }}</div></div>
        <div class="rounded-lg border border-slate-100 p-3"><div class="text-xs text-slate-400">迁移查询</div><div class="mt-1 font-medium text-slate-700">{{ version?.migrationStatus === 'up' ? '正常' : '不可用' }}</div></div>
      </div>
      <div v-if="version?.deployments?.length" class="space-y-2">
        <div class="text-sm font-medium text-slate-700">最近部署记录</div>
        <div class="table-shell">
          <n-data-table :columns="deploymentColumns" :data="version.deployments" :bordered="false" :pagination="false" />
        </div>
      </div>
    </section>

    <section class="page-card space-y-4 p-4 md:p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-slate-800">完整灾备</h2>
          <p class="mt-1 max-w-3xl text-sm text-slate-500">完整备份包含 PostgreSQL、Redis RDB、部署 env 与容器配置，使用服务器上的 age 密钥加密；备份含生产密钥，请妥善保管并仅存放于受控的项目数据目录。两个数据库快照在线读取，彼此不是原子快照。</p>
        </div>
        <n-tag :type="backup?.config?.enabled ? 'success' : 'default'" round>{{ backup?.config?.enabled ? '已启用' : '默认关闭' }}</n-tag>
      </div>

      <div class="grid gap-3 text-sm sm:grid-cols-3">
        <div class="rounded-lg border border-slate-100 p-3"><div class="text-xs text-slate-400">Runner</div><div class="mt-1 font-medium text-slate-700">{{ backup?.runner?.status === 'ready' ? '就绪' : backup?.runner?.status === 'running' ? '执行中' : '不可用' }}</div><div class="mt-1 text-xs text-slate-500">密钥 {{ backup?.runner?.keyConfigured ? '已配置' : '未配置' }} · 心跳 {{ formatTime(backup?.runner?.lastSeenAt) }}</div></div>
        <div class="rounded-lg border border-slate-100 p-3"><div class="text-xs text-slate-400">自动备份间隔</div><div class="mt-1 font-medium text-slate-700">{{ backup?.config?.intervalHours ?? 24 }} 小时</div></div>
        <div class="rounded-lg border border-slate-100 p-3"><div class="text-xs text-slate-400">保留最近</div><div class="mt-1 font-medium text-slate-700">{{ backup?.config?.retentionCount ?? 14 }} 份</div></div>
      </div>

      <n-form label-placement="top" class="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
        <n-form-item label="启用自动备份">
          <n-switch v-model:value="config.enabled" :disabled="!backup?.runner?.keyConfigured" />
        </n-form-item>
        <n-form-item label="备份间隔（小时）"><n-input-number v-model:value="config.intervalHours" :min="1" :max="168" class="w-full" /></n-form-item>
        <n-form-item label="保留份数"><n-input-number v-model:value="config.retentionCount" :min="1" :max="365" class="w-full" /></n-form-item>
        <n-form-item label="备份后自动验证"><n-switch v-model:value="config.verifyAfterBackup" /></n-form-item>
      </n-form>
      <div class="flex flex-wrap gap-2">
        <n-button type="primary" :loading="savingConfig" :disabled="!backup?.runner?.keyConfigured" @click="saveConfig">保存备份配置</n-button>
        <n-button type="warning" :loading="runningBackup" :disabled="!backup?.config?.enabled || backup?.runner?.status === 'unavailable'" @click="requestBackup">立即完整备份</n-button>
      </div>

      <div class="table-shell">
        <n-data-table :columns="backupColumns" :data="backup?.backups || []" :bordered="false" :pagination="false" />
        <div v-if="!backup?.backups?.length" class="px-4 py-8 text-center text-sm text-slate-400">尚无完整备份</div>
      </div>
      <div class="table-shell">
        <n-data-table :columns="jobColumns" :data="backup?.jobs || []" :bordered="false" :pagination="false" />
        <div v-if="!backup?.jobs?.length" class="px-4 py-5 text-center text-sm text-slate-400">尚无备份或验证任务</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import { NButton, NDataTable, NForm, NFormItem, NInputNumber, NSwitch, NTag, useDialog, useMessage } from 'naive-ui';
import { healthApi, operationsApi } from '@/api';
import { formatTime } from '@/utils/labels';

const loading = ref(false);
const savingConfig = ref(false);
const runningBackup = ref(false);
const version = ref<any>(null);
const health = ref<any>(null);
const backup = ref<any>(null);
const config = reactive({ enabled: false, intervalHours: 24, retentionCount: 14, verifyAfterBackup: true });
const message = useMessage();
const dialog = useDialog();

function dependencyLabel(name: string) { return ({ database: '数据库', redis: 'Redis', worker: '发送 Worker' } as Record<string, string>)[name] || name; }
function jobLabel(status: string) { return ({ pending: '等待中', running: '进行中', success: '完成', failed: '失败', uncertain: '状态待确认', unknown: '未知' } as Record<string, string>)[status] || status; }
function jobTag(status: string) { return status === 'success' ? 'success' : ['pending', 'running'].includes(status) ? 'info' : status === 'failed' ? 'error' : 'warning'; }
function verificationLabel(value: string) { return ({ passed: '已通过', failed: '失败', not_verified: '未验证' } as Record<string, string>)[value] || '未知'; }

const deploymentColumns = [
  { title: '状态', key: 'status', width: 90 },
  { title: '提交', key: 'commit', width: 130, render: (row: any) => row.commit || '未知' },
  { title: '开始时间', key: 'startedAt', render: (row: any) => formatTime(row.startedAt) },
  { title: '完成时间', key: 'finishedAt', render: (row: any) => formatTime(row.finishedAt) },
];
const backupColumns = [
  { title: '创建时间', key: 'createdAt', width: 190, render: (row: any) => formatTime(row.createdAt) },
  { title: '状态', key: 'status', width: 95, render: (row: any) => h(NTag, { size: 'small', type: row.status === 'complete' ? 'success' : 'error' }, { default: () => row.status === 'complete' ? '完成' : '失败' }) },
  { title: '大小', key: 'sizeBytes', width: 110, render: (row: any) => row.sizeBytes == null ? '-' : `${(row.sizeBytes / 1024 / 1024).toFixed(1)} MB` },
  { title: '校验', key: 'verification', width: 110, render: (row: any) => verificationLabel(row.verification) },
  { title: '一致性', key: 'consistency', width: 180, render: () => '在线读取；跨库非原子' },
  { title: '操作', key: 'actions', width: 100, render: (row: any) => h(NButton, { size: 'small', disabled: row.status !== 'complete' || !backup.value?.config?.enabled, loading: runningBackup.value, onClick: () => requestVerification(row) }, { default: () => '恢复验证' }) },
];
const jobColumns = [
  { title: '提交时间', key: 'createdAt', width: 190, render: (row: any) => formatTime(row.createdAt) },
  { title: '任务', key: 'action', width: 100, render: (row: any) => row.action === 'backup' ? '完整备份' : '恢复验证' },
  { title: '状态', key: 'status', width: 110, render: (row: any) => h(NTag, { size: 'small', type: jobTag(row.status) }, { default: () => jobLabel(row.status) }) },
  { title: '错误代码', key: 'errorCode', render: (row: any) => row.errorCode || '-' },
  { title: '结束时间', key: 'finishedAt', render: (row: any) => formatTime(row.finishedAt) },
];

async function refresh() {
  loading.value = true;
  try {
    const results = await Promise.allSettled([operationsApi.version(), operationsApi.backupStatus(), healthApi.ready()]);
    if (results[0].status === 'fulfilled') version.value = results[0].value;
    else message.error(results[0].reason?.message || '读取版本状态失败');
    if (results[1].status === 'fulfilled') {
      backup.value = results[1].value;
      Object.assign(config, backup.value?.config || {});
    } else message.error(results[1].reason?.message || '读取备份状态失败');
    health.value = results[2].status === 'fulfilled' ? results[2].value : results[2].reason?.response?.data?.data || { status: 'error' };
  } finally { loading.value = false; }
}

async function saveConfig() {
  savingConfig.value = true;
  try {
    await operationsApi.updateBackupConfig({ ...config });
    message.success('备份配置已保存');
    await refresh();
  } catch (error: any) { message.error(error.message || '保存备份配置失败'); }
  finally { savingConfig.value = false; }
}

function requestBackup() {
  dialog.warning({ title: '立即创建完整备份', content: '备份包括 PostgreSQL、Redis、环境变量及容器配置。生成的加密文件包含生产凭据，并写入项目本地 data/backups 目录。', positiveText: '提交备份任务', negativeText: '取消', onPositiveClick: submitBackup });
}

async function submitBackup() {
  runningBackup.value = true;
  try { const result = await operationsApi.runBackup(); message.success(`备份任务已提交${result?.id ? `：${result.id}` : ''}`); await refresh(); }
  catch (error: any) { message.error(error.message || '提交备份失败'); }
  finally { runningBackup.value = false; }
}

function requestVerification(row: any) {
  dialog.warning({ title: '隔离恢复验证', content: `将在 runner 私有目录启动临时 PostgreSQL 与 Redis，恢复并校验备份「${row.id}」，随后清理临时数据库数据。验证通过前不会覆盖生产数据。`, positiveText: '开始验证', negativeText: '取消', onPositiveClick: () => submitVerification(row.id) });
}

async function submitVerification(backupId: string) {
  runningBackup.value = true;
  try { const result = await operationsApi.verifyBackup(backupId); message.success(`恢复验证任务已提交${result?.id ? `：${result.id}` : ''}`); await refresh(); }
  catch (error: any) { message.error(error.message || '提交恢复验证失败'); }
  finally { runningBackup.value = false; }
}

onMounted(() => void refresh());
</script>
