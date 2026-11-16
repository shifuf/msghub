import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '@/api';

const TOKEN_KEY = 'msg_admin_token';

export type AdminUser = {
  id: string;
  username: string;
  totpEnabled?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
};

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '');
  const user = ref<AdminUser | null>(null);

  const isLoggedIn = computed(() => !!token.value);

  function setToken(t: string) {
    if (!t) {
      token.value = '';
      localStorage.removeItem(TOKEN_KEY);
      return;
    }
    token.value = t;
    localStorage.setItem(TOKEN_KEY, t);
  }

  async function login(username: string, password: string, code?: string) {
    const res = await authApi.login(username, password, code);
    if (!res?.accessToken) {
      throw new Error('登录响应缺少 accessToken');
    }
    setToken(res.accessToken);
    user.value = res.user || null;
    return res;
  }

  async function fetchMe() {
    if (!token.value) return null;
    const res = await authApi.me();
    user.value = res;
    return res;
  }

  function logout() {
    token.value = '';
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  return { token, user, isLoggedIn, login, fetchMe, logout, setToken };
});
