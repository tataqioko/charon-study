<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { motion, AnimatePresence } from "motion-v";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import Icon from "@/components/Icon.vue";
import { listModelsWithKey, saveApiKey, openExternal } from "@/lib/api";
import { useSettingsStore } from "@/stores/settings";

const router = useRouter();
const settings = useSettingsStore();

type Step = "welcome" | "key" | "model";
const step = ref<Step>("welcome");

const keyInput = ref("");
const validating = ref(false);
const errorMsg = ref("");
const models = ref<string[]>([]);
const chosenModel = ref("");

const canValidate = computed(() => keyInput.value.trim().length > 0 && !validating.value);

async function validateKey() {
  errorMsg.value = "";
  validating.value = true;
  try {
    const list = await listModelsWithKey(keyInput.value.trim());
    if (!list.length) {
      errorMsg.value = "校验成功,但该站点没有可用模型。";
      return;
    }
    models.value = list.map((m) => m.id);
    chosenModel.value = models.value[0];
    step.value = "model";
  } catch (e) {
    errorMsg.value = `校验失败:${String(e)}。请检查 Key 是否正确。`;
  } finally {
    validating.value = false;
  }
}

async function finish() {
  await saveApiKey(keyInput.value.trim());
  settings.keySaved = true;
  settings.setModel(chosenModel.value);
  router.replace("/app");
}

function openKeyPage() {
  // 引导去站点获取 key
  openExternal("https://api.nktp.top/").catch(() => {});
}
</script>

<template>
  <AuroraBackground class="!h-full" :radial-gradient="false">
    <div class="relative z-10 w-full max-w-md px-6">
      <AnimatePresence mode="wait">
        <!-- 步骤 1:欢迎 -->
        <motion.div
          v-if="step === 'welcome'"
          key="welcome"
          :initial="{ opacity: 0, y: 20 }"
          :animate="{ opacity: 1, y: 0 }"
          :exit="{ opacity: 0, y: -20 }"
          :transition="{ duration: 0.5 }"
          class="flex flex-col items-center gap-6 text-center"
        >
          <div class="size-16 rounded-2xl bg-primary text-primary-foreground grid place-items-center text-3xl font-bold shadow-xl shadow-primary/30">
            C
          </div>
          <TextGenerateEffect
            words="Charon-Study 你的 AI 学习摆渡人"
            class="text-3xl font-bold tracking-tight"
          />
          <p class="text-muted-foreground leading-relaxed">
            上传材料或输入主题,AI 为你生成个性化学习计划、每日讲义与测验,陪你从「不会」渡到「会」。
          </p>
          <Button size="lg" class="gap-2 mt-2" @click="step = 'key'">
            <Icon name="solar:rocket-2-bold-duotone" class="size-5" />
            开始配置
          </Button>
        </motion.div>

        <!-- 步骤 2:填 key -->
        <motion.div
          v-else-if="step === 'key'"
          key="key"
          :initial="{ opacity: 0, x: 30 }"
          :animate="{ opacity: 1, x: 0 }"
          :exit="{ opacity: 0, x: -30 }"
          :transition="{ duration: 0.4 }"
          class="flex flex-col gap-5"
        >
          <div class="text-center">
            <Icon name="solar:key-minimalistic-square-bold-duotone" class="size-12 text-primary mx-auto" />
            <h2 class="text-2xl font-bold tracking-tight mt-3">输入你的 API Key</h2>
            <p class="text-sm text-muted-foreground mt-1">Key 会安全保存在本机凭据管理器,不上传任何地方。</p>
          </div>
          <Input
            v-model="keyInput"
            type="password"
            placeholder="粘贴你的 API Key…"
            @keyup.enter="canValidate && validateKey()"
          />
          <p v-if="errorMsg" class="text-sm text-destructive">{{ errorMsg }}</p>
          <Button :disabled="!canValidate" class="gap-2" @click="validateKey">
            <Icon v-if="validating" name="solar:refresh-bold" class="size-4 animate-spin" />
            <Icon v-else name="solar:check-circle-bold-duotone" class="size-4" />
            {{ validating ? "校验中…" : "校验并继续" }}
          </Button>
          <div class="flex items-center justify-between text-sm">
            <button class="text-muted-foreground hover:text-foreground transition-colors" @click="step = 'welcome'">← 返回</button>
            <button class="text-primary hover:underline flex items-center gap-1" @click="openKeyPage">
              <Icon name="solar:link-bold" class="size-3.5" /> 如何获取 Key
            </button>
          </div>
        </motion.div>

        <!-- 步骤 3:选模型 -->
        <motion.div
          v-else
          key="model"
          :initial="{ opacity: 0, x: 30 }"
          :animate="{ opacity: 1, x: 0 }"
          :exit="{ opacity: 0, x: -30 }"
          :transition="{ duration: 0.4 }"
          class="flex flex-col gap-5"
        >
          <div class="text-center">
            <Icon name="solar:cpu-bolt-bold-duotone" class="size-12 text-primary mx-auto" />
            <h2 class="text-2xl font-bold tracking-tight mt-3">选择默认模型</h2>
            <p class="text-sm text-muted-foreground mt-1">已拉取到 {{ models.length }} 个模型,选一个作为默认。</p>
          </div>
          <Select v-model="chosenModel">
            <SelectTrigger class="w-full"><SelectValue placeholder="选择模型…" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="m in models" :key="m" :value="m">{{ m }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button :disabled="!chosenModel" class="gap-2" @click="finish">
            <Icon name="solar:arrow-right-bold-duotone" class="size-4" />
            进入 Charon-Study
          </Button>
          <button class="text-sm text-muted-foreground hover:text-foreground transition-colors text-center" @click="step = 'key'">← 换个 Key</button>
        </motion.div>
      </AnimatePresence>
    </div>
  </AuroraBackground>
</template>
