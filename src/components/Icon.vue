<script setup lang="ts">
// 统一图标组件:封装 Solar 图标(Iconify),符合项目规范(禁 emoji)
// 用法: <Icon name="solar:home-bold-duotone" />
import { Icon as IconifyIcon } from "@iconify/vue";
import type { HTMLAttributes } from "vue";

defineProps<{ name: string; class?: HTMLAttributes["class"] }>();
</script>

<template>
  <IconifyIcon :icon="name" :class="$props.class" />
</template>
