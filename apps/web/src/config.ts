/** 运行时 / 构建时读取的前端配置 */

export type AppRuntimeConfig = {
  env?: string;
  adminPath?: string;
  siteUrl?: string;
  apiBase?: string;
};

declare global {
  interface Window {
    __APP_CONFIG__?: AppRuntimeConfig;
  }
}

function normalizePath(raw?: string | null, fallback = '/admin'): string {
  let p = String(raw || '').trim();
  if (!p) return fallback;
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  return p || fallback;
}

function runtime(): AppRuntimeConfig {
  return (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};
}

/** development | production */
export function getAppEnv(): 'development' | 'production' {
  const fromRuntime = String(runtime().env || '').toLowerCase();
  if (fromRuntime === 'production' || fromRuntime === 'prod') return 'production';
  if (fromRuntime === 'development' || fromRuntime === 'dev') return 'development';
  const fromVite = String(import.meta.env?.MODE || '').toLowerCase();
  if (fromVite === 'production') return 'production';
  return 'development';
}

/**
 * 后台管理入口路径。
 * 优先级：运行时 config.js → 构建期 VITE_ADMIN_PATH → 默认 /admin
 */
export function getAdminPath(): string {
  const fromRuntime = runtime().adminPath;
  const fromEnv = import.meta.env?.VITE_ADMIN_PATH;
  return normalizePath(fromRuntime || fromEnv || '/admin');
}

export function isAdminEntryPath(pathname: string): boolean {
  const admin = getAdminPath();
  return pathname === admin || pathname.startsWith(`${admin}/`);
}

/** 站点对外根地址；空则使用当前浏览器 origin */
export function getSiteUrl(): string {
  const fromRuntime = String(runtime().siteUrl || '').trim().replace(/\/+$/, '');
  if (fromRuntime) return fromRuntime;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

/** API 基路径，默认同源 /api */
export function getApiBase(): string {
  const fromRuntime = String(runtime().apiBase || '').trim();
  if (fromRuntime) return fromRuntime;
  return String(import.meta.env?.VITE_API_BASE || '/api');
}
