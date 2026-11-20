<template>
  <div class="space-y-5">
    <div class="page-header">
      <div><div class="page-title">推送设备</div><div class="page-subtitle">关联 BrowserShell，查看最近报告的推送连接、通知权限与时间</div></div>
      <n-button secondary :loading="loading" @click="load">刷新</n-button>
    </div>

    <n-alert type="info" :bordered="false">选择已启用的极光设备渠道生成一次性配对码，然后在 BrowserShell 中打开「设置 → 关联消息设备」并输入配对码。配对码有效 10 分钟，只能使用一次；请勿转发给其他人。</n-alert>
    <p class="text-sm text-slate-500">多设备定向推送需要每台手机分别完成关联，才能核验该手机的接收与显示回执。手机在启动、前台、网络或推送连接变化时报告状态；长时间没有新报告时显示「状态待刷新」。</p>

    <section class="page-card space-y-4 p-4 md:p-5">
      <div><h2 class="text-base font-semibold text-slate-800">关联一台手机</h2><p class="mt-1 text-sm text-slate-500">所选渠道必须按 Registration ID 定向到已安装这款浏览器的手机。</p></div>
      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <n-form-item label="启用的极光设备渠道"><n-select v-model:value="selectedChannelId" :options="channelOptions" :disabled="!channels.length || issuing" placeholder="选择已启用的设备定向渠道" filterable /></n-form-item>
        <n-button type="primary" :disabled="!selectedChannelId" :loading="issuing" @click="issuePairingCode">生成配对码</n-button>
      </div>
      <n-alert v-if="!channels.length && !loading" type="warning" :bordered="false">没有可配对的极光设备渠道。请先在「渠道管理」中启用带 AppKey、使用 Registration ID 定向发送的极光渠道。</n-alert>
      <div v-if="pairingCode" class="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><div class="text-sm font-medium text-blue-900">{{ pairingCode.channelName }} · AppKey 指纹 {{ pairingCode.appFingerprint }}</div><div class="mt-1 text-xs text-blue-700">{{ pairingExpired ? '配对码已过期，请重新生成。' : `请在 ${formatTime(pairingCode.expiresAt)} 前完成手机配对。` }}</div></div>
          <n-tag size="small" :type="pairingExpired ? 'warning' : 'info'">{{ pairingExpired ? '已过期' : '一次性' }}</n-tag>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-3"><code class="rounded-lg border border-blue-200 bg-white px-3 py-2 font-mono text-lg tracking-[0.16em] text-slate-800">{{ pairingCode.code }}</code><n-button secondary :disabled="pairingExpired" @click="copyPairingCode">复制配对码</n-button></div>
      </div>
    </section>

    <section class="page-card space-y-4 p-4 md:p-5">
      <div><h2 class="text-base font-semibold text-slate-800">已关联设备</h2><p class="mt-1 text-sm text-slate-500">服务商受理、手机接收、通知栏显示和用户已读分别记录；其中任何一个状态都不代替后续阶段的证据。</p></div>
      <n-alert v-if="items.some(item => !item.revokedAt && (item.notificationsEnabled === false || item.channelEnabled === false))" type="warning" :bordered="false">有手机关闭了 Android 通知权限或「消息通知」渠道。请在 BrowserShell 设置中打开系统通知设置，允许通知和弹出横幅。</n-alert>
      <div class="table-shell !border-0 !p-0 !shadow-none"><n-data-table :columns="columns" :data="items" :loading="loading" :bordered="false" :pagination="false" :scroll-x="1000"/><div v-if="!loading && !items.length" class="px-4 py-8 text-center text-sm text-slate-400">还没有关联设备。先生成配对码，再在 BrowserShell 设置里完成关联。</div></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue';
