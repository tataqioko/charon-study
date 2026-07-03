<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import MarkdownIt from "markdown-it";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import LectureRenderer from "@/components/LectureRenderer.vue";
import { useSettingsStore } from "@/stores/settings";
import { useReaderPrefs } from "@/composables/useReaderPrefs";
import {
  getCourse, listSteps, getLectureByStep, setStepStatus, toggleStepBookmark,
  listNotes, createNote, deleteNote,
  listQA, createQA,
  type Course, type Step, type Note, type QA,
} from "@/lib/db";
import { streamLectureForStep, askFollowUp, reschedule, type GenProgress } from "@/lib/courseGen";

const md = new MarkdownIt();

function renderMarkdown(text: string): string {
  return md.render(text);
}

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();
const { fontScale, contentWidth, focusMode, bigger, smaller, toggleFocus } = useReaderPrefs();

const courseId = computed(() => Number(route.params.id));
const course = ref<Course | null>(null);
const steps = ref<Step[]>([]);
const activeStepId = ref<number | null>(null);
const lectureMd = ref<string>("");
const generatingIds = ref<Set<number>>(new Set());
const loading = computed(() =>
  activeStepId.value != null && generatingIds.value.has(activeStepId.value)
);
const showActionBar = ref(true); // 右侧操作栏折叠状态
const showSidebar = ref(true); // 左侧课程目录折叠状态

// 问答历史
const qaList = ref<QA[]>([]);
const currentAnswer = ref(""); // 当前正在生成的答案

const completedCount = computed(() => steps.value.filter((s) => s.status === "completed").length);
const progressPct = computed(() =>
  steps.value.length ? Math.round((completedCount.value / steps.value.length) * 100) : 0
);

// 调整计划
const showRescheduleDialog = ref(false);
const newTotalDays = ref(7);
const rescheduling = ref(false);
const rescheduleProgress = ref<GenProgress | null>(null);
const activeStep = computed(() => steps.value.find((s) => s.id === activeStepId.value));

onMounted(async () => {
  await settings.init();
  await load();
});

async function load() {
  course.value = await getCourse(courseId.value);
  steps.value = await listSteps(courseId.value);
  const first = steps.value[0];
  if (first) selectStep(first.id);
}

async function selectStep(stepId: number) {
  activeStepId.value = stepId;
  lectureMd.value = "";
  notes.value = [];
  qaList.value = [];
  currentAnswer.value = "";
  const lecture = await getLectureByStep(stepId);
  if (activeStepId.value !== stepId) return;
  if (lecture?.content_md) {
    lectureMd.value = lecture.content_md;
  } else if (!generatingIds.value.has(stepId)) {
    generate(stepId);
  }
  notes.value = await listNotes(stepId);
  qaList.value = await listQA(stepId);
}

async function generate(stepId: number) {
  if (!settings.selectedModel) {
    toast.error("请先在设置里选择模型");
    return;
  }
  generatingIds.value = new Set(generatingIds.value).add(stepId);
  let lastPaint = 0;
  try {
    const md = await streamLectureForStep(
      courseId.value, stepId, settings.selectedModel,
      (acc) => {
        if (activeStepId.value !== stepId) return;
        const now = Date.now();
        if (now - lastPaint > 100) {
          lastPaint = now;
          lectureMd.value = acc;
        }
      }
    );
    if (activeStepId.value === stepId) lectureMd.value = md;
  } catch (e) {
    if (activeStepId.value === stepId) toast.error(String(e));
  } finally {
    const next = new Set(generatingIds.value);
    next.delete(stepId);
    generatingIds.value = next;
  }
}

async function markComplete() {
  const s = activeStep.value;
  if (!s) return;
  const done = s.status === "completed";
  await setStepStatus(s.id, done ? "active" : "completed");
  s.status = done ? "active" : "completed";
  if (!done) toast.success("已标记完成");
}

