<script setup lang="ts">
import { RouterView, RouterLink } from "vue-router";
import Icon from "@/components/Icon.vue";

const nav = [
  { to: "/app/courses", label: "我的课程", icon: "solar:book-2-bold-duotone" },
  { to: "/app/reviews", label: "复习系统", icon: "solar:refresh-circle-bold-duotone" },
  { to: "/app/wrong-answers", label: "错题本", icon: "solar:document-text-bold-duotone" },
  { to: "/app/playground", label: "对话调试台", icon: "solar:chat-round-dots-bold-duotone" },
  { to: "/app/settings", label: "设置", icon: "solar:settings-bold-duotone" },
];
</script>

<template>
  <div class="flex h-full">
    <aside class="w-56 shrink-0 border-r bg-muted/30 flex flex-col">
      <div class="p-2 flex flex-col gap-1 mt-2">
        <RouterLink
          v-for="item in nav" :key="item.to" :to="item.to"
          class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          active-class="!bg-accent !text-foreground font-medium"
        >
          <Icon :name="item.icon" class="size-4" />
          {{ item.label }}
        </RouterLink>
      </div>
    </aside>
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>
