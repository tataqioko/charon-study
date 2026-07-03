<script setup lang="ts">
import { useRouter } from "vue-router";
import { motion } from "motion-v";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { Button } from "@/components/ui/button";
import Icon from "@/components/Icon.vue";

const router = useRouter();
</script>

<template>
  <AuroraBackground class="!h-full" :radial-gradient="false">
    <motion.div
      :initial="{ opacity: 0, y: 24 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.7, ease: 'easeOut' }"
      class="relative z-10 flex flex-col items-center gap-6 px-6 text-center"
    >
      <div class="flex items-center gap-3">
        <div class="size-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center text-2xl font-bold shadow-lg shadow-primary/30">
          C
        </div>
      </div>

      <TextGenerateEffect
        words="Charon-Study 你的 AI 学习摆渡人"
        class="text-4xl md:text-5xl font-bold tracking-tight"
      />

      <p class="max-w-md text-muted-foreground text-base leading-relaxed">
        上传材料或输入主题,AI 为你生成个性化学习计划、每日讲义与测验,
        陪你从「不会」渡到「会」。
      </p>

      <div class="flex items-center gap-3 mt-2">
        <Button size="lg" class="gap-2" @click="router.push('/showcase')">
          <Icon name="solar:rocket-2-bold-duotone" class="size-5" />
          开始使用
        </Button>
        <Button size="lg" variant="outline" class="gap-2">
          <Icon name="solar:key-minimalistic-bold-duotone" class="size-5" />
          如何获取 Key
        </Button>
      </div>

      <div class="flex items-center gap-6 mt-6 text-xs text-muted-foreground">
        <span class="flex items-center gap-1.5"><Icon name="solar:documents-bold-duotone" class="size-4 text-primary" /> 材料生成课程</span>
        <span class="flex items-center gap-1.5"><Icon name="solar:calendar-bold-duotone" class="size-4 text-primary" /> 自定义节奏</span>
        <span class="flex items-center gap-1.5"><Icon name="solar:refresh-circle-bold-duotone" class="size-4 text-primary" /> 智能复习</span>
      </div>
    </motion.div>
  </AuroraBackground>
</template>
