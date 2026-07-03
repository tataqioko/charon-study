<script setup lang="ts">
import { ref, computed } from "vue";
import { toast } from "vue-sonner";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { DiagnosticQuestion } from "@/lib/prompts";

const props = defineProps<{
  topic: string;
  questions: DiagnosticQuestion[];
  onComplete: (answers: Record<string, string>) => void;
  onSkip: () => void;
}>();

const answers = ref<Record<string, string>>({});
const currentIndex = ref(0);

const allQuestions = computed(() => props.questions);
const currentQuestion = computed(() => allQuestions.value[currentIndex.value]);
const progress = computed(() => Math.round(((currentIndex.value + 1) / allQuestions.value.length) * 100));
const isLast = computed(() => currentIndex.value === allQuestions.value.length - 1);
const canNext = computed(() => answers.value[currentQuestion.value?.id] !== undefined);

function next() {
  if (!canNext.value) {
    toast.error("请先回答当前问题");
    return;
  }
  if (isLast.value) {
    props.onComplete(answers.value);
  } else {
    currentIndex.value++;
  }
}

function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--;
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-8 py-8 h-full flex flex-col">
    <div class="mb-6">
      <h1 class="text-2xl font-bold tracking-tight">学习诊断</h1>
      <p class="text-sm text-muted-foreground mt-1">了解你的基础和学习偏好，为你定制课程</p>
    </div>

    <!-- 进度条 -->
    <div class="mb-6">
      <div class="flex justify-between text-xs text-muted-foreground mb-2">
        <span>问题 {{ currentIndex + 1 }} / {{ allQuestions.length }}</span>
        <span>{{ progress }}%</span>
      </div>
      <div class="h-2 rounded-full bg-muted overflow-hidden">
        <div class="h-full bg-primary transition-all duration-300" :style="{ width: progress + '%' }" />
      </div>
    </div>

    <!-- 问题区域 -->
    <div class="flex-1 rounded-xl border bg-card p-8 mb-6 flex flex-col">
      <div class="flex-1">
        <h2 class="text-xl font-semibold mb-6">{{ currentQuestion.question }}</h2>

        <!-- 单选题 -->
        <div v-if="currentQuestion.type === 'single_choice'" class="space-y-3">
          <button
            v-for="(option, idx) in currentQuestion.options" :key="idx"
            class="w-full text-left px-4 py-3 rounded-lg border transition-colors"
            :class="answers[currentQuestion.id] === option ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40'"
            @click="answers[currentQuestion.id] = option"
          >
            {{ option }}
          </button>
        </div>

        <!-- 量表题 -->
        <div v-else-if="currentQuestion.type === 'scale'" class="space-y-4">
          <RadioGroup v-model="answers[currentQuestion.id]" class="space-y-3">
            <div
              v-for="n in (currentQuestion.scale_range!.max - currentQuestion.scale_range!.min + 1)" :key="n"
              class="flex items-center space-x-3 p-3 rounded-lg border transition-colors"
              :class="answers[currentQuestion.id] === String(currentQuestion.scale_range!.min + n - 1) ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40'"
            >
              <RadioGroupItem :value="String(currentQuestion.scale_range!.min + n - 1)" :id="`scale-${n}`" />
              <Label :for="`scale-${n}`" class="flex-1 cursor-pointer">
                <span class="font-medium">{{ currentQuestion.scale_range!.min + n - 1 }}</span>
                <span v-if="n === 1" class="text-sm text-muted-foreground ml-2">- {{ currentQuestion.scale_range!.min_label }}</span>
                <span v-else-if="n === (currentQuestion.scale_range!.max - currentQuestion.scale_range!.min + 1)" class="text-sm text-muted-foreground ml-2">- {{ currentQuestion.scale_range!.max_label }}</span>
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="flex items-center justify-between">
      <div class="flex gap-2">
        <Button variant="outline" :disabled="currentIndex === 0" @click="prev">
          <Icon name="solar:alt-arrow-left-linear" class="size-4 mr-1" /> 上一题
        </Button>
        <Button variant="ghost" @click="onSkip">
          跳过诊断
        </Button>
      </div>
      <Button :disabled="!canNext" @click="next">
        {{ isLast ? '完成' : '下一题' }}
        <Icon v-if="!isLast" name="solar:alt-arrow-right-linear" class="size-4 ml-1" />
      </Button>
    </div>
  </div>
</template>
