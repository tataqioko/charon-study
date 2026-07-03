<script setup lang="ts">
import { RouterView } from "vue-router";
import TitleBar from "@/components/TitleBar.vue";
import { Toaster } from "@/components/ui/sonner";
</script>

<template>
  <div class="flex flex-col h-screen overflow-hidden">
    <TitleBar />
    <div class="flex-1 overflow-hidden">
      <RouterView />
    </div>
    <Toaster position="top-center" :duration="2500" richColors />
  </div>
</template>
