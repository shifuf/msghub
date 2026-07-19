<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-50 p-4">
    <div class="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
      <div class="text-xl font-semibold text-slate-800 mb-2">取消邮件通知</div>
      <div v-if="loading" class="text-slate-500 text-sm">校验链接中…</div>
      <div v-else-if="done" class="text-emerald-600 text-sm leading-6">
        已为 <strong>{{ emailMasked }}</strong> 取消后续回复邮件通知。
      </div>
      <div v-else-if="error" class="text-rose-500 text-sm">{{ error }}</div>
      <template v-else>
        <p class="text-slate-600 text-sm leading-6 mb-6">
          确认取消邮箱 <strong>{{ emailMasked }}</strong> 的后续邮件通知？
        </p>
        <n-button type="primary" block :loading="submitting" @click="confirm">
          确认取消通知
        </n-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { NButton } from 'naive-ui';
import { publicApi } from '@/api';

const route = useRoute();
const loading = ref(true);
const submitting = ref(false);
const done = ref(false);
const error = ref('');
const emailMasked = ref('');
const token = ref('');

onMounted(async () => {
  token.value = String(route.query.token || '');
  if (!token.value) {
    error.value = '链接无效：缺少 token';
    loading.value = false;
    return;
  }
  try {
    const data = await publicApi.unsubscribePreview(token.value);
    emailMasked.value = data.emailMasked;
  } catch (e: any) {
    error.value = e?.message || '链接无效或已过期';
  } finally {
    loading.value = false;
  }
});

async function confirm() {
  submitting.value = true;
  try {
    const data = await publicApi.unsubscribe(token.value);
    emailMasked.value = data.emailMasked || emailMasked.value;
    done.value = true;
  } catch (e: any) {
    error.value = e?.message || '取消失败';
  } finally {
    submitting.value = false;
  }
}
</script>
