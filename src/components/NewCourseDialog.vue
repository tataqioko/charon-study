<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import DialogScrollContent from "@/components/ui/dialog/DialogScrollContent.vue";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { useSettingsStore } from "@/stores/settings";
import {
  generateCourse, generateDiagnostic, generateProfile, buildKnowledgeBaseForCourse, type GenProgress,
} from "@/lib/courseGen";
import type { DiagnosticPayload, DiagnosticQuestion, UserProfile } from "@/lib/prompts";
import { parseFile, SUPPORTED_EXTENSIONS } from "@/lib/fileParser";

const emit = defineEmits<{ created: [] }>();
const settings = useSettingsStore();
const router = useRouter();

const open = ref(false);
const sourceTab = ref<"topic" | "upload">("topic");
const topic = ref("");
const uploadedFiles = ref<{
  name: string;
  content: string;
  mime_type: string;
  kind: string;
  preview_url: string | null;
  file_size: number;
}[]>([]);
const uploading = ref(false);
const uploadProgress = ref<{ current: number; total: number; fileName: string; chunkProgress?: string } | null>(null);
const mode = ref<"daily" | "sprint" | "leisure">("daily");
const totalDays = ref(7);
const dailyTime = ref("2小时");
const generating = ref(false);
const progress = ref<GenProgress | null>(null);

// 学习诊断（默认开启）：生成课程前先做一份诊断问卷 → 生成画像
const useDiagnostic = ref(true);
// 流程阶段：form(填表) → diagnostic(答题) → generating(生成中)
const phase = ref<"form" | "diagnostic" | "generating">("form");
const diagnostic = ref<DiagnosticPayload | null>(null);
const diagnosticLoading = ref(false);
// 答案：题目 id → 值（选择题=选项文本；量表=数字；文本=字符串）
const answers = ref<Record<string, string | number>>({});
// 自定义补充答案：题目 id → 补充文本（ custom_answers）
const customAnswers = ref<Record<string, string>>({});
// 暂存本次生成用的主题与知识库（进入诊断阶段后 submit 用）
const pendingTopic = ref("");
const pendingKnowledgeBase = ref<string | null>(null);
// ：有上传材料时，诊断前先建课程+知识库，诊断题基于知识单元出。
// 这里暂存预建的课程 id，供后续生成阶段复用（避免重复建库）。
const pendingCourseId = ref<number | null>(null);

const diagnosticQuestions = computed<DiagnosticQuestion[]>(() =>
  diagnostic.value ? [...diagnostic.value.ai_questions, ...diagnostic.value.fixed_questions] : []
);
const allAnswered = computed(() =>
  diagnosticQuestions.value.every((q) => answers.value[q.id] !== undefined && answers.value[q.id] !== "")
);

const modes = [
  { v: "sprint", label: "冲刺", icon: "solar:bolt-bold-duotone", desc: "紧凑高强度" },
  { v: "daily", label: "常规", icon: "solar:calendar-bold-duotone", desc: "稳扎稳打" },
  { v: "leisure", label: "休闲", icon: "solar:cup-hot-bold-duotone", desc: "轻松循序" },
] as const;

