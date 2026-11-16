<template>
  <div class="admin-shell min-h-screen">
    <div v-if="mobileOpen" class="sider-mask" @click="mobileOpen = false"></div>

    <aside
      class="admin-sider"
      :class="{ collapsed: !isMobile && collapsed, mobile: isMobile, open: mobileOpen }"
    >
      <div class="brand">
        <div class="brand-mark">
          <n-icon :size="22" :component="Icons.send" color="#fff" />
        </div>
        <div v-if="isMobile || !collapsed" class="brand-text">
          <div class="brand-title">消息推送</div>
          <div class="brand-sub">Notify Hub</div>
        </div>
        <button v-if="isMobile" class="icon-btn mobile-close" type="button" @click="mobileOpen = false">
          <n-icon :size="20" :component="Icons.close" />
        </button>
      </div>

      <n-menu
        :collapsed="!isMobile && collapsed"
        :collapsed-width="80"
        :options="menuOptions"
        :value="activeKey"
        :root-indent="18"
        @update:value="onMenu"
      />

      <div class="sider-footer" v-if="isMobile || !collapsed">
        <div class="footer-chip">
          v1.4 · 单用户 ·
          <span :class="notify.connected ? 'live-on' : 'live-off'">
            {{ notify.connected ? 'SSE 已连接' : '轮询备用' }}
          </span>
        </div>
      </div>
    </aside>

    <div class="admin-main" :class="{ collapsed: !isMobile && collapsed, 'mobile-main': isMobile }">
      <header class="admin-header">
        <div class="header-left">
          <button
            class="icon-btn"
            type="button"
            @click="toggleSider"
            :title="isMobile ? '菜单' : collapsed ? '展开菜单' : '收起菜单'"
          >
            <n-icon :size="20" :component="Icons.menu" />
          </button>
          <div class="min-w-0">
            <div class="header-title">{{ pageTitle }}</div>
            <div class="header-crumb">控制台 / {{ pageTitle }}</div>
          </div>
        </div>

        <div class="header-right">
          <n-popover
            trigger="click"
            placement="bottom-end"
            :width="notifyPopoverWidth"
            :style="{ maxWidth: 'calc(100vw - 16px)' }"
            @update:show="onPopoverShow"
          >
            <template #trigger>
              <button class="icon-btn notify-btn" type="button" title="通知">
                <n-badge :value="notify.unreadCount" :max="99" :show-zero="false" type="error" :offset="[-2, 2]">
                  <n-icon :size="isMobile ? 22 : 24" :component="Icons.bell" />
                </n-badge>
              </button>
            </template>
            <div class="notify-panel">
              <div class="notify-panel-head">
                <div class="font-semibold text-slate-800">消息通知</div>
                <div class="flex items-center gap-2">
                  <span class="text-xs" :class="notify.connected ? 'text-emerald-500' : 'text-slate-400'">
                    {{ notify.connected ? '实时' : '轮询' }}
                  </span>
                  <span class="text-xs text-slate-400" v-if="notify.pending">排队 {{ notify.pending }}</span>
                  <n-button text size="tiny" type="primary" @click="markVisibleRead">当前列表已读</n-button>
                </div>
              </div>
              <div v-if="!notify.items.length" class="notify-empty">暂无新通知</div>
              <div v-else class="notify-list">
                <div
                  v-for="item in notify.items.slice(0, 15)"
                  :key="item.id"
                  class="notify-item"
                  :class="{ unread: !item.read }"
                  @click="openNotify(item)"
                >
                  <div class="notify-item-top">
                    <n-tag size="tiny" :type="statusTagType(item.status)">
                      {{ STATUS_LABELS[item.status] || item.status }}
                    </n-tag>
                    <span class="notify-time">{{ formatTime(item.createdAt) }}</span>
                  </div>
                  <div class="notify-title">{{ item.title || '（无标题）' }}</div>
                  <div class="notify-meta">
                    {{ item.project?.name || '系统' }}
                    ·
                    {{
                      item.channelType
                        ? CHANNEL_TYPE_LABELS[item.channelType] || item.channelType
                        : '站内'
                    }}
                  </div>
                </div>
              </div>
              <div class="notify-panel-foot">
                <n-button text type="primary" @click="goMessages">查看全部发送记录</n-button>
              </div>
            </div>
          </n-popover>

          <div class="user-pill">
            <div class="user-avatar">{{ avatarText }}</div>
            <div class="user-meta">
              <div class="user-name">{{ auth.user?.username || 'admin' }}</div>
              <div class="user-role">超级管理员</div>
            </div>
          </div>
          <n-button quaternary class="!rounded-xl hide-sm" @click="goSettings">设置</n-button>
          <n-button type="primary" secondary class="!rounded-xl" @click="logout">退出</n-button>
        </div>
      </header>

      <main class="admin-content">
        <div class="content-inner">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NMenu,
  NButton,
  NIcon,
  NBadge,
  NPopover,
  NTag,
  useNotification,
  useMessage,
} from 'naive-ui';
import { useAuthStore } from '@/stores/auth';
import { useNotifyStore, type NotifyItem } from '@/stores/notify';
import {
  CHANNEL_TYPE_LABELS,
  STATUS_LABELS,
  formatTime,
  statusTagType,
} from '@/utils/labels';
import { Icons, renderIcon } from '@/utils/icons';
import { getAdminPath } from '@/config';

