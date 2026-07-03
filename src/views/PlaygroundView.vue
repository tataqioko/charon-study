<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { toast } from "vue-sonner";
import Icon from "@/components/Icon.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings";
import { chatStream, type ChatMessage } from "@/lib/api";

const settings = useSettingsStore();
const input = ref("");
const streaming = ref(false);
const messages = ref<ChatMessage[]>([]);
const scrollEl = ref<HTMLElement | null>(null);

onMounted(() => settings.init());

async function scrollBottom() {
  await nextTick();
  scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight, behavior: "smooth" });
}

async function send() {
  const text = input.value.trim();
  if (!text || streaming.value) return;
  if (!settings.selectedModel) {
    toast.error("请先在设置里选择模型");
    return;
  }
  input.value = "";
  messages.value.push({ role: "user", content: text });
  messages.value.push({ role: "assistant", content: "" });
  const idx = messages.value.length - 1;
  streaming.value = true;
  scrollBottom();

  try {
    await chatStream(
      settings.selectedModel,
      messages.value.slice(0, -1),
      (e) => {
        if (e.type === "chunk") {
          messages.value[idx].content += e.content;
          scrollBottom();
        } else if (e.type === "error") {
          messages.value[idx].content += `\n[错误] ${e.message}`;
          toast.error(e.message);
        }
      }
    );
  } catch (e) {
    toast.error(`对话失败:${String(e)}`);
    messages.value[idx].content += `\n[失败] ${String(e)}`;
  } finally {
    streaming.value = false;
  }
}

function clear() {
  messages.value = [];
}
</script>

<template>
  <div class="flex flex-col h-full max-w-3xl mx-auto w-full">
    <div class="px-8 pt-8 pb-4 flex items-center justify-between shrink-0">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">对话调试台</h1>
        <p class="text-sm text-muted-foreground mt-1">
          验证流式对话 · 模型:<code class="text-xs">{{ settings.selectedModel || "未选择" }}</code>
        </p>
      </div>
      <Button v-if="messages.length" variant="ghost" size="sm" class="gap-1.5" @click="clear">
        <Icon name="solar:eraser-bold-duotone" class="size-4" /> 清空
      </Button>
    </div>

    <div ref="scrollEl" class="flex-1 overflow-auto px-8 space-y-4">
      <div v-if="!messages.length" class="h-full grid place-items-center text-center text-muted-foreground">
        <div>
          <Icon name="solar:chat-round-dots-bold-duotone" class="size-12 mx-auto text-primary/40" />
          <p class="mt-3 text-sm">发一条消息,验证能否流式对话</p>
        </div>
      </div>
      <div
        v-for="(m, i) in messages" :key="i"
        class="flex gap-3"
        :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
          :class="m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'"
        >
          {{ m.content }}<span v-if="m.role === 'assistant' && streaming && i === messages.length - 1" class="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse align-middle" />
        </div>
      </div>
    </div>

    <div class="p-4 shrink-0 border-t">
      <div class="flex gap-2">
        <Input v-model="input" placeholder="输入消息,回车发送…" :disabled="streaming" @keyup.enter="send" />
        <Button :disabled="!input.trim() || streaming" class="gap-1.5 shrink-0" @click="send">
          <Icon :name="streaming ? 'solar:refresh-bold' : 'solar:plain-2-bold-duotone'" :class="['size-4', streaming && 'animate-spin']" />
          发送
        </Button>
      </div>
    </div>
  </div>
</template>
