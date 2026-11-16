<template>
  <iframe :srcdoc="document" sandbox="" referrerpolicy="no-referrer" title="隔离 HTML 预览" class="w-full min-h-[320px] border-0 bg-white" />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { safePreviewDocument } from '@/utils/preview';
const props = defineProps<{ html: string }>();
const document = computed(() => safePreviewDocument(props.html));
</script>
