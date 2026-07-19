<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides">
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-notification-provider
          placement="top-right"
          :max="3"
          :container-style="notifyContainerStyle"
        >
          <n-message-provider>
            <router-view />
          </n-message-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import {
  NConfigProvider,
  NLoadingBarProvider,
  NDialogProvider,
  NNotificationProvider,
  NMessageProvider,
  zhCN,
  dateZhCN,
} from 'naive-ui';

const notifyContainerStyle = {
  width: 'min(380px, calc(100vw - 24px))',
  maxWidth: 'min(380px, calc(100vw - 24px))',
  zIndex: '5000',
  boxSizing: 'border-box',
};

const themeOverrides = {
  common: {
    primaryColor: '#2563eb',
    primaryColorHover: '#3b82f6',
    primaryColorPressed: '#1d4ed8',
    primaryColorSuppl: '#60a5fa',
    borderRadius: '12px',
    borderRadiusSmall: '10px',
    fontFamily:
      '"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    fontWeightStrong: '650',
  },
  Button: {
    borderRadiusMedium: '12px',
    borderRadiusLarge: '14px',
    heightMedium: '36px',
    heightLarge: '42px',
    fontWeight: '600',
  },
  Card: {
    borderRadius: '16px',
  },
  DataTable: {
    borderRadius: '14px',
    thColor: '#f8fafc',
    thTextColor: '#64748b',
    thFontWeight: '600',
  },
  Input: {
    borderRadius: '12px',
    heightMedium: '38px',
  },
  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '12px',
        heightMedium: '38px',
      },
    },
  },
  Tag: {
    borderRadius: '999px',
  },
  Menu: {
    itemHeight: '44px',
    borderRadius: '12px',
    itemTextColor: '#475569',
    itemIconColor: '#64748b',
    itemTextColorHover: '#1e293b',
    itemIconColorHover: '#2563eb',
    itemTextColorActive: '#1d4ed8',
    itemIconColorActive: '#1d4ed8',
    itemColorActive: 'transparent',
    itemColorActiveHover: 'transparent',
  },
  Dialog: {
    borderRadius: '18px',
  },
  Drawer: {
    borderRadius: '18px',
  },
  Notification: {
    width: 'min(380px, calc(100vw - 24px))',
  },
  Message: {
    maxWidth: 'min(420px, calc(100vw - 24px))',
  },
};
</script>
