<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { motion } from "motion-v";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores/settings";
import { listModels, listModelsWithKey, openExternal } from "@/lib/api";

const settings = useSettingsStore();
const router = useRouter();

const newKey = ref("");
const savingKey = ref(false);
const models = ref<string[]>([]);
const loadingModels = ref(false);
const search = ref("");
const customMode = ref(false); // 自定义模式
const customBaseUrl = ref(""); // 自定义站点

onMounted(async () => {
  await settings.init();
  customBaseUrl.value = settings.baseUrl;
  if (settings.keySaved) refreshModels();
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = q ? models.value.filter((m) => m.toLowerCase().includes(q)) : models.value;
  return [...list].sort((a, b) => {
    const fa = settings.favorites.includes(a) ? 0 : 1;
    const fb = settings.favorites.includes(b) ? 0 : 1;
    return fa - fb;
  });
});

async function saveKey() {
  if (!newKey.value.trim()) return;
  savingKey.value = true;
  try {
    // 如果是自定义模式，先保存自定义站点
    if (customMode.value && customBaseUrl.value.trim()) {
      await settings.setBaseUrl(customBaseUrl.value.trim());
    }
    await listModelsWithKey(newKey.value.trim());
    await settings.setKey(newKey.value.trim());
    newKey.value = "";
    toast.success("Key 已保存并校验通过");
    refreshModels();
  } catch (e) {
    toast.error(`校验失败:${String(e)}`);
  } finally {
    savingKey.value = false;
  }
}

async function toggleCustomMode() {
  customMode.value = !customMode.value;
  if (!customMode.value) {
    // 退出自定义模式，恢复默认站点
    await settings.resetBaseUrl();
    customBaseUrl.value = settings.baseUrl;
  }
}

async function refreshModels() {
  loadingModels.value = true;
  try {
    const list = await listModels();
    models.value = list.map((m) => m.id);
    toast.success(`已拉取 ${models.value.length} 个模型`);
  } catch (e) {
    toast.error(`拉取模型失败:${String(e)}`);
  } finally {
    loadingModels.value = false;
  }
}

async function clearKey() {
  await settings.clearKey();
  models.value = [];
  toast.info("已清除 Key,返回首启引导");
  router.replace("/onboarding");
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-8 py-8">
    <motion.div :initial="{ opacity: 0, y: 12 }" :animate="{ opacity: 1, y: 0 }" :transition="{ duration: 0.4 }">
      <h1 class="text-2xl font-bold tracking-tight">设置</h1>
      <p class="text-sm text-muted-foreground mt-1">管理 API 连接与默认模型</p>
    </motion.div>

    <Card class="mt-6">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><Icon name="solar:link-circle-bold-duotone" class="size-5 text-primary" /> API 连接</CardTitle>
        <CardDescription>
          {{ customMode ? "自定义模式：使用你自己的 API 站点" : "站点已锁定,你只需提供 Key" }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-muted-foreground w-16">站点</span>
          <Input
            v-if="customMode"
            v-model="customBaseUrl"
            placeholder="https://your-api.com/v1"
            class="h-7 text-xs flex-1"
          />
          <code v-else class="px-2 py-1 rounded bg-muted text-xs">{{ settings.baseUrl }}</code>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <span class="text-muted-foreground w-16">状态</span>
          <span class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full" :class="settings.keySaved ? 'bg-green-500' : 'bg-muted-foreground/40'" />
            {{ settings.keySaved ? "已配置 Key" : "未配置" }}
          </span>
        </div>
        <Separator />
        <div class="space-y-2">
          <label class="text-sm font-medium">{{ settings.keySaved ? "更换 Key" : "填入 Key" }}</label>
          <div class="flex gap-2">
            <Input v-model="newKey" type="password" placeholder="粘贴新的 API Key…" @keyup.enter="saveKey" />
            <Button :disabled="!newKey.trim() || savingKey" class="gap-1.5 shrink-0" @click="saveKey">
              <Icon :name="savingKey ? 'solar:refresh-bold' : 'solar:diskette-bold-duotone'" :class="['size-4', savingKey && 'animate-spin']" />
              保存
            </Button>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <button class="text-xs text-primary hover:underline flex items-center gap-1" @click="openExternal(settings.baseUrl)">
              <Icon name="solar:link-bold" class="size-3.5" /> 获取 Key
            </button>
            <button
              class="text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="toggleCustomMode"
            >
              自有模型？
            </button>
          </div>
          <Button v-if="settings.keySaved" variant="ghost" size="sm" class="text-destructive gap-1.5" @click="clearKey">
            <Icon name="solar:trash-bin-trash-bold-duotone" class="size-4" /> 清除 Key 并重测首启
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle class="flex items-center gap-2"><Icon name="solar:cpu-bolt-bold-duotone" class="size-5 text-primary" /> 模型</CardTitle>
            <CardDescription class="mt-1">当前默认:<code class="text-xs">{{ settings.selectedModel || "未选择" }}</code></CardDescription>
          </div>
          <Button variant="outline" size="sm" class="gap-1.5" :disabled="!settings.keySaved || loadingModels" @click="refreshModels">
            <Icon name="solar:refresh-bold" :class="['size-4', loadingModels && 'animate-spin']" /> 刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <Input v-model="search" placeholder="搜索模型…" :disabled="!models.length" />
        <div v-if="!models.length" class="text-sm text-muted-foreground py-6 text-center">
          {{ settings.keySaved ? "点击刷新拉取模型列表" : "先配置 Key" }}
        </div>
        <div v-else class="max-h-72 overflow-auto flex flex-col gap-1 pr-1">
          <button
            v-for="m in filtered" :key="m"
            class="flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors text-left group"
            :class="settings.selectedModel === m ? 'bg-accent text-foreground font-medium' : 'hover:bg-accent/50'"
            @click="settings.setModel(m); toast.success('已设为默认:' + m)"
          >
            <span class="flex items-center gap-2 truncate">
              <Icon v-if="settings.selectedModel === m" name="solar:check-circle-bold" class="size-4 text-primary shrink-0" />
              <span class="truncate">{{ m }}</span>
            </span>
            <span
              class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              :class="settings.favorites.includes(m) && 'opacity-100'"
              @click.stop="settings.toggleFavorite(m)"
            >
              <Icon :name="settings.favorites.includes(m) ? 'solar:star-bold' : 'solar:star-linear'" :class="['size-4', settings.favorites.includes(m) ? 'text-amber-400' : 'text-muted-foreground']" />
            </span>
          </button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
