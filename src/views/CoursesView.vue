<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { motion } from "motion-v";
import Icon from "@/components/Icon.vue";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import NewCourseDialog from "@/components/NewCourseDialog.vue";
import { listCourses, deleteCourse, type Course } from "@/lib/db";

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

async function remove(c: Course, e: Event) {
  e.stopPropagation();
  await deleteCourse(c.id);
  toast.info(`已删除《${c.topic}》`);
  load();
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-8 py-8">
    <motion.div
      :initial="{ opacity: 0, y: 12 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4 }"
      class="flex items-center justify-between"
    >
      <div>
        <h1 class="text-2xl font-bold tracking-tight">我的课程</h1>
        <p class="text-sm text-muted-foreground mt-1">{{ courses.length }} 个课程</p>
      </div>
      <NewCourseDialog @created="load" />
    </motion.div>

    <div v-if="loading" class="py-24 text-center text-muted-foreground">
      <Icon name="solar:refresh-bold" class="size-6 animate-spin mx-auto" />
    </div>

    <div v-else-if="!courses.length" class="py-24 flex flex-col items-center gap-3 text-center text-muted-foreground">
      <Icon name="solar:book-bold-duotone" class="size-14 text-primary/40" />
      <p class="text-sm">还没有课程,点右上角「新建课程」开始</p>
    </div>

    <div v-else class="grid grid-cols-2 gap-4 mt-6">
      <motion.div
        v-for="(c, i) in courses" :key="c.id"
        :initial="{ opacity: 0, y: 16 }" :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.4, delay: 0.05 + i * 0.06 }" :while-hover="{ y: -4 }"
      >
        <Card class="cursor-pointer transition-shadow hover:shadow-lg group" @click="router.push(`/app/study/${c.id}`)">
          <CardHeader>
            <div class="flex items-center justify-between">
              <Badge :variant="c.mode === 'sprint' ? 'default' : 'secondary'">{{ modeLabel[c.mode] ?? c.mode }}</Badge>
              <button class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive" @click="remove(c, $event)">
                <Icon name="solar:trash-bin-trash-linear" class="size-4" />
              </button>
            </div>
            <CardTitle class="mt-2">{{ c.topic }}</CardTitle>
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