async function toggleBookmark(s: Step, e: Event) {
  e.stopPropagation();
  const on = s.bookmarked !== 1;
  await toggleStepBookmark(s.id, on);
  s.bookmarked = on ? 1 : 0;
}

// 追问/重讲
const asking = ref(false);
const customQ = ref("");
const quickAsks = [
  { label: "没听懂", q: "这一节我没太听懂,能换个更简单的方式再讲一遍吗?" },
  { label: "举个例子", q: "能举一个具体的例子帮我理解吗?" },
  { label: "讲深一点", q: "能讲得更深入、更进阶一些吗?" },
];

// 高亮 / 笔记
const notes = ref<Note[]>([]);
const highlights = computed(() =>
  notes.value.map((n) => ({
    id: n.id, anchor_text: n.anchor_text, color: n.color,
    hl_start: n.hl_start, hl_end: n.hl_end,
  }))
);
const showNotes = ref(false);
const popup = ref<{ show: boolean; x: number; y: number; text: string; start: number; end: number }>({
  show: false, x: 0, y: 0, text: "", start: -1, end: -1,
});
const noteColors = [
  { key: "amber", cls: "bg-amber-300" },
  { key: "green", cls: "bg-green-300" },
  { key: "blue", cls: "bg-blue-300" },
  { key: "pink", cls: "bg-pink-300" },
];

function onSelect(p: { text: string; start: number; end: number; x: number; y: number }) {
  popup.value = { show: true, x: p.x, y: p.y, text: p.text, start: p.start, end: p.end };
}
function closePopup() {
  popup.value.show = false;
}
async function addHighlight(color: string) {
  const s = activeStep.value;
  if (!s) return;
  let { text, start, end } = popup.value;

  // 去掉首尾空白(换行、空格等),避免高亮包含换行符产生空行
  const trimmed = text.trim();
  if (!trimmed) {
    closePopup();
    window.getSelection()?.removeAllRanges();
    return;
  }
  const leadingWs = text.length - text.trimStart().length;
  const trailingWs = text.length - text.trimEnd().length;
  text = trimmed;
  if (start >= 0 && end > start) {
    start += leadingWs;
    end -= trailingWs;
  }

  const hasOffset = start >= 0 && end > start;
  const id = await createNote(
    s.id, "highlight", text, "", color,
    hasOffset ? start : null, hasOffset ? end : null
  );
  notes.value.push({
    id, step_id: s.id, kind: "highlight", anchor_text: text,
    body: "", color, hl_start: hasOffset ? start : null, hl_end: hasOffset ? end : null,
    created_at: "",
  });
  closePopup();
  window.getSelection()?.removeAllRanges();
}
async function addNoteWithText() {
  const s = activeStep.value;
  if (!s) return;
  let { text, start, end } = popup.value;

  // 去掉首尾空白
  const trimmed = text.trim();
  if (!trimmed) {
    closePopup();
    return;
  }
  const leadingWs = text.length - text.trimStart().length;
  const trailingWs = text.length - text.trimEnd().length;
  text = trimmed;
  if (start >= 0 && end > start) {
    start += leadingWs;
    end -= trailingWs;
  }

  const body = window.prompt(`为「${text.slice(0, 20)}…」添加笔记:`);
  if (body == null) { closePopup(); return; }
  const hasOffset = start >= 0 && end > start;
  const id = await createNote(
    s.id, "note", text, body, "amber",
    hasOffset ? start : null, hasOffset ? end : null
  );
  notes.value.push({
    id, step_id: s.id, kind: "note", anchor_text: text,
    body, color: "amber", hl_start: hasOffset ? start : null, hl_end: hasOffset ? end : null,
    created_at: "",
  });
  closePopup();
  window.getSelection()?.removeAllRanges();
  showNotes.value = true;
}
async function removeNote(n: Note) {
  await deleteNote(n.id);
  notes.value = notes.value.filter((x) => x.id !== n.id);
}

