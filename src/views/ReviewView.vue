<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings";
import {
  getCourse, listSteps, getDueCards, getCardByStep, createCard, updateCard, createReviewLog, getCardStats,
  type Course, type Card,
} from "@/lib/db";
import { schedule, createNewCard, type Rating } from "@/lib/fsrs";

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();

const courseId = computed(() => Number(route.params.id));
const course = ref<Course | null>(null);
const dueCards = ref<Card[]>([]);
const currentCard = ref<Card | null>(null);
const currentStepTitle = ref("");
const reviewed = ref(0);
const stats = ref({ new: 0, learning: 0, review: 0, total: 0 });

const ratingLabels: Record<Rating, { label: string; icon: string; color: string }> = {
  1: { label: "忘了", icon: "solar:close-circle-bold", color: "text-red-600" },
  2: { label: "困难", icon: "solar:danger-bold", color: "text-orange-600" },
  3: { label: "良好", icon: "solar:check-circle-bold", color: "text-green-600" },
  4: { label: "简单", icon: "solar:star-bold", color: "text-blue-600" },
};

onMounted(async () => {
  await settings.init();
  await load();
});

async function load() {
  course.value = await getCourse(courseId.value);
  const now = new Date().toISOString();
  dueCards.value = await getDueCards(courseId.value, now);
  stats.value = await getCardStats(courseId.value);

  // 如果没有卡片，为所有已完成的 step 创建卡片
  if (dueCards.value.length === 0) {
    const steps = await listSteps(courseId.value);
    const completed = steps.filter((s) => s.status === "completed");
    for (const step of completed) {
      const existing = await getCardByStep(step.id);
      if (!existing) {
        const newCard = createNewCard(step.id);
        await createCard(newCard);
      }
    }
    dueCards.value = await getDueCards(courseId.value, now);
    stats.value = await getCardStats(courseId.value);
  }

  nextCard();
}

async function nextCard() {
  if (dueCards.value.length === 0) {
    currentCard.value = null;
    return;
  }
  const card = dueCards.value[0];
  currentCard.value = card;
  const steps = await listSteps(courseId.value);
  const step = steps.find((s) => s.id === card.step_id);
  currentStepTitle.value = step?.title ?? "";
}

async function rate(rating: Rating) {
  if (!currentCard.value) return;
  const now = new Date();
  const result = schedule(currentCard.value, now, rating);

  await updateCard(result.card);
  await createReviewLog(result.review_log);

  dueCards.value.shift();
  reviewed.value++;
  stats.value = await getCardStats(courseId.value);
  nextCard();

  toast.success(`已复习,下次复习: ${result.card.scheduled_days} 天后`);
}

function goToStep() {
  if (currentCard.value) {
    router.push(`/app/study/${courseId.value}?step=${currentCard.value.step_id}`);
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-8 py-8 h-full flex flex-col">
    <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3" @click="router.push(`/app/courses`)">
      <Icon name="solar:alt-arrow-left-linear" class="size-3.5" /> 返回课程
    </button>

    <div class="mb-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">FSRS 复习</h1>
          <p class="text-sm text-muted-foreground mt-1">{{ course?.topic }}</p>
        </div>
        <Button variant="outline" size="sm" class="gap-1.5" @click="router.push(`/app/review/${courseId}/stats`)">
          <Icon name="solar:chart-2-bold-duotone" class="size-4" /> 查看统计
        </Button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-3 mb-6">
      <div class="rounded-lg border bg-card p-3 text-center">
        <div class="text-2xl font-bold text-blue-600">{{ stats.new }}</div>
        <div class="text-xs text-muted-foreground mt-1">新卡片</div>
      </div>
      <div class="rounded-lg border bg-card p-3 text-center">
        <div class="text-2xl font-bold text-orange-600">{{ stats.learning }}</div>
        <div class="text-xs text-muted-foreground mt-1">学习中</div>
      </div>
      <div class="rounded-lg border bg-card p-3 text-center">
        <div class="text-2xl font-bold text-green-600">{{ stats.review }}</div>
        <div class="text-xs text-muted-foreground mt-1">复习中</div>
      </div>
      <div class="rounded-lg border bg-card p-3 text-center">
        <div class="text-2xl font-bold text-primary">{{ reviewed }}</div>
        <div class="text-xs text-muted-foreground mt-1">已复习</div>
      </div>
    </div>

    <!-- 复习区域 -->
    <div v-if="currentCard" class="flex-1 flex flex-col">
      <div class="flex-1 rounded-xl border bg-card p-8 flex flex-col items-center justify-center text-center mb-6">
        <div class="mb-4">
          <span class="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
            {{ currentCard.state === "new" ? "新卡片" : currentCard.state === "learning" ? "学习中" : currentCard.state === "relearning" ? "重新学习" : "复习" }}
          </span>
        </div>
        <h2 class="text-3xl font-bold mb-2">{{ currentStepTitle }}</h2>
        <p class="text-muted-foreground text-sm mb-6">
          复习次数: {{ currentCard.reps }} · 遗忘次数: {{ currentCard.lapses }}
        </p>
        <Button variant="outline" size="sm" class="gap-1.5" @click="goToStep">
          <Icon name="solar:book-bold-duotone" class="size-4" /> 查看讲义
        </Button>
      </div>

      <!-- 评分按钮 -->
      <div class="grid grid-cols-4 gap-3">
        <Button
          v-for="(r, rating) in ratingLabels" :key="rating"
          size="lg"
          variant="outline"
          class="flex flex-col gap-2 h-auto py-4"
          @click="rate(Number(rating) as Rating)"
        >
          <Icon :name="r.icon" :class="['size-6', r.color]" />
          <span class="font-medium">{{ r.label }}</span>
        </Button>
      </div>
    </div>

    <!-- 完成状态 -->
    <div v-else class="flex-1 flex flex-col items-center justify-center text-center">
      <Icon name="solar:check-circle-bold-duotone" class="size-16 text-green-600 mb-4" />
      <h2 class="text-2xl font-bold mb-2">今日复习完成！</h2>
      <p class="text-muted-foreground mb-6">已复习 {{ reviewed }} 张卡片</p>
      <Button class="gap-1.5" @click="router.push(`/app/study/${courseId}`)">
        <Icon name="solar:book-bold-duotone" class="size-4" /> 继续学习
      </Button>
    </div>
  </div>
</template>
