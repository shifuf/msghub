import axios from 'axios';
import { useAuthStore } from '@/stores/auth';
import { getAdminPath, getApiBase, isAdminEntryPath } from '@/config';

const raw = axios.create({
  baseURL: getApiBase(),
  timeout: 30000,
});

raw.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

raw.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && typeof body === 'object' && 'success' in body) {
      if (body.success === false) {
        return Promise.reject(new Error(body.error?.message || '请求失败'));
      }
      // 统一解包 { success, data }，调用方直接拿到 data
      return body.data;
    }
    return body;
  },
  (err) => {
    const status = err.response?.status;
    const msg =
      err.response?.data?.error?.message ||
      err.response?.data?.message ||
      err.message ||
      '网络错误';
    if (status === 401) {
      const auth = useAuthStore();
      // 已在管理入口时不跳转，避免登录请求 401 造成重定向循环
      if (!isAdminEntryPath(location.pathname)) {
        auth.logout();
        location.href = getAdminPath();
      }
    }
    const e = new Error(typeof msg === 'string' ? msg : '请求失败') as Error & {
      status?: number;
      response?: any;
    };
    e.status = status;
    e.response = err.response;
    return Promise.reject(e);
  },
);

// 拦截器已解包，导出类型按「直接返回 data」声明
const http = raw as unknown as {
  get<T = any>(url: string, config?: any): Promise<T>;
  post<T = any>(url: string, data?: any, config?: any): Promise<T>;
  put<T = any>(url: string, data?: any, config?: any): Promise<T>;
  patch<T = any>(url: string, data?: any, config?: any): Promise<T>;
  delete<T = any>(url: string, config?: any): Promise<T>;
};

export default http;
