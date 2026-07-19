<template>
  <div class="login-page">
    <div class="login-bg"></div>
    <div class="login-card">
      <div class="text-center mb-8">
        <div class="login-logo">
          <AppIcon name="send" :size="28" color="#fff" />
        </div>
        <h1 class="text-2xl font-bold text-slate-900 tracking-tight">消息推送平台</h1>
        <p class="text-slate-500 mt-2 text-sm">个人消息推送中台 · 多渠道 · 实时通知</p>
      </div>
      <n-form @submit.prevent="onSubmit">
        <n-form-item label="用户名">
          <n-input v-model:value="username" placeholder="admin" size="large" autocomplete="username" @keyup.enter="onSubmit" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            size="large"
            autocomplete="current-password"
            @keyup.enter="onSubmit"
          />
        </n-form-item>
        <n-button type="primary" block size="large" :loading="loading" attr-type="submit" @click="onSubmit">
          登录
        </n-button>
      </n-form>
      <div class="mt-5 text-center text-xs text-slate-400">
        私有管理入口
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { NForm, NFormItem, NInput, NButton, useMessage } from 'naive-ui';
import { useAuthStore } from '@/stores/auth';
import AppIcon from '@/components/AppIcon.vue';
import { getAdminPath } from '@/config';

const username = ref('admin');
const password = ref('');
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const message = useMessage();

async function onSubmit() {
  if (loading.value) return;
  if (!username.value || !password.value) {
    message.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    message.success('登录成功');
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    // 禁止回跳到门户或管理入口本身
    const blocked = new Set(['/', '/login', getAdminPath()]);
    const safe = redirect && !blocked.has(redirect) ? redirect : '/dashboard';
    await router.replace(safe);
  } catch (e: any) {
    message.error(e?.message || '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  position: relative;
  overflow: hidden;
}

.login-bg {
  position: absolute;
  inset: 0;
  background: #0f172a;
}


.login-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 24px;
  padding: 36px 32px 28px;
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.28),
    0 2px 0 rgba(255, 255, 255, 0.4) inset;
  backdrop-filter: blur(18px);
}

.login-logo {
  width: 58px;
  height: 58px;
  margin: 0 auto 14px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 24px;
  font-weight: 800;
  background: #2563eb;
  box-shadow: 0 14px 28px rgba(37, 99, 235, 0.35);
}
</style>
