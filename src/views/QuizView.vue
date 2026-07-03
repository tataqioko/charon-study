<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings";
import { getTestByStep, listSteps, saveTestAttempt, type Step } from "@/lib/db";
import { generateQuizForStep } from "@/lib/courseGen";
import type { QuizQuestion } from "@/lib/prompts";

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();

const courseId = computed(() => Number(route.params.courseId));
const stepId = computed(() => Number(route.params.stepId));
const step = ref<Step | null>(null);
const testId = ref<number | null>(null);
const questions = ref<QuizQuestion[]>([]);
const answers = ref<Record<number, string | string[]>>({});
const submitted = ref(false);
const loading = ref(false);

const kindLabel: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", judgment: "判断",
  fill_blanks: "填空", free_response: "主观题",
};

onMounted(async () => {
  await settings.init();
  const steps = await listSteps(courseId.value);
  step.value = steps.find((s) => s.id === stepId.value) ?? null;
  const t = await getTestByStep(stepId.value);
  if (t?.questions_json) {
    testId.value = t.id;
    questions.value = JSON.parse(t.questions_json).questions;
  } else {
    await gen();
  }
});

async function gen() {
  if (!settings.selectedModel) { toast.error("请先在设置里选择模型"); return; }
  loading.value = true;
  try {
    const payload = await generateQuizForStep(courseId.value, stepId.value, settings.selectedModel);
    questions.value = payload.questions;
    answers.value = {};
    submitted.value = false;
    const t = await getTestByStep(stepId.value);
    testId.value = t?.id ?? null;
  } catch (e) {
    toast.error(String(e));
  } finally {
    loading.value = false;
  }
}

function toggleMulti(qi: number, id: string) {
  const cur = (answers.value[qi] as string[]) ?? [];
  answers.value[qi] = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
}

function isCorrect(q: QuizQuestion, qi: number): boolean {
  const a = answers.value[qi];
  if (q.kind === "multi_choice") {
    const got = [...((a as string[]) ?? [])].sort().join(",");
    const want = [...(Array.isArray(q.answer) ? q.answer : [q.answer])].sort().join(",");
    return got === want && got !== "";
  }
  if (q.kind === "fill_blanks" || q.kind === "free_response") {
    // 主观/填空:不自动判分,归为"参考",不计入对错统计
    return false;
  }
  return String(a ?? "").toLowerCase() === String(q.answer).toLowerCase();
}

// 只统计可自动判分的题(选择/判断)
const autoGraded = computed(() => questions.value.filter((q) => q.kind !== "free_response" && q.kind !== "fill_blanks"));
const correctCount = computed(() =>
  questions.value.reduce((n, q, i) =>
    (q.kind !== "free_response" && q.kind !== "fill_blanks" && isCorrect(q, i)) ? n + 1 : n, 0)
);

