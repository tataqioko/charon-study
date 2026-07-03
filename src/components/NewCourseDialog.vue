<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { useSettingsStore } from "@/stores/settings";
import { generateCourse, type GenProgress } from "@/lib/courseGen";

const emit = defineEmits<{ created: [] }>();
const settings = useSettingsStore();
const router = useRouter();

const open = ref(false);
const sourceTab = ref<"topic" | "upload">("topic");
const topic = ref("");
const uploadedFiles = ref<{ name: string; content: string }[]>([]);
const mode = ref<"daily" | "sprint" | "leisure">("daily");
const totalDays = ref(7);
const dailyTime = ref("2小时");
const generating = ref(false);
const progress = ref<GenProgress | null>(null);

const modes = [
  { v: "sprint", label: "冲刺", icon: "solar:bolt-bold-duotone", desc: "紧凑高强度" },
  { v: "daily", label: "常规", icon: "solar:calendar-bold-duotone", desc: "稳扎稳打" },
  { v: "leisure", label: "休闲", icon: "solar:cup-hot-bold-duotone", desc: "轻松循序" },
] as const;

async function handleFileSelect(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  for (const f of files) {
    if (f.size > 5 * 1024 * 1024) {
      toast.error(`${f.name} 超过 5MB,跳过`);
      continue;
    }
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["txt", "md", "markdown"].includes(ext ?? "")) {
      toast.error(`${f.name} 格式不支持,当前仅支持 txt/md`);
      continue;
    }
    try {
      const content = await f.text();
      uploadedFiles.value.push({ name: f.name, content });
      toast.success(`已读取 ${f.name}`);
    } catch {
      toast.error(`读取 ${f.name} 失败`);
    }
  }
}

function removeFile(idx: number) {
  uploadedFiles.value.splice(idx, 1);
}

async function submit() {
  let finalTopic = "";
  let knowledgeBase: string | null = null;

  if (sourceTab.value === "topic") {
    if (!topic.value.trim()) return;
    finalTopic = topic.value.trim();
  } else {
    if (!uploadedFiles.value.length) {
      toast.error("请先上传至少一个文件");
      return;
    }
    finalTopic = uploadedFiles.value[0].name.replace(/\.(txt|md|markdown)$/i, "");
    knowledgeBase = uploadedFiles.value.map((f) => `### ${f.name}\n\n${f.content}`).join("\n\n---\n\n");
  }

  if (!settings.selectedModel) {
    toast.error("请先在设置里选择模型");
    return;
  }
  generating.value = true;
  progress.value = { stage: "准备中" };
  try {
    const id = await generateCourse(
      {
        topic: finalTopic,
        mode: mode.value,
        totalDays: totalDays.value,
        dailyTime: dailyTime.value,
        model: settings.selectedModel,
        knowledgeBase,
      },
      (p) => (progress.value = p)
    );
    toast.success("课程生成完成");
    open.value = false;
    emit("created");
    router.push(`/app/study/${id}`);
  } catch (e) {
    toast.error(String(e));
  } finally {
    generating.value = false;
    progress.value = null;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button class="gap-2"><Icon name="solar:add-circle-bold-duotone" class="size-4" /> 新建课程</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>新建课程</DialogTitle>
        <DialogDescription>输入主题,AI 为你生成个性化学习计划</DialogDescription>
      </DialogHeader>

      <!-- 生成中:显示进度 -->
      <div v-if="generating" class="py-8 flex flex-col items-center gap-3 text-center">
        <Icon name="solar:refresh-bold" class="size-8 text-primary animate-spin" />
        <div class="font-medium">{{ progress?.stage }}</div>
        <div v-if="progress?.detail" class="text-sm text-muted-foreground">{{ progress.detail }}</div>
        <p class="text-xs text-muted-foreground mt-2">首次生成需要调用模型,请稍候…</p>
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
            <Label>上传文本材料（txt / md，单文件 ≤5MB）</Label>
            <label class="relative block border-2 border-dashed rounded-lg py-8 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/30">
              <input type="file" multiple accept=".txt,.md,.markdown" class="absolute inset-0 opacity-0 cursor-pointer" @change="handleFileSelect" />
              <Icon name="solar:upload-minimalistic-bold-duotone" class="size-8 mx-auto text-muted-foreground" />
              <p class="text-sm text-muted-foreground mt-2">点击选择文件</p>
            </label>
            <div v-if="uploadedFiles.length" class="space-y-1.5 mt-3">
              <div v-for="(f, i) in uploadedFiles" :key="i" class="flex items-center gap-2 text-sm py-1.5 px-2 rounded bg-muted/50">
                <Icon name="solar:document-text-bold-duotone" class="size-4 text-primary" />
                <span class="flex-1 truncate">{{ f.name }}</span>
                <button class="text-muted-foreground hover:text-destructive" @click="removeFile(i)">
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
      </div>

      <DialogFooter v-if="!generating">
        <Button variant="outline" @click="open = false">取消</Button>
        <Button :disabled="!topic.trim()" class="gap-1.5" @click="submit">
          <Icon name="solar:magic-stick-3-bold-duotone" class="size-4" /> 生成课程
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