const collapsed = ref(false);
const mobileOpen = ref(false);
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200);
const isMobile = computed(() => windowWidth.value < 900);
const notifyPopoverWidth = computed(() => (isMobile.value ? Math.min(windowWidth.value - 24, 360) : 380));

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const notify = useNotifyStore();
const ntf = useNotification();
const message = useMessage();

const menuOptions = [
  { label: '仪表盘', key: 'dashboard', icon: renderIcon(Icons.home, 20) },
  { label: '项目管理', key: 'projects', icon: renderIcon(Icons.folder, 20) },
  { label: '渠道管理', key: 'channels', icon: renderIcon(Icons.network, 20) },
  { label: '邮件模板', key: 'templates', icon: renderIcon(Icons.mail, 20) },
  { label: '推送模板', key: 'push-templates', icon: renderIcon(Icons.document, 20) },
  { label: '事件目录', key: 'events', icon: renderIcon(Icons.flash, 20) },
  { label: '发送记录', key: 'messages', icon: renderIcon(Icons.list, 20) },
  { label: '设备推送', key: 'device-push', icon: renderIcon(Icons.network, 20) },
  { label: '抑制名单', key: 'suppress', icon: renderIcon(Icons.mail, 20) },
  { label: '定时发送', key: 'schedules', icon: renderIcon(Icons.time, 20) },
  { label: '发送队列', key: 'queue', icon: renderIcon(Icons.list, 20) },
  { label: '操作日志', key: 'activity', icon: renderIcon(Icons.list, 20) },
  { label: '合作站', key: 'partners', icon: renderIcon(Icons.link, 20) },
  { label: '系统设置', key: 'settings', icon: renderIcon(Icons.settings, 20) },
];

const activeKey = computed(() => {
  const name = String(route.name || '');
  if (name.startsWith('project')) return 'projects';
  if (name === 'channels') return 'channels';
  if (name.startsWith('template')) return 'templates';
  if (name === 'push-templates') return 'push-templates';
  if (name === 'events') return 'events';
  if (name === 'messages') return 'messages';
  if (name === 'device-push') return 'device-push';
  if (name === 'suppress') return 'suppress';
  if (name === 'schedules') return 'schedules';
  if (name === 'queue') return 'queue';
  if (name === 'activity') return 'activity';
  if (name === 'partners') return 'partners';
  if (name === 'settings') return 'settings';
  if (name === 'dashboard') return 'dashboard';
  return 'dashboard';
});