async function submit() {
  submitted.value = true;
  if (!testId.value) return;
  // 保存答题记录
  for (let i = 0; i < questions.value.length; i++) {
    const q = questions.value[i];
    const ans = answers.value[i];
    if (ans === undefined) continue;
    const userAnswer = Array.isArray(ans) ? ans.join(",") : String(ans);
    const correct = isCorrect(q, i);
    await saveTestAttempt(testId.value, i, userAnswer, correct);
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-8 py-8">
    <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3" @click="router.push(`/app/study/${courseId}`)">
      <Icon name="solar:alt-arrow-left-linear" class="size-3.5" /> 返回学习
    </button>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">本节测验</h1>
        <p class="text-sm text-muted-foreground mt-1">{{ step?.title }}</p>
      </div>
      <Button v-if="questions.length && !loading" variant="outline" size="sm" class="gap-1.5" @click="gen">
        <Icon name="solar:refresh-bold" class="size-4" /> 换一套
      </Button>
    </div>

    <div v-if="loading" class="py-24 flex flex-col items-center gap-3 text-center">
      <Icon name="solar:refresh-bold" class="size-8 text-primary animate-spin" />
      <p class="text-sm text-muted-foreground">正在出题…</p>
    </div>

    <template v-else-if="questions.length">
      <!-- 交卷后:分数条 -->
      <div v-if="submitted" class="mb-6 rounded-xl border bg-card p-4 flex items-center gap-4">
        <div class="size-14 rounded-full grid place-items-center text-lg font-bold"
          :class="correctCount === autoGraded.length ? 'bg-green-500/15 text-green-600' : 'bg-primary/10 text-primary'">
          {{ autoGraded.length ? Math.round(correctCount / autoGraded.length * 100) : "-" }}<span class="text-xs">分</span>
        </div>
        <div class="text-sm">
          <div class="font-medium">客观题 {{ correctCount }}/{{ autoGraded.length }} 正确</div>
          <div class="text-muted-foreground text-xs mt-0.5">填空/主观题请对照参考答案自评</div>
        </div>
      </div>

      <div class="flex flex-col gap-6">
        <div v-for="(q, qi) in questions" :key="qi" class="rounded-xl border bg-card p-5">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{{ kindLabel[q.kind] }}</span>
            <span class="text-xs text-muted-foreground">第 {{ qi + 1 }} 题</span>
          </div>
          <p class="font-medium mb-3 whitespace-pre-wrap">{{ q.stem }}</p>

          <!-- 选择题 -->
          <div v-if="q.kind === 'single_choice' || q.kind === 'multi_choice'" class="flex flex-col gap-2">
            <button
              v-for="c in q.choices" :key="c.id"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-sm transition-colors"
              :class="[
                (q.kind==='multi_choice' ? ((answers[qi] as string[])?.includes(c.id)) : answers[qi]===c.id) ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40',
                submitted && (Array.isArray(q.answer) ? q.answer.includes(c.id) : q.answer===c.id) ? '!border-green-500 !bg-green-500/10' : ''
              ]"
              :disabled="submitted"
              @click="q.kind==='multi_choice' ? toggleMulti(qi, c.id) : (answers[qi]=c.id)"
            >
              <span class="size-5 shrink-0 rounded-full border grid place-items-center text-xs font-medium">{{ c.id.toUpperCase() }}</span>
              {{ c.label }}
            </button>
          </div>

          <!-- 判断题 -->
          <div v-else-if="q.kind === 'judgment'" class="flex gap-2">
            <button v-for="opt in [{v:'true',t:'正确'},{v:'false',t:'错误'}]" :key="opt.v"
              class="flex-1 py-2 rounded-lg border text-sm transition-colors"
              :class="[
                answers[qi]===opt.v ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40',
                submitted && String(q.answer)===opt.v ? '!border-green-500 !bg-green-500/10' : ''
              ]"
              :disabled="submitted" @click="answers[qi]=opt.v">{{ opt.t }}</button>
          </div>

          <!-- 填空 / 主观 -->
          <div v-else>
            <Input v-model="answers[qi] as string" :disabled="submitted" placeholder="输入你的答案…" />
          </div>

          <!-- 交卷后:解析 -->
          <div v-if="submitted" class="mt-3 pt-3 border-t text-sm">
            <div v-if="q.kind!=='free_response' && q.kind!=='fill_blanks'" class="flex items-center gap-1.5 mb-1"
              :class="isCorrect(q, qi) ? 'text-green-600' : 'text-destructive'">
              <Icon :name="isCorrect(q,qi) ? 'solar:check-circle-bold' : 'solar:close-circle-bold'" class="size-4" />
              {{ isCorrect(q, qi) ? '答对了' : '答错了' }}
            </div>
            <p class="text-muted-foreground"><span class="text-foreground font-medium">参考答案:</span>{{ Array.isArray(q.answer) ? q.answer.join('、') : q.answer }}</p>
            <p class="text-muted-foreground mt-1"><span class="text-foreground font-medium">解析:</span>{{ q.explanation }}</p>
          </div>
        </div>
      </div>

      <div class="mt-6 flex justify-center">
        <Button v-if="!submitted" size="lg" class="gap-1.5" @click="submit">
          <Icon name="solar:check-read-bold-duotone" class="size-4" /> 交卷
        </Button>
        <Button v-else variant="outline" size="lg" class="gap-1.5" @click="router.push(`/app/study/${courseId}`)">
          <Icon name="solar:book-bold-duotone" class="size-4" /> 返回继续学习
        </Button>
      </div>
    </template>
  </div>
</template>