import { NAlert, NButton, NDataTable, NFormItem, NSelect, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
import { devicesApi } from '@/api';
import { formatTime } from '@/utils/labels';

type Channel = { id: string; name: string; appFingerprint: string; deviceCount: number };
type Device = { id: string; name: string; registrationId: string; appFingerprint: string; appVersion?: string | null; osVersion?: string | null; notificationsEnabled?: boolean | null; channelEnabled?: boolean | null; jpushConnected: boolean; online: boolean; lastSeenAt: string; revokedAt?: string | null; targetedByEnabledChannel: boolean };
type PairingCode = { channelId: string; channelName: string; appFingerprint: string; code: string; expiresAt: string };

const message = useMessage();
const dialog = useDialog();
const channels = ref<Channel[]>([]);
const items = ref<Device[]>([]);
const selectedChannelId = ref<string | null>(null);
const loading = ref(false);
const issuing = ref(false);
const revokingId = ref('');
const pairingCode = ref<PairingCode | null>(null);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
const channelOptions = computed(() => channels.value.map(channel => ({ value: channel.id, label: `${channel.name} · ${channel.deviceCount} 台目标设备` })));
const pairingExpired = computed(() => !pairingCode.value || Date.parse(pairingCode.value.expiresAt) <= now.value);

function status(row: Device) {
  if (row.revokedAt) return { label: '已撤销', type: 'default' as const };
  if (!row.online) return { label: '状态待刷新', type: 'default' as const };
  if (row.notificationsEnabled === false) return { label: '通知权限关闭', type: 'error' as const };
  if (row.channelEnabled === false) return { label: '消息渠道关闭', type: 'error' as const };
  if (!row.jpushConnected) return { label: '上次报告极光未连接', type: 'warning' as const };
  if (!row.targetedByEnabledChannel) return { label: '不在启用渠道', type: 'warning' as const };
  return { label: '最近报告正常', type: 'success' as const };
}

async function load() {
  loading.value = true;
  try {
    const result = await devicesApi.list();
    channels.value = Array.isArray(result?.channels) ? result.channels : [];
    items.value = Array.isArray(result?.items) ? result.items : [];
    if (!channels.value.some(channel => channel.id === selectedChannelId.value)) selectedChannelId.value = channels.value[0]?.id || null;
  } catch (error: any) { message.error(error.message || '读取推送设备失败'); }
  finally { loading.value = false; }
}

async function issuePairingCode() {
  const channelId = selectedChannelId.value;
  if (!channelId || issuing.value) return;
  issuing.value = true;
  try { pairingCode.value = await devicesApi.createPairingCode(channelId); }
  catch (error: any) { pairingCode.value = null; message.error(error.message || '生成配对码失败'); }
  finally { issuing.value = false; }
}

async function copyPairingCode() {
  if (!pairingCode.value || pairingExpired.value) return;
  try { await navigator.clipboard.writeText(pairingCode.value.code); message.success('配对码已复制，请仅在你的 BrowserShell 设备中使用'); }
  catch { message.error('无法复制配对码，请检查浏览器权限'); }
}

function requestRevoke(device: Device) {
  dialog.warning({ title: '撤销设备关联', content: `撤销「${device.name}」后，这台设备需要重新配对才能继续报告通知状态。`, positiveText: '确认撤销', negativeText: '取消', onPositiveClick: () => revokeDevice(device.id) });
}

async function revokeDevice(id: string) {
  if (revokingId.value) return;
  revokingId.value = id;
  try { await devicesApi.revoke(id); message.success('设备关联已撤销'); await load(); }
  catch (error: any) { message.error(error.message || '撤销设备关联失败'); }
  finally { revokingId.value = ''; }
}

const columns = [
  { title: '设备 / Registration ID', key: 'name', width: 190, render: (row: Device) => h('div', { class: 'space-y-1' }, [h('div', { class: 'font-medium text-slate-800' }, row.name), h('div', { class: 'text-xs text-slate-400' }, row.registrationId)]) },
  { title: '状态', key: 'status', width: 175, render: (row: Device) => { const value = status(row); return h(NTag, { size: 'small', type: value.type }, { default: () => value.label }); } },
  { title: '通知权限 / 消息渠道', key: 'permissions', width: 180, render: (row: Device) => h(NSpace, { size: 4, wrap: true }, { default: () => [h(NTag, { size: 'tiny', type: row.notificationsEnabled === true ? 'success' : row.notificationsEnabled === false ? 'error' : 'default' }, { default: () => row.notificationsEnabled === true ? '通知已开' : row.notificationsEnabled === false ? '通知已关' : '权限未知' }), h(NTag, { size: 'tiny', type: row.channelEnabled === true ? 'success' : row.channelEnabled === false ? 'error' : 'default' }, { default: () => row.channelEnabled === true ? '渠道已开' : row.channelEnabled === false ? '渠道已关' : '渠道未知' })] }) },
  { title: 'BrowserShell', key: 'appVersion', width: 155, render: (row: Device) => `${row.appVersion || '未知'}${row.osVersion ? ` · Android ${row.osVersion}` : ''}` },
  { title: '最近报告', key: 'lastSeenAt', width: 170, render: (row: Device) => formatTime(row.lastSeenAt) },
  { title: '目标渠道', key: 'targetedByEnabledChannel', width: 110, render: (row: Device) => h(NTag, { size: 'small', type: row.targetedByEnabledChannel ? 'success' : 'warning' }, { default: () => row.targetedByEnabledChannel ? '已覆盖' : '未覆盖' }) },
  { title: '操作', key: 'action', width: 100, fixed: 'right' as const, render: (row: Device) => h(NButton, { size: 'small', type: 'error', secondary: true, disabled: !!row.revokedAt, loading: revokingId.value === row.id, onClick: () => requestRevoke(row) }, { default: () => row.revokedAt ? '已撤销' : '撤销' }) },
];

onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 1000); refreshTimer = setInterval(() => { if (!document.hidden && !loading.value) void load(); }, 15000); void load(); });
onUnmounted(() => { if (clock) clearInterval(clock); if (refreshTimer) clearInterval(refreshTimer); pairingCode.value = null; });
</script>
