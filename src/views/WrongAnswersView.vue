<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { getCourse, getWrongAnswers, type Course } from "@/lib/db";
import type { QuizQuestion } from "@/lib/prompts";

const route = useRoute();
const router = useRouter();

const courseId = Number(route.params.id);
const course = ref<Course | null>(null);
const wrongAnswers = ref<Array<{ question: QuizQuestion; userAnswer: string; stepId: number }>>([]);

onMounted(async () => {
  course.value = await getCourse(courseId);
  const records = await getWrongAnswers(courseId);
  wrongAnswers.value = records.map((r) => {
    const payload = JSON.parse(r.questions_json);
    return {
      question: payload.questions[r.question_index],
      userAnswer: r.user_answer,
      stepId: r.step_id,
    };
  });
});

const kindLabel: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", judgment: "判断",
  fill_blanks: "填空", free_response: "主观题",
};
</script>

<template>
  <div class="max-w-3xl mx-auto px-8 py-8">
    <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3" @click="router.push(`/app/courses`)">
      <Icon name="solar:alt-arrow-left-linear" class="size-3.5" /> 返回课程
    </button>

    <div class="mb-6">
      <h1 class="text-2xl font-bold tracking-tight">错题本</h1>
      <p class="text-sm text-muted-foreground mt-1">{{ course?.topic }}</p>
    </div>

    <div v-if="!wrongAnswers.length" class="py-24 flex flex-col items-center gap-3 text-center text-muted-foreground">
      <Icon name="solar:check-circle-bold-duotone" class="size-14 text-green-600" />
      <p class="text-sm">还没有错题记录,继续加油!</p>
    </div>

    <div v-else class="space-y-4">
      <div v-for="(item, idx) in wrongAnswers" :key="idx" class="rounded-xl border bg-card p-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600">{{ kindLabel[item.question.kind] }}</span>
          <span class="text-xs text-muted-foreground">第 {{ idx + 1 }} 题</span>
        </div>
        <p class="font-medium mb-3 whitespace-pre-wrap">{{ item.question.stem }}</p>

        <!-- 你的答案 -->
        <div class="text-sm mb-2">
          <span class="text-muted-foreground">你的答案:</span>
          <span class="ml-2 text-destructive font-medium">{{ item.userAnswer }}</span>
        </div>

        <!-- 正确答案 -->
        <div class="text-sm mb-2">
          <span class="text-muted-foreground">正确答案:</span>
          <span class="ml-2 text-green-600 font-medium">{{ Array.isArray(item.question.answer) ? item.question.answer.join('、') : item.question.answer }}</span>
        </div>

        <!-- 解析 -->
        <div class="text-sm text-muted-foreground mt-3 pt-3 border-t">
          <span class="text-foreground font-medium">解析:</span> {{ item.question.explanation }}
        </div>

        <!-- 操作 -->
        <div class="mt-3 pt-3 border-t flex gap-2">
          <Button variant="outline" size="sm" class="gap-1.5" @click="router.push(`/app/study/${courseId}?step=${item.stepId}`)">
            <Icon name="solar:book-bold-duotone" class="size-3.5" /> 回顾讲义
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