// 部分擦除:选中高亮里的几个字 → 只擦这段,剩余高亮拆分保留
async function eraseSelected() {
  const { start, end } = popup.value;
  if (start < 0 || end <= start) {
    toast.error("未能获取选区位置");
    closePopup();
    return;
  }
  const hits = notes.value.filter(
    (n) => n.kind === "highlight" && n.hl_start != null && n.hl_end != null &&
      n.hl_start < end && n.hl_end > start // 区间重叠
  );
  closePopup();
  window.getSelection()?.removeAllRanges();
  if (!hits.length) {
    toast.info("选区内无高亮");
    return;
  }
  const s = activeStep.value;
  if (!s) return;

  // 对每条重叠的高亮:拆分成 left/right 两段(若有)
  for (const h of hits) {
    const hStart = h.hl_start!;
    const hEnd = h.hl_end!;
    const leftStart = hStart;
    const leftEnd = Math.min(hEnd, start);
    const rightStart = Math.max(hStart, end);
    const rightEnd = hEnd;

    await deleteNote(h.id); // 删原记录
    notes.value = notes.value.filter((x) => x.id !== h.id);

    // 左段存在 → 新建
    if (leftEnd > leftStart) {
      const leftText = (h.anchor_text ?? "").slice(0, leftEnd - hStart);
      const leftId = await createNote(s.id, "highlight", leftText, "", h.color, leftStart, leftEnd);
      notes.value.push({
        id: leftId, step_id: s.id, kind: "highlight", anchor_text: leftText,
        body: "", color: h.color, hl_start: leftStart, hl_end: leftEnd, created_at: "",
      });
    }
    // 右段存在 → 新建
    if (rightEnd > rightStart) {
      const rightText = (h.anchor_text ?? "").slice(rightStart - hStart);
      const rightId = await createNote(s.id, "highlight", rightText, "", h.color, rightStart, rightEnd);
      notes.value.push({
        id: rightId, step_id: s.id, kind: "highlight", anchor_text: rightText,
        body: "", color: h.color, hl_start: rightStart, hl_end: rightEnd, created_at: "",
      });
    }
  }
  toast.success(`已擦除选区，剩余高亮已拆分保留`);
}

async function ask(question: string) {
  const s = activeStep.value;
  if (!s || !question.trim()) return;
  if (!settings.selectedModel) {
    toast.error("请先在设置里选择模型");
    return;
  }
  if (asking.value) return;
  asking.value = true;
  customQ.value = "";
  const baseMd = lectureMd.value;
  const targetStep = s.id;
  const q = question.trim();
  currentAnswer.value = "";
  let lastPaint = 0;
  try {
    const answer = await askFollowUp(
      courseId.value, targetStep, settings.selectedModel, q, baseMd,
      (ans) => {
        if (activeStepId.value !== targetStep) return;
        const now = Date.now();
        if (now - lastPaint > 100) {
          lastPaint = now;
          currentAnswer.value = ans;
        }
      }
    );
    if (activeStepId.value === targetStep) {
      currentAnswer.value = answer;
      const qaId = await createQA(targetStep, q, answer);
      qaList.value.push({ id: qaId, step_id: targetStep, question: q, answer, created_at: new Date().toISOString() });
      currentAnswer.value = "";
    }
  } catch (e) {
    toast.error(String(e));
    currentAnswer.value = "";
  } finally {
    asking.value = false;
  }
}

async function openRescheduleDialog() {
  if (!course.value) return;
  newTotalDays.value = course.value.total_days;
  showRescheduleDialog.value = true;
}

async function submitReschedule() {
  if (!settings.selectedModel) {
    toast.error("请先在设置里选择模型");
    return;
  }
  rescheduling.value = true;
  rescheduleProgress.value = { stage: "准备中" };
  try {
    await reschedule(courseId.value, newTotalDays.value, settings.selectedModel, (p) => {
      rescheduleProgress.value = p;
    });
    toast.success("计划调整完成");
    showRescheduleDialog.value = false;
    await load();
  } catch (e) {
    toast.error(String(e));
  } finally {
    rescheduling.value = false;
    rescheduleProgress.value = null;
  }
}
</script>