async function handleFileSelect(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  if (!files.length) return;

  uploading.value = true;
  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    uploadProgress.value = { current: i + 1, total: files.length, fileName: f.name };

    try {
      // 大文件警告（不再阻止上传）
      const sizeMB = f.size / (1024 * 1024);
      if (sizeMB > 50) {
        toast.warning(`${f.name} 较大 (${sizeMB.toFixed(1)}MB)，解析可能需要较长时间`);
      }

      const ext = f.name.split(".").pop()?.toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext ?? "")) {
        toast.error(`${f.name} 格式不支持`);
        skipCount++;
        continue;
      }

      // 图片解析需要模型
      const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext ?? "");
      if (isImage && !settings.selectedModel) {
        toast.error(`${f.name} 需要在设置中先选择支持视觉的模型`);
        skipCount++;
        continue;
      }

      const result = await parseFile(f, settings.selectedModel, (chunkProgress) => {
        // 分块上传进度
        uploadProgress.value = {
          current: i + 1,
          total: files.length,
          fileName: f.name,
          chunkProgress: `${chunkProgress.percentage}%`,
        };
      });
      uploadedFiles.value.push({
        name: result.filename,
        content: result.text,
        mime_type: result.mime_type,
        kind: result.kind,
        preview_url: result.preview_url,
        file_size: result.file_size,
      });
      successCount++;
    } catch (error) {
      const errorMsg = String(error);
      if (errorMsg.includes('.doc')) {
        toast.error(`${f.name}：旧版 .doc 格式不支持，请用 Word 另存为 .docx`);
      } else {
        toast.error(`${f.name} 解析失败：${errorMsg}`);
      }
      skipCount++;
    }
  }

  uploading.value = false;
  uploadProgress.value = null;

  // 显示汇总
  if (successCount > 0) {
    toast.success(`成功解析 ${successCount} 个文件${skipCount > 0 ? `，跳过 ${skipCount} 个` : ''}`);
  } else if (skipCount > 0) {
    toast.error(`全部 ${skipCount} 个文件解析失败`);
  }

  // 清空 input，允许重新选择相同文件
  (e.target as HTMLInputElement).value = '';
}

function removeFile(idx: number) {
  uploadedFiles.value.splice(idx, 1);
}

/** 校验并解析出主题 + 知识库；返回 null 表示校验失败（已弹 toast） */
function resolveInput(): { finalTopic: string; knowledgeBase: string | null } | null {
  let finalTopic = "";
  let knowledgeBase: string | null = null;

  if (sourceTab.value === "topic") {
    if (!topic.value.trim()) return null;
    finalTopic = topic.value.trim();
  } else {
    if (!uploadedFiles.value.length) {
      toast.error("请先上传至少一个文件");
      return null;
    }
    finalTopic = uploadedFiles.value[0].name.replace(/\.(txt|md|markdown)$/i, "");
    knowledgeBase = uploadedFiles.value.map((f) => `### ${f.name}\n\n${f.content}`).join("\n\n---\n\n");
  }

  if (!settings.selectedModel) {
    toast.error("请先在设置里选择模型");
    return null;
  }
  return { finalTopic, knowledgeBase };
}

/** 点击「生成课程」：诊断开启则先出题进入答题阶段，否则直接生成 */
async function submit() {
  const resolved = resolveInput();
  if (!resolved) return;

  pendingTopic.value = resolved.finalTopic;
  pendingKnowledgeBase.value = resolved.knowledgeBase;
  pendingCourseId.value = null;

  if (!useDiagnostic.value) {
    await runGeneration();
    return;
  }

  // 生成诊断问卷 → 进入答题阶段
  diagnosticLoading.value = true;
  try {
    // ：有上传材料时，诊断前先建课程 + 知识库，诊断题基于知识单元出。
    // 建库是幂等的（buildKnowledgeBaseForCourse 内部检查已有单元则跳过），
    // 生成阶段通过 prebuiltCourseId 复用同一课程，不会重复建库。
    let courseId: number | undefined;
    if (resolved.knowledgeBase) {
      const { createCourse, createMaterial } = await import("@/lib/db");
      const newId = await createCourse(
        resolved.finalTopic, mode.value, totalDays.value, dailyTime.value, resolved.knowledgeBase
      );
      pendingCourseId.value = newId;
      courseId = newId;

      // 保存 materials 记录（ material 管理，并行创建避免竞态条件）
      if (uploadedFiles.value.length > 0) {
        await Promise.all(uploadedFiles.value.map(file =>
          createMaterial({
            course_id: newId,
            file_name: file.name,
            mime_type: file.mime_type,
            kind: file.kind,
            file_size: file.file_size,
            preview_url: file.preview_url,
            ocr_text: file.content,
            status: 'processed',
          })
        ));
      }

      await buildKnowledgeBaseForCourse(
        newId, resolved.finalTopic, resolved.knowledgeBase, settings.selectedModel!,
        (p) => (progress.value = p)
      );
    }

    diagnostic.value = await generateDiagnostic(resolved.finalTopic, settings.selectedModel!, courseId);
    answers.value = {};
    phase.value = "diagnostic";
  } catch (e) {
    toast.error(`诊断问卷生成失败：${String(e)}`);
  } finally {
    diagnosticLoading.value = false;
  }
}

