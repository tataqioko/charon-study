<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "@/components/Icon.vue";
import { getCourse, getCardStats, type Course } from "@/lib/db";
import Database from "@tauri-apps/plugin-sql";

const route = useRoute();
const router = useRouter();

const courseId = computed(() => Number(route.params.id));
const course = ref<Course | null>(null);
const stats = ref({ new: 0, learning: 0, review: 0, total: 0 });
const heatmapData = ref<{ date: string; count: number }[]>([]);
const reviewHistory = ref<{ date: string; count: number }[]>([]);

onMounted(async () => {
  course.value = await getCourse(courseId.value);
  stats.value = await getCardStats(courseId.value);
  await loadHeatmap();
  await loadHistory();
});

async function loadHeatmap() {
  const db = await Database.load("sqlite:charon.db");
  const rows = await db.select<{ date: string; count: number }[]>(
    `SELECT DATE(review_time) as date, COUNT(*) as count
     FROM reviews
     WHERE card_id IN (SELECT id FROM cards WHERE step_id IN (SELECT id FROM steps WHERE course_id = $1))
     AND review_time >= DATE('now', '-90 days')
     GROUP BY DATE(review_time)
     ORDER BY date`,
    [courseId.value]
  );
  heatmapData.value = rows;
}

async function loadHistory() {
  const db = await Database.load("sqlite:charon.db");
  const rows = await db.select<{ date: string; count: number }[]>(
    `SELECT DATE(review_time) as date, COUNT(*) as count
     FROM reviews
     WHERE card_id IN (SELECT id FROM cards WHERE step_id IN (SELECT id FROM steps WHERE course_id = $1))
     GROUP BY DATE(review_time)
     ORDER BY date DESC
     LIMIT 30`,
    [courseId.value]
  );
  reviewHistory.value = rows.reverse();
}

const maxCount = computed(() => Math.max(...heatmapData.value.map((d) => d.count), 1));

function getHeatColor(count: number): string {
  if (count === 0) return "bg-muted";
  const intensity = count / maxCount.value;
  if (intensity < 0.25) return "bg-green-200";
  if (intensity < 0.5) return "bg-green-400";
  if (intensity < 0.75) return "bg-green-600";
  return "bg-green-800";
}

const last90Days = computed(() => {
  const days = [];
  const today = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const data = heatmapData.value.find((h) => h.date === dateStr);
    days.push({ date: dateStr, count: data?.count ?? 0 });
  }
  return days;
});
</script>

<template>
  <div class="max-w-4xl mx-auto px-8 py-8">
    <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3" @click="router.push(`/app/review/${courseId}`)">
      <Icon name="solar:alt-arrow-left-linear" class="size-3.5" /> 返回复习
    </button>

    <div class="mb-6">
      <h1 class="text-2xl font-bold tracking-tight">复习统计</h1>
      <p class="text-sm text-muted-foreground mt-1">{{ course?.topic }}</p>
    </div>

    <!-- 卡片状态分布 -->
    <div class="rounded-xl border bg-card p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
        <Icon name="solar:pie-chart-2-bold-duotone" class="size-5 text-primary" /> 卡片状态分布
      </h2>
      <div class="grid grid-cols-4 gap-4">
        <div class="text-center">
          <div class="text-3xl font-bold text-blue-600 mb-1">{{ stats.new }}</div>
          <div class="text-sm text-muted-foreground">新卡片</div>
          <div class="text-xs text-muted-foreground mt-1">{{ stats.total ? Math.round(stats.new / stats.total * 100) : 0 }}%</div>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-orange-600 mb-1">{{ stats.learning }}</div>
          <div class="text-sm text-muted-foreground">学习中</div>
          <div class="text-xs text-muted-foreground mt-1">{{ stats.total ? Math.round(stats.learning / stats.total * 100) : 0 }}%</div>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-green-600 mb-1">{{ stats.review }}</div>
          <div class="text-sm text-muted-foreground">复习中</div>
          <div class="text-xs text-muted-foreground mt-1">{{ stats.total ? Math.round(stats.review / stats.total * 100) : 0 }}%</div>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-primary mb-1">{{ stats.total }}</div>
          <div class="text-sm text-muted-foreground">总计</div>
          <div class="text-xs text-muted-foreground mt-1">100%</div>
        </div>
      </div>
    </div>

    <!-- 复习热力图 -->
    <div class="rounded-xl border bg-card p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
        <Icon name="solar:calendar-mark-bold-duotone" class="size-5 text-primary" /> 复习热力图（近 90 天）
      </h2>
      <div v-if="!heatmapData.length" class="text-center text-sm text-muted-foreground py-8">
        还没有复习记录
      </div>
      <div v-else class="grid grid-cols-15 gap-1">
        <div
          v-for="day in last90Days" :key="day.date"
          :title="`${day.date}: ${day.count} 次复习`"
          class="size-3 rounded-sm transition-colors cursor-help"
          :class="getHeatColor(day.count)"
        />
      </div>
      <div class="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
        <span>少</span>
        <div class="size-3 rounded-sm bg-muted" />
        <div class="size-3 rounded-sm bg-green-200" />
        <div class="size-3 rounded-sm bg-green-400" />
        <div class="size-3 rounded-sm bg-green-600" />
        <div class="size-3 rounded-sm bg-green-800" />
        <span>多</span>
      </div>
    </div>

    <!-- 复习历史趋势 -->
    <div class="rounded-xl border bg-card p-6">
      <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
        <Icon name="solar:chart-2-bold-duotone" class="size-5 text-primary" /> 复习趋势（近 30 天）
      </h2>
      <div v-if="!reviewHistory.length" class="text-center text-sm text-muted-foreground py-8">
        还没有复习记录
      </div>
      <div v-else class="space-y-2">
        <div v-for="item in reviewHistory" :key="item.date" class="flex items-center gap-3">
          <span class="text-xs text-muted-foreground w-20 shrink-0">{{ item.date.slice(5) }}</span>
          <div class="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
            <div class="h-full bg-primary transition-all" :style="{ width: (item.count / Math.max(...reviewHistory.map(h => h.count)) * 100) + '%' }" />
          </div>
          <span class="text-sm font-medium w-8 text-right">{{ item.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