<template>
  <div class="flex h-full">
    <!-- 课程步骤侧栏 -->
    <aside v-if="showSidebar && !focusMode" class="w-64 shrink-0 border-r bg-muted/20 flex flex-col overflow-hidden">
      <div class="p-4 border-b">
        <div class="flex items-center justify-between mb-2">
          <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" @click="router.push('/app/courses')">
            <Icon name="solar:alt-arrow-left-linear" class="size-3.5" /> 返回课程
          </button>
          <button class="text-muted-foreground hover:text-foreground" title="折叠目录" @click="showSidebar = false">
            <Icon name="solar:sidebar-minimalistic-linear" class="size-4" />
          </button>
        </div>
        <h2 class="font-semibold tracking-tight truncate">{{ course?.topic }}</h2>
        <p class="text-xs text-muted-foreground mt-0.5">{{ course?.total_days }} 天 · {{ course?.daily_time }}</p>
        <Button variant="outline" size="sm" class="w-full mt-2 gap-1.5 text-xs" @click="openRescheduleDialog">
          <Icon name="solar:settings-bold-duotone" class="size-3.5" /> 调整计划
        </Button>
        <!-- 进度条 -->
        <div class="mt-3">
          <div class="flex justify-between text-[11px] text-muted-foreground mb-1">
            <span>学习进度</span><span>{{ completedCount }}/{{ steps.length }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-muted overflow-hidden">
            <div class="h-full rounded-full bg-primary transition-all duration-500" :style="{ width: progressPct + '%' }" />
          </div>
        </div>
      </div>
      <div class="flex-1 overflow-auto p-2 flex flex-col gap-1">
        <button
          v-for="s in steps" :key="s.id"
          class="flex items-start gap-2.5 px-3 py-2.5 rounded-md text-left text-sm transition-colors group"
          :class="activeStepId === s.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'"
          @click="selectStep(s.id)"
        >
          <span class="mt-0.5 size-5 shrink-0 rounded-full grid place-items-center text-[11px] font-medium"
            :class="s.status === 'completed' ? 'bg-green-500 text-white' : activeStepId === s.id ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/15'">
            <Icon v-if="generatingIds.has(s.id)" name="solar:refresh-bold" class="size-3 animate-spin" />
            <Icon v-else-if="s.status === 'completed'" name="solar:check-read-linear" class="size-3" />
            <template v-else>{{ s.day_index }}</template>
          </span>
          <span class="flex-1 min-w-0">
            <span class="block font-medium text-foreground/90 leading-snug">{{ s.title }}</span>
            <span class="block text-xs opacity-70 truncate mt-0.5">{{ s.objective }}</span>
          </span>
          <span
            class="shrink-0 transition-opacity"
            :class="s.bookmarked === 1 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
            @click="toggleBookmark(s, $event)"
          >
            <Icon :name="s.bookmarked === 1 ? 'solar:bookmark-bold' : 'solar:bookmark-linear'" :class="['size-4', s.bookmarked === 1 ? 'text-primary' : 'text-muted-foreground']" />
          </span>
        </button>
      </div>
    </aside>

    <!-- 讲义内容 -->
    <main class="flex-1 overflow-auto relative">
      <!-- 阅读工具条 -->
      <div class="sticky top-0 z-10 flex items-center justify-between gap-1 px-4 h-11 bg-background/80 backdrop-blur border-b">
        <!-- 左侧:展开目录按钮(折叠时显示) -->
        <Button v-if="!showSidebar && !focusMode" variant="ghost" size="icon" class="size-8" title="展开目录" @click="showSidebar = true">
          <Icon name="solar:hamburger-menu-linear" class="size-4" />
        </Button>
        <div v-else class="size-8" />

        <!-- 右侧:阅读工具 -->
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="icon" class="size-8" title="缩小字号" @click="smaller"><Icon name="solar:minus-square-linear" class="size-4" /></Button>
          <span class="text-xs text-muted-foreground w-10 text-center">{{ fontScale }}%</span>
          <Button variant="ghost" size="icon" class="size-8" title="放大字号" @click="bigger"><Icon name="solar:add-square-linear" class="size-4" /></Button>
          <!-- 内容宽度滑块(专注模式下隐藏) -->
          <template v-if="!focusMode">
            <div class="w-px h-4 bg-border mx-1" />
            <Icon name="solar:sidebar-minimalistic-linear" class="size-4 text-muted-foreground" title="内容宽度" />
            <input
              type="range" min="50" max="100" step="2"
              v-model.number="contentWidth"
              title="调整正文宽度(拉满=铺满)"
              class="w-28 h-1.5 accent-primary cursor-pointer"
            />
          </template>
          <div class="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="icon" class="size-8 relative" title="笔记" @click="showNotes = !showNotes">
            <Icon name="solar:notebook-bold-duotone" class="size-4" :class="showNotes && 'text-primary'" />
            <span v-if="notes.length" class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center">{{ notes.length }}</span>
          </Button>
          <Button variant="ghost" size="icon" class="size-8" :title="focusMode ? '退出专注' : '专注模式'" @click="toggleFocus">
            <Icon :name="focusMode ? 'solar:full-screen-square-linear' : 'solar:full-screen-linear'" class="size-4" :class="focusMode && 'text-primary'" />
          </Button>
        </div>
      </div>

      <div
        class="mx-auto px-10 py-8"
        :style="focusMode ? undefined : { width: contentWidth + '%' }"
        :class="focusMode ? 'max-w-2xl' : ''"
      >
        <div v-if="loading && !lectureMd" class="flex flex-col items-center gap-3 py-24 text-center">
          <Icon name="solar:refresh-bold" class="size-8 text-primary animate-spin" />
          <p class="text-sm text-muted-foreground">正在生成这一节讲义…</p>
        </div>
        <template v-else-if="lectureMd">
          <LectureRenderer :content="lectureMd" :scale="fontScale" :streaming="loading || asking" :highlights="highlights" @select="onSelect" />
        </template>
        <div v-else class="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
          <Icon name="solar:book-bold-duotone" class="size-12 text-primary/40" />
          <p class="text-sm">选择左侧任意一节开始学习</p>
          <Button v-if="activeStep" class="gap-1.5 mt-2" @click="generate(activeStep.id)">
            <Icon name="solar:magic-stick-3-bold-duotone" class="size-4" /> 生成本节讲义
          </Button>
        </div>
      </div>
    </main>

    <!-- 右侧操作栏 -->
    <aside v-if="showActionBar && lectureMd && !loading" class="w-80 shrink-0 border-l bg-muted/10 flex flex-col">
      <div class="h-11 px-4 flex items-center justify-between border-b">
        <span class="text-sm font-medium flex items-center gap-1.5">
          <Icon name="solar:widget-5-bold-duotone" class="size-4 text-primary" /> 学习工具
        </span>
        <button class="text-muted-foreground hover:text-foreground" title="折叠" @click="showActionBar = false">
          <Icon name="solar:sidebar-minimalistic-linear" class="size-4" />
        </button>
      </div>

      <!-- 上方:追问输入 -->
      <div class="p-4 border-b">
        <div class="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <Icon name="solar:chat-round-line-bold-duotone" class="size-4 text-primary" /> 没懂?随时追问
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <Button
            v-for="qa in quickAsks" :key="qa.label"
            variant="outline" size="sm" :disabled="asking"
            @click="ask(qa.q)"
          >{{ qa.label }}</Button>
        </div>
        <div class="flex gap-2">
          <Input v-model="customQ" placeholder="或者输入你的问题…" :disabled="asking" @keyup.enter="ask(customQ)" />
          <Button :disabled="asking || !customQ.trim()" class="gap-1.5 shrink-0" size="sm" @click="ask(customQ)">
            <Icon :name="asking ? 'solar:refresh-bold' : 'solar:plain-2-bold-duotone'" :class="['size-4', asking && 'animate-spin']" />
          </Button>
        </div>
      </div>

      <!-- 中间:问答历史(可滚动) -->
      <div class="flex-1 overflow-auto p-4">
        <div v-if="!qaList.length && !currentAnswer" class="text-xs text-center text-muted-foreground py-8">
          还没有问答记录
        </div>
        <div v-else class="space-y-3">
          <div v-for="qa in qaList" :key="qa.id" class="rounded-lg border bg-card/50 p-3 text-sm space-y-2">
            <div class="flex items-start gap-2">
              <Icon name="solar:user-speak-rounded-bold-duotone" class="size-4 text-primary shrink-0 mt-0.5" />
              <p class="flex-1 font-medium text-foreground">{{ qa.question }}</p>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="solar:chat-round-check-bold-duotone" class="size-4 text-green-600 shrink-0 mt-0.5" />
              <div class="flex-1 text-muted-foreground prose prose-sm max-w-none" v-html="renderMarkdown(qa.answer)" />
            </div>
          </div>
          <!-- 当前正在生成的回答 -->
          <div v-if="currentAnswer" class="rounded-lg border bg-card/50 p-3 text-sm space-y-2 border-primary/50">
            <div class="flex items-start gap-2">
              <Icon name="solar:user-speak-rounded-bold-duotone" class="size-4 text-primary shrink-0 mt-0.5" />
              <p class="flex-1 font-medium text-foreground">正在回答...</p>
            </div>
            <div class="flex items-start gap-2">
              <Icon name="solar:chat-round-line-bold-duotone" class="size-4 text-primary shrink-0 mt-0.5 animate-pulse" />
              <div class="flex-1 text-muted-foreground prose prose-sm max-w-none" v-html="renderMarkdown(currentAnswer)" />
            </div>
          </div>
        </div>
      </div>

      <!-- 底部:固定按钮 -->
      <div class="p-4 border-t space-y-2 bg-background">
        <Button :variant="activeStep?.status === 'completed' ? 'outline' : 'default'" class="w-full gap-1.5" @click="markComplete">
          <Icon :name="activeStep?.status === 'completed' ? 'solar:check-read-bold' : 'solar:check-circle-bold-duotone'" class="size-4" />
          {{ activeStep?.status === 'completed' ? '已完成(点击取消)' : '标记本节完成' }}
        </Button>
        <Button variant="outline" class="w-full gap-1.5" @click="router.push(`/app/quiz/${courseId}/${activeStepId}`)">
          <Icon name="solar:clipboard-check-bold-duotone" class="size-4" /> 开始本节测验
        </Button>
      </div>
    </aside>

    <!-- 展开按钮(折叠时显示) -->
    <button
      v-if="!showActionBar && lectureMd && !loading"
      class="fixed right-4 bottom-4 size-10 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-shadow grid place-items-center"
      title="展开学习工具"
      @click="showActionBar = true"
    >
      <Icon name="solar:widget-5-bold-duotone" class="size-5" />
    </button>

    <!-- 笔记侧栏 -->
    <aside v-if="showNotes" class="w-72 shrink-0 border-l bg-muted/20 flex flex-col overflow-hidden">
      <div class="h-11 px-4 flex items-center justify-between border-b">
        <span class="text-sm font-medium flex items-center gap-1.5"><Icon name="solar:notebook-bold-duotone" class="size-4 text-primary" /> 笔记与高亮</span>
        <button class="text-muted-foreground hover:text-foreground" @click="showNotes = false"><Icon name="solar:close-circle-linear" class="size-4" /></button>
      </div>
      <div class="flex-1 overflow-auto p-3 flex flex-col gap-2">
        <div v-if="!notes.length" class="text-xs text-muted-foreground text-center py-8">
          划选讲义里的文字即可高亮或写笔记
        </div>
        <div v-for="n in notes" :key="n.id" class="group rounded-lg border bg-card p-2.5 text-sm">
          <div class="flex items-start gap-2">
            <span class="mt-1 size-2 rounded-full shrink-0" :class="{
              'bg-amber-300': n.color==='amber','bg-green-300': n.color==='green',
              'bg-blue-300': n.color==='blue','bg-pink-300': n.color==='pink'}" />
            <div class="flex-1 min-w-0">
              <p class="text-xs text-muted-foreground line-clamp-2">{{ n.anchor_text }}</p>
              <p v-if="n.body" class="mt-1 text-foreground">{{ n.body }}</p>
            </div>
            <button class="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" @click="removeNote(n)">
              <Icon name="solar:trash-bin-minimalistic-linear" class="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- 划词弹出菜单 -->
    <div
      v-if="popup.show"
      class="fixed z-50 -translate-x-1/2 -translate-y-full mb-2 flex items-center gap-1 rounded-lg border bg-popover shadow-lg px-1.5 py-1"
      :style="{ left: popup.x + 'px', top: (popup.y - 8) + 'px' }"
    >
      <button
        v-for="c in noteColors" :key="c.key"
        class="size-6 rounded-full grid place-items-center hover:scale-110 transition-transform"
        :title="'高亮'" @click="addHighlight(c.key)"
      >
        <span class="size-4 rounded-full" :class="c.cls" />
      </button>
      <div class="w-px h-5 bg-border mx-0.5" />
      <button class="size-6 grid place-items-center rounded hover:bg-accent" title="写笔记" @click="addNoteWithText">
        <Icon name="solar:pen-2-linear" class="size-4" />
      </button>
      <button class="size-6 grid place-items-center rounded hover:bg-accent" title="擦除选区内的高亮" @click="eraseSelected">
        <Icon name="solar:eraser-linear" class="size-4" />
      </button>
      <button class="size-6 grid place-items-center rounded hover:bg-accent text-muted-foreground" title="取消" @click="closePopup">
        <Icon name="solar:close-circle-linear" class="size-4" />
      </button>
    </div>

    <!-- 调整计划对话框 -->
    <Dialog v-model:open="showRescheduleDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>调整学习计划</DialogTitle>
          <DialogDescription>修改课程天数,AI 将重新规划学习进度</DialogDescription>
        </DialogHeader>

        <div v-if="rescheduling" class="py-8 flex flex-col items-center gap-3 text-center">
          <Icon name="solar:refresh-bold" class="size-8 text-primary animate-spin" />
          <div class="font-medium">{{ rescheduleProgress?.stage }}</div>
          <div v-if="rescheduleProgress?.detail" class="text-sm text-muted-foreground">{{ rescheduleProgress.detail }}</div>
          <p class="text-xs text-muted-foreground mt-2">正在重新生成计划...</p>
        </div>

        <div v-else class="space-y-4">
          <div class="space-y-2">
            <Label>总天数</Label>
            <Input v-model.number="newTotalDays" type="number" min="1" max="365" />
            <p class="text-xs text-muted-foreground">当前: {{ course?.total_days }} 天 → 新计划: {{ newTotalDays }} 天</p>
          </div>
          <div class="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-600">
            <Icon name="solar:danger-bold" class="size-4 inline-block mr-1" />
            调整计划将清空所有已生成的讲义和测验,请谨慎操作。
          </div>
        </div>

        <DialogFooter v-if="!rescheduling">
          <Button variant="outline" @click="showRescheduleDialog = false">取消</Button>
          <Button @click="submitReschedule">确认调整</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
