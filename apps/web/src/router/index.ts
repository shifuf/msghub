import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { getAdminPath } from '@/config';

/** 后台管理入口路径（可由环境变量 / 运行时 config 配置） */
export const ADMIN_ENTRY = getAdminPath();

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'portal',
      component: () => import('@/views/PortalView.vue'),
      meta: { public: true },
    },
    {
      path: ADMIN_ENTRY,
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, adminEntry: true },
    },
    // 公开路径 /login 统一回门户，不暴露管理入口
    { path: '/login', redirect: '/' },
    {
      path: '/app',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: '/dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
        },
        { path: '/projects', name: 'projects', component: () => import('@/views/ProjectsView.vue') },
        {
          path: '/projects/:id',
          name: 'project-detail',
          component: () => import('@/views/ProjectDetailView.vue'),
        },
        {
          path: '/channels',
          name: 'channels',
          component: () => import('@/views/ChannelsView.vue'),
        },
        {
          path: '/projects/:id/channels',
          redirect: (to) => `/projects/${to.params.id}`,
        },
        { path: '/templates', name: 'templates', component: () => import('@/views/TemplatesView.vue') },
        {
          path: '/templates/:id',
          name: 'template-edit',
          component: () => import('@/views/TemplateEditView.vue'),
        },
        {
          path: '/push-templates',
          name: 'push-templates',
          component: () => import('@/views/PushTemplatesView.vue'),
        },
        { path: '/messages', name: 'messages', component: () => import('@/views/MessagesView.vue') },
        {
          path: '/device-push',
          name: 'device-push',
          component: () => import('@/views/DevicePushHistoryView.vue'),
        },
        {
          path: '/suppress',
          name: 'suppress',
          component: () => import('@/views/SuppressView.vue'),
        },
        {
          path: '/schedules',
          name: 'schedules',
          component: () => import('@/views/SchedulesView.vue'),
        },
        {
          path: '/activity',
          name: 'activity',
          component: () => import('@/views/ActivityView.vue'),
        },
        {
          path: '/events',
          name: 'events',
          component: () => import('@/views/EventsView.vue'),
        },
        {
          path: '/partners',
          name: 'partners',
          component: () => import('@/views/PartnersView.vue'),
        },
        { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
      ],
    },
    {
      path: '/unsubscribe',
      name: 'unsubscribe',
      component: () => import('@/views/UnsubscribeView.vue'),
      meta: { public: true },
    },
    { path: '/home', redirect: '/' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  const isPublic = !!to.meta.public;

  // 已登录访问门户或管理入口 → 进入控制台
  if (isPublic && auth.isLoggedIn && (to.name === 'portal' || to.name === 'login')) {
    return { path: '/dashboard' };
  }

  if (isPublic) return true;

  if (!auth.isLoggedIn) {
    return { path: ADMIN_ENTRY, query: { redirect: to.fullPath } };
  }

  if (!auth.user) {
    try {
      await auth.fetchMe();
    } catch {
      auth.logout();
      return { path: ADMIN_ENTRY, query: { redirect: to.fullPath } };
    }
  }

  return true;
});

export default router;