/** 提交诊断答案 → 生成画像 → 生成课程 */
async function submitDiagnostic() {
  if (!diagnostic.value || !settings.selectedModel) return;
  if (!allAnswered.value) {
    toast.error("请回答全部问题");
    return;
  }
  phase.value = "generating";
  generating.value = true;
  progress.value = { stage: "分析诊断结果" };

  const questionsJson = JSON.stringify(diagnosticQuestions.value);
  const answersJson = JSON.stringify(answers.value);
  const customAnswersJson = JSON.stringify(customAnswers.value);

  try {
    let profile: UserProfile | undefined;
    try {
      profile = await generateProfile(pendingTopic.value, questionsJson, answersJson, settings.selectedModel);
    } catch (e) {
      console.warn("画像生成失败，将用默认画像:", e);
    }
    await runGeneration(profile, { questionsJson, answersJson, customAnswersJson });
  } catch (e) {
    toast.error(String(e));
    generating.value = false;
    progress.value = null;
    phase.value = "form";
  }
}

/** 跳过诊断，直接用默认画像生成 */
async function skipDiagnostic() {
  await runGeneration();
}

/** 执行课程生成主链路 */
async function runGeneration(
  profile?: UserProfile,
  diagnosticRecord?: { questionsJson: string; answersJson: string; customAnswersJson?: string }
) {
  phase.value = "generating";
  generating.value = true;
  progress.value = { stage: "准备中" };
  try {
    const id = await generateCourse(
      {
        topic: pendingTopic.value,
        mode: mode.value,
        totalDays: totalDays.value,
        dailyTime: dailyTime.value,
        model: settings.selectedModel!,
        knowledgeBase: pendingKnowledgeBase.value,
        materials: uploadedFiles.value.length > 0 ? uploadedFiles.value.map(f => ({
          file_name: f.name,
          mime_type: f.mime_type,
          kind: f.kind,
          file_size: f.file_size,
          preview_url: f.preview_url,
          ocr_text: f.content,
        })) : undefined,
        profile,
        diagnostic: diagnosticRecord,
        prebuiltCourseId: pendingCourseId.value ?? undefined,
      },
      (p) => (progress.value = p)
    );
    toast.success("课程生成完成");
    open.value = false;
    resetFlow();
    emit("created");
    router.push(`/app/study/${id}`);
  } catch (e) {
    toast.error(String(e));
    phase.value = "form";
  } finally {
    generating.value = false;
    progress.value = null;
  }
}

/** 重置流程状态（关闭对话框或生成成功后） */
function resetFlow() {
  phase.value = "form";
  diagnostic.value = null;
  answers.value = {};
  customAnswers.value = {};
  pendingTopic.value = "";
  pendingKnowledgeBase.value = null;
  pendingCourseId.value = null;
}

