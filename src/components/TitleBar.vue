<script setup lang="ts">
// 苹果风自定义标题栏:可拖拽 + 最小化/最大化/关闭 + 深色切换
import { getCurrentWindow } from "@tauri-apps/api/window";
import Icon from "@/components/Icon.vue";
import { useTheme } from "@/composables/useTheme";

const appWindow = getCurrentWindow();
const { mode, toggle } = useTheme();
</script>

<template>
  <div
    data-tauri-drag-region
    class="h-9 shrink-0 flex items-center justify-between pl-4 pr-2 border-b bg-background/80 backdrop-blur select-none"
  >
    <div data-tauri-drag-region class="flex items-center gap-2 text-xs text-muted-foreground pointer-events-none">
      <div class="size-4 rounded bg-primary text-primary-foreground grid place-items-center text-[10px] font-bold">C</div>
      Charon-Study
    </div>
    <div class="flex items-center gap-0.5">
      <button
        class="size-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        @click="toggle"
        :title="mode === 'dark' ? '切换浅色' : '切换深色'"
      >
        <Icon :name="mode === 'dark' ? 'solar:sun-bold-duotone' : 'solar:moon-bold-duotone'" class="size-4" />
      </button>
      <button
        class="size-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        @click="appWindow.minimize()"
        title="最小化"
      >
        <Icon name="solar:minimize-square-minimalistic-linear" class="size-4" />
      </button>
      <button
        class="size-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        @click="appWindow.toggleMaximize()"
        title="最大化"
      >
        <Icon name="solar:maximize-square-minimalistic-linear" class="size-4" />
      </button>
      <button
        class="size-7 grid place-items-center rounded-md hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors"
        @click="appWindow.close()"
        title="关闭"
      >
        <Icon name="solar:close-square-linear" class="size-4" />
      </button>
    </div>
  </div>
</template>
