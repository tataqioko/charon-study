<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { motion } from "motion-v";
import Icon from "@/components/Icon.vue";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listCourses, type Course } from "@/lib/db";

const router = useRouter();
const courses = ref<Course[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    courses.value = await listCourses();
  } catch (e) {
    toast.error(`加载课程失败:${String(e)}`);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const modeLabel: Record<string, string> = { sprint: "冲刺", daily: "常规", leisure: "休闲" };
</script>

<template>
  <div class="max-w-4xl mx-auto px-8 py-8">
    <motion.div
      :initial="{ opacity: 0, y: 12 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4 }"
      class="flex items-center justify-between mb-6"
    >
      <div>
        <h1 class="text-2xl font-bold tracking-tight">复习系统</h1>
        <p class="text-sm text-muted-foreground mt-1">基于 FSRS 算法的间隔复习</p>
      </div>
    </motion.div>

    <div v-if="loading" class="py-24 text-center text-muted-foreground">
      <Icon name="solar:refresh-bold" class="size-6 animate-spin mx-auto" />
    </div>

    <div v-else-if="!courses.length" class="py-24 flex flex-col items-center gap-3 text-center text-muted-foreground">
      <Icon name="solar:refresh-circle-bold-duotone" class="size-14 text-primary/40" />
      <p class="text-sm">还没有课程,先创建课程后才能复习哦</p>
    </div>

    <div v-else class="grid grid-cols-2 gap-4">
      <motion.div
        v-for="(c, i) in courses" :key="c.id"
        :initial="{ opacity: 0, y: 16 }" :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.4, delay: 0.05 + i * 0.06 }" :while-hover="{ y: -4 }"
      >
        <Card class="cursor-pointer transition-shadow hover:shadow-lg" @click="router.push(`/app/review/${c.id}`)">
          <CardHeader>
            <div class="flex items-center justify-between mb-2">
              <Badge :variant="c.mode === 'sprint' ? 'default' : 'secondary'">{{ modeLabel[c.mode] ?? c.mode }}</Badge>
            </div>
            <CardTitle class="text-base">{{ c.topic }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex justify-between text-xs text-muted-foreground">
              <span>{{ c.total_days }} 天计划</span>
              <span>{{ c.daily_time }}/天</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  </div>
</template>