// 关闭对话框时重置流程（生成中不重置，避免打断）
watch(open, (isOpen) => {
  if (!isOpen && !generating.value) resetFlow();
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button class="gap-2"><Icon name="solar:add-circle-bold-duotone" class="size-4" /> 新建课程</Button>
    </DialogTrigger>
    <DialogScrollContent class="max-h-[90vh]">
      <DialogHeader>
        <DialogTitle>新建课程</DialogTitle>
        <DialogDescription>输入主题,AI 为你生成个性化学习计划</DialogDescription>
      </DialogHeader>

      <!-- 生成中:显示进度 -->
      <div v-if="phase === 'generating'" class="py-8 flex flex-col items-center gap-3 text-center">
        <Icon name="solar:refresh-bold" class="size-8 text-primary animate-spin" />
        <div class="font-medium">{{ progress?.stage }}</div>
        <div v-if="progress?.detail" class="text-sm text-muted-foreground">{{ progress.detail }}</div>
        <p class="text-xs text-muted-foreground mt-2">首次生成需要调用模型,请稍候…</p>
      </div>

      <!-- 诊断答题阶段 -->
      <div v-else-if="phase === 'diagnostic'" class="space-y-4">
        <div class="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm text-muted-foreground">
          <Icon name="solar:test-tube-bold-duotone" class="size-4 inline-block mr-1 text-primary" />
          回答几个问题，AI 会据此调整难度与讲解风格，让课程更贴合你的水平。
        </div>
        <div class="space-y-5 max-h-[50vh] overflow-y-auto pr-1">
          <div v-for="(q, qi) in diagnosticQuestions" :key="q.id" class="space-y-2">
            <Label class="leading-snug">{{ qi + 1 }}. {{ q.question }}</Label>

            <!-- 选择题 -->
            <div v-if="q.type === 'single_choice' && q.options" class="flex flex-col gap-1.5">
              <button
                v-for="opt in q.options" :key="opt"
                type="button"
                class="text-left px-3 py-2 rounded-md border text-sm transition-colors"
                :class="answers[q.id] === opt ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-accent/50'"
                @click="answers[q.id] = opt"
              >{{ opt }}</button>
            </div>

            <!-- 量表题 -->
            <div v-else-if="q.type === 'scale' && q.scale_range" class="space-y-1.5">
              <div class="flex gap-1.5">
                <button
                  v-for="n in (q.scale_range.max - q.scale_range.min + 1)"
                  :key="n"
                  type="button"
                  class="flex-1 h-9 rounded-md border text-sm transition-colors"
                  :class="answers[q.id] === (q.scale_range.min + n - 1) ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-border text-muted-foreground hover:bg-accent/50'"
                  @click="answers[q.id] = q.scale_range.min + n - 1"
                >{{ q.scale_range.min + n - 1 }}</button>
              </div>
              <div class="flex justify-between text-[11px] text-muted-foreground">
                <span>{{ q.scale_range.min_label }}</span>
                <span>{{ q.scale_range.max_label }}</span>
              </div>
            </div>

            <!-- 文本题 -->
            <Input
              v-else
              :model-value="(answers[q.id] as string) ?? ''"
              placeholder="请输入你的回答"
              @update:model-value="answers[q.id] = String($event)"
            />

            <!-- 自定义补充（ custom_enabled） -->
            <Input
              v-if="q.custom_enabled"
              :model-value="customAnswers[q.id] ?? ''"
              :placeholder="q.custom_placeholder || '可选：补充你的具体关注点'"
              class="text-sm border-dashed"
              @update:model-value="customAnswers[q.id] = String($event)"
            />
          </div>
        </div>
      </div>

      <!-- 表单 -->
      <div v-else class="space-y-4">
        <!-- Tabs: 输入主题 vs 上传材料 -->
        <Tabs v-model="sourceTab">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="topic">输入主题</TabsTrigger>
            <TabsTrigger value="upload">上传材料</TabsTrigger>
          </TabsList>
          <TabsContent value="topic" class="space-y-2 mt-3">
            <Label>学习主题</Label>
            <Input v-model="topic" placeholder="例如:工业药剂学 / 考研高数 / Rust 入门" @keyup.enter="submit" />
          </TabsContent>
          <TabsContent value="upload" class="space-y-2 mt-3">
            <Label>上传学习材料（无大小限制）</Label>
            <div class="text-xs text-muted-foreground mb-2">
              支持：TXT、Markdown、PDF、Word (.docx / .doc)、PPT (.pptx)、图片 OCR
            </div>
            <label class="relative block border-2 border-dashed rounded-lg py-8 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/30"
                   :class="uploading && 'pointer-events-none opacity-60'">
              <input
                type="file"
                multiple
                accept=".txt,.md,.markdown,.pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                class="absolute inset-0 opacity-0 cursor-pointer"
                :disabled="uploading"
                @change="handleFileSelect"
              />
              <Icon v-if="!uploading" name="solar:upload-minimalistic-bold-duotone" class="size-8 mx-auto text-muted-foreground" />
              <Icon v-else name="solar:refresh-bold" class="size-8 mx-auto text-primary animate-spin" />
              <p v-if="!uploading" class="text-sm text-muted-foreground mt-2">点击选择文件或拖拽到此处</p>
              <p v-else class="text-sm text-muted-foreground mt-2">
                正在解析 {{ uploadProgress?.fileName }}... ({{ uploadProgress?.current }}/{{ uploadProgress?.total }})
                <span v-if="uploadProgress?.chunkProgress" class="text-xs"> {{ uploadProgress.chunkProgress }}</span>
              </p>
            </label>
            <div v-if="uploadedFiles.length" class="space-y-1.5 mt-3 max-h-[200px] overflow-y-auto pr-1">
              <div v-for="(f, i) in uploadedFiles" :key="i" class="flex items-center gap-2 text-sm py-1.5 px-2 rounded bg-muted/50">
                <Icon name="solar:document-text-bold-duotone" class="size-4 text-primary flex-shrink-0" />
                <span class="flex-1 truncate">{{ f.name }}</span>
                <button class="text-muted-foreground hover:text-destructive flex-shrink-0" @click="removeFile(i)">
                  <Icon name="solar:trash-bin-2-bold-duotone" class="size-3.5" />
                </button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div class="space-y-2">
          <Label>学习节奏</Label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="m in modes" :key="m.v"
              class="flex flex-col items-center gap-1 py-3 rounded-lg border text-sm transition-colors"
              :class="mode === m.v ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-accent/50'"
              @click="mode = m.v"
            >
              <Icon :name="m.icon" class="size-5" :class="mode === m.v && 'text-primary'" />
              <span class="font-medium">{{ m.label }}</span>
              <span class="text-[11px] opacity-70">{{ m.desc }}</span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <Label>总天数</Label>
            <Input v-model.number="totalDays" type="number" min="1" max="60" />
          </div>
          <div class="space-y-2">
            <Label>每日时长</Label>
            <Input v-model="dailyTime" placeholder="2小时" />
          </div>
        </div>

        <!-- 学习诊断开关 -->
        <button
          type="button"
          class="w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors"
          :class="useDiagnostic ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'"
          @click="useDiagnostic = !useDiagnostic"
        >
          <Icon :name="useDiagnostic ? 'solar:test-tube-bold-duotone' : 'solar:test-tube-linear'" class="size-5 shrink-0" :class="useDiagnostic ? 'text-primary' : 'text-muted-foreground'" />
          <span class="flex-1">
            <span class="block text-sm font-medium">先做学习诊断</span>
            <span class="block text-[11px] text-muted-foreground mt-0.5">回答几个问题，让课程更贴合你的水平（推荐）</span>
          </span>
          <span class="shrink-0 w-9 h-5 rounded-full transition-colors relative" :class="useDiagnostic ? 'bg-primary' : 'bg-muted-foreground/30'">
            <span class="absolute top-0.5 size-4 rounded-full bg-white transition-all" :class="useDiagnostic ? 'left-4' : 'left-0.5'" />
          </span>
        </button>
      </div>

      <!-- 表单阶段底部 -->
      <DialogFooter v-if="phase === 'form'">
        <Button variant="outline" @click="open = false">取消</Button>
        <Button
          :disabled="(sourceTab === 'topic' ? !topic.trim() : uploadedFiles.length === 0) || diagnosticLoading"
          class="gap-1.5"
          @click="submit"
        >
          <Icon :name="diagnosticLoading ? 'solar:refresh-bold' : 'solar:magic-stick-3-bold-duotone'" class="size-4" :class="diagnosticLoading && 'animate-spin'" />
          {{ diagnosticLoading ? '准备诊断…' : (useDiagnostic ? '开始诊断' : '生成课程') }}
        </Button>
      </DialogFooter>

      <!-- 诊断阶段底部 -->
      <DialogFooter v-else-if="phase === 'diagnostic'">
        <Button variant="ghost" @click="skipDiagnostic">跳过诊断</Button>
        <Button variant="outline" @click="phase = 'form'">返回</Button>
        <Button :disabled="!allAnswered" class="gap-1.5" @click="submitDiagnostic">
          <Icon name="solar:magic-stick-3-bold-duotone" class="size-4" /> 生成课程
        </Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