const pageTitle = computed(() => {
  const map: Record<string, string> = {
    dashboard: '仪表盘',
    projects: '项目管理',
    'project-detail': '项目详情',
    channels: '渠道管理',
    templates: '邮件模板',
    'template-edit': '编辑模板',
    'push-templates': '推送模板',
    events: '事件目录',
    messages: '发送记录',
    'device-push': '设备推送',
    suppress: '抑制名单',
    schedules: '定时发送',
    queue: '发送队列',
    activity: '操作日志',
    partners: '合作站',
    settings: '系统设置',
  };
  return map[String(route.name)] || '消息推送平台';
});

const avatarText = computed(() => (auth.user?.username || 'A').slice(0, 1).toUpperCase());

function onMenu(key: string) {
  const pathMap: Record<string, string> = {
    dashboard: '/dashboard',
    projects: '/projects',
    channels: '/channels',
    templates: '/templates',
    'push-templates': '/push-templates',
    events: '/events',
    messages: '/messages',
    'device-push': '/device-push',
    suppress: '/suppress',
    schedules: '/schedules',
    queue: '/queue',
    activity: '/activity',
    partners: '/partners',
    settings: '/settings',
  };
  router.push(pathMap[key] || '/dashboard');
  mobileOpen.value = false;
}

function toggleSider() {
  if (isMobile.value) mobileOpen.value = !mobileOpen.value;
  else collapsed.value = !collapsed.value;
}

function goSettings() {
  router.push('/settings');
}

function goMessages() {
  router.push('/messages');
}

function logout() {
  notify.stop();
  auth.logout();
  router.push(getAdminPath());
}

function onPopoverShow(show: boolean) {
  if (show) void notify.bootstrap().catch(() => message.error('通知刷新失败，请稍后重试'));
}

function clampText(s: string, n = 120) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

async function openNotify(item: NotifyItem) {
  try { await notify.markRead(item.id); }
  catch { message.warning('已读状态未同步，请稍后重试'); }
  router.push({ path: '/messages', query: { open: item.id } });
}

async function markVisibleRead() {
  try { await notify.markAllRead(); }
  catch { message.error('已读状态未同步，请稍后重试'); }
}

function onResize() {
  windowWidth.value = window.innerWidth;
  if (!isMobile.value) mobileOpen.value = false;
}

watch(
  () => notify.freshQueue.length,
  (len, prev) => {
    if (!len || len === prev) return;
    const fresh = notify.consumeFresh();
    for (const item of fresh.slice(0, 3)) {
      const type =
        item.status === 'FAILED'
          ? 'error'
          : item.status === 'SUCCESS'
            ? 'success'
            : 'info';
      ntf[type as 'error' | 'success' | 'info']({
        title:
          item.status === 'FAILED'
            ? '发送失败'
            : item.status === 'SUCCESS'
              ? '发送成功'
              : '新消息',
        content: clampText(
          `${item.project?.name || '系统'} · ${item.title || '（无标题）'}${
            item.status === 'FAILED' && (item as any).errorMessage
              ? ' — ' + (item as any).errorMessage
              : ''
          }`,
          120,
        ),
        duration: 5000,
        keepAliveOnHover: true,
        meta: formatTime(item.createdAt),
        action: () => h(NButton, { text: true, type: 'primary', onClick: () => openNotify(item) }, { default: () => '查看详情' }),
      });
    }
    if (fresh.length > 3) {
      ntf.info({
        title: '更多通知',
        content: `还有 ${fresh.length - 3} 条新消息，请查看通知中心`,
        duration: 4000,
      });
    }
  },
);

onMounted(() => {
  window.addEventListener('resize', onResize);
  notify.start();
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  notify.stop();
});
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
}

.admin-sider {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--sidebar-width);
  z-index: 50;
  display: flex;
  flex-direction: column;
  background:
    #ffffff;
  border-right: 1px solid var(--app-border);
  box-shadow: 8px 0 30px rgba(15, 23, 42, 0.03);
  transition: width 0.2s ease, transform 0.22s ease;
  overflow: hidden;
}

