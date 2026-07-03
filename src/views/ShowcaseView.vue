<script setup lang="ts">
import { ref } from "vue";
import { motion } from "motion-v";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";

const nav = [
  { label: "我的课程", icon: "solar:book-2-bold-duotone", active: true },
  { label: "全局搜索", icon: "solar:magnifer-bold-duotone", active: false },
  { label: "复习中心", icon: "solar:refresh-circle-bold-duotone", active: false },
  { label: "学习统计", icon: "solar:chart-2-bold-duotone", active: false },
  { label: "设置", icon: "solar:settings-bold-duotone", active: false },
];

const courses = [
  { title: "工业药剂学", tag: "应试备考", day: "Day 3 / 10", pct: 60, meta: "距考试 7 天", accent: true },
  { title: "高等数学", tag: "日常学习", day: "Day 1 / 14", pct: 12, meta: "常规节奏", accent: false },
];

const reminder = ref(true);
const focusMode = ref(false);
const apiKey = ref("");
const model = ref("");
</script>

<template>
  <div class="flex h-screen bg-background text-foreground">
    <!-- 侧边栏 -->
    <aside class="w-56 shrink-0 border-r bg-muted/30 flex flex-col">
      <div class="h-14 px-5 flex items-center gap-2.5 border-b">
        <div class="size-7 rounded-lg bg-primary text-primary-foreground grid place-items-center text-sm font-bold">C</div>
        <span class="font-semibold tracking-tight">Charon-Study</span>
      </div>
      <nav class="p-2 flex flex-col gap-1">
        <button
          v-for="item in nav" :key="item.label"
          class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left"
          :class="item.active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'"
        >
          <Icon :name="item.icon" class="size-4" />
          {{ item.label }}
        </button>
      </nav>
      <div class="mt-auto p-3 text-xs text-muted-foreground flex items-center gap-1.5">
        <span class="size-1.5 rounded-full bg-green-500" /> 已连接
      </div>
    </aside>

    <!-- 主区 -->
    <main class="flex-1 overflow-auto">
      <div class="max-w-4xl mx-auto px-8 py-8">
        <motion.div
          :initial="{ opacity: 0, y: 12 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.4 }"
        >
          <h1 class="text-2xl font-bold tracking-tight">我的课程</h1>
          <p class="text-sm text-muted-foreground mt-1">2 个进行中 · 今日待复习 12 张卡片</p>
        </motion.div>

        <!-- 课程卡片 -->
        <div class="grid grid-cols-2 gap-4 mt-6">
          <motion.div
            v-for="(c, i) in courses" :key="c.title"
            :initial="{ opacity: 0, y: 16 }"
            :animate="{ opacity: 1, y: 0 }"
            :transition="{ duration: 0.4, delay: 0.1 + i * 0.08 }"
            :while-hover="{ y: -4 }"
          >
            <Card class="cursor-pointer transition-shadow hover:shadow-lg">
              <CardHeader>
                <div class="flex items-center justify-between">
                  <Badge :variant="c.accent ? 'default' : 'secondary'">{{ c.tag }}</Badge>
                  <span class="text-xs text-muted-foreground">{{ c.day }}</span>
                </div>
                <CardTitle class="mt-2">{{ c.title }}</CardTitle>
              </CardHeader>
              <CardContent>
                <div class="h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    class="h-full rounded-full bg-primary"
                    :initial="{ width: 0 }"
                    :animate="{ width: c.pct + '%' }"
                    :transition="{ duration: 0.8, delay: 0.3 }"
                  />
                </div>
                <div class="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>已完成 {{ c.pct }}%</span><span>{{ c.meta }}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <Separator class="my-8" />

        <!-- 设置面板(真表单组件) -->
        <motion.div
          :initial="{ opacity: 0, y: 16 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.4, delay: 0.25 }"
        >
          <Card>
            <CardHeader>
              <CardTitle class="flex items-center gap-2"><Icon name="solar:magic-stick-3-bold-duotone" class="size-4" /> 新建课程</CardTitle>
              <CardDescription>填入设置,一键生成个性化课程</CardDescription>
            </CardHeader>
            <CardContent class="space-y-5">
              <Tabs default-value="topic">
                <TabsList>
                  <TabsTrigger value="topic">输入主题</TabsTrigger>
                  <TabsTrigger value="upload">上传材料</TabsTrigger>
                </TabsList>
                <TabsContent value="topic" class="pt-4">
                  <div class="space-y-2">
                    <Label>学习主题</Label>
                    <Input v-model="apiKey" placeholder="例如:工业药剂学 / 考研高数…" />
                  </div>
                </TabsContent>
                <TabsContent value="upload" class="pt-4">
                  <div class="border border-dashed rounded-lg py-8 text-center text-sm text-muted-foreground">
                    拖入 PDF / Word / PPT,或点击选择
                  </div>
                </TabsContent>
              </Tabs>

              <div class="space-y-2">
                <Label>选择模型</Label>
                <Select v-model="model">
                  <SelectTrigger class="w-full"><SelectValue placeholder="选择一个模型…" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="gpt-4o">gpt-4o</SelectItem>
                      <SelectItem value="claude-sonnet">claude-sonnet</SelectItem>
                      <SelectItem value="deepseek-v3">deepseek-v3</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-sm"><Icon name="solar:clock-circle-bold-duotone" class="size-4 text-muted-foreground" /> 每日学习提醒</div>
                <Switch v-model="reminder" />
              </div>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-sm"><Icon name="solar:target-bold-duotone" class="size-4 text-muted-foreground" /> 专注模式</div>
                <Switch v-model="focusMode" />
              </div>
            </CardContent>
            <CardFooter class="justify-end gap-2">
              <Button variant="outline">保存草稿</Button>
              <Dialog>
                <DialogTrigger as-child>
                  <Button>开始生成</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>确认生成课程?</DialogTitle>
                    <DialogDescription>将用当前设置生成学习计划,这会调用你选择的模型。</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
                    <DialogClose as-child><Button>确认</Button></DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </main>
  </div>
</template>
