<template>
  <n-icon :size="size" :color="color" class="app-icon">
    <component :is="comp" />
  </n-icon>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NIcon } from 'naive-ui';
import { Icons, type IconName } from '@/utils/icons';

const props = withDefaults(
  defineProps<{
    name: IconName;
    size?: number | string;
    color?: string;
  }>(),
  { size: 18 },
);

const comp = computed(() => Icons[props.name]);
</script>

<style scoped>
.app-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
}
</style>