.admin-sider.collapsed {
  width: var(--sidebar-collapsed);
}

.admin-sider.mobile {
  width: min(280px, 86vw);
  transform: translateX(-105%);
  box-shadow: none;
}

.admin-sider.mobile.open {
  transform: translateX(0);
  box-shadow: 12px 0 40px rgba(15, 23, 42, 0.14);
}

.sider-mask {
  position: fixed;
  inset: 0;
  z-index: 45;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(2px);
}

.brand {
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--app-border);
  position: relative;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: #2563eb;
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.28);
}

.brand-title {
  font-size: 15px;
  font-weight: 750;
  color: #0f172a;
  line-height: 1.1;
}

.brand-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mobile-close {
  margin-left: auto;
}

.sider-footer {
  margin-top: auto;
  padding: 16px;
}

.footer-chip {
  font-size: 12px;
  color: #64748b;
  background: #f1f5f9;
  border-radius: 999px;
  padding: 8px 12px;
  text-align: center;
}

.live-on {
  color: #059669;
  font-weight: 600;
}

.live-off {
  color: #94a3b8;
}

.admin-main {
  margin-left: var(--sidebar-width);
  min-height: 100vh;
  transition: margin-left 0.2s ease;
  display: flex;
  flex-direction: column;
}

.admin-main.collapsed {
  margin-left: var(--sidebar-collapsed);
}

.admin-main.mobile-main {
  margin-left: 0;
}

.admin-header {
  position: sticky;
  top: 0;
  z-index: 30;
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid var(--app-border);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.header-title {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-crumb {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: 1px solid var(--app-border);
  border-radius: 12px;
  background: #fff;
  color: #475569;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.icon-btn:hover {
  border-color: rgba(37, 99, 235, 0.25);
  color: #2563eb;
  background: #eff6ff;
}

.notify-btn {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  color: #1d4ed8;
  background: #ffffff;
  border-color: rgba(37, 99, 235, 0.2);
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.12);
}

.notify-btn:hover {
  color: #1e40af;
  background: #dbeafe;
  border-color: rgba(37, 99, 235, 0.35);
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.18);
}

.notify-btn :deep(.n-badge) {
  display: flex;
  line-height: 1;
}

.notify-btn :deep(.n-badge-sup) {
  font-size: 11px;
  height: 18px;
  min-width: 18px;
  padding: 0 5px;
  box-shadow: 0 0 0 2px #fff;
}

.user-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--app-border);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  background: #1d4ed8;
}

.user-name {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
  line-height: 1.1;
}

.user-role {
  font-size: 11px;
  color: #94a3b8;
}

.admin-content {
  flex: 1;
  padding: 24px 20px 40px;
  width: 100%;
}

.content-inner {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  min-width: 0;
}

/* notify-panel styles are global in styles.css (popover teleport) */

@media (max-width: 900px) {
  .user-meta {
    display: none;
  }
  .user-pill {
    padding: 4px;
  }
  .hide-sm {
    display: none;
  }
  .admin-content {
    padding: 16px 12px 32px;
  }
  .header-crumb {
    display: none;
  }
  .admin-header {
    padding: 0 10px;
    gap: 8px;
  }
  .header-right {
    max-width: 70%;
    gap: 4px;
  }
  .header-title {
    font-size: 15px;
  }
  .icon-btn {
    width: 38px;
    height: 38px;
  }
  .notify-btn {
    width: 44px;
    height: 44px;
  }
  .header-right {
    max-width: none;
  }
}

@media (max-width: 480px) {
  .user-pill {
    display: none;
  }
  .admin-content {
    padding: 12px 10px 28px;
  }
  .content-inner {
    max-width: 100%;
  }
  .notify-btn {
    width: 42px;
    height: 42px;
  }
}
</style>
