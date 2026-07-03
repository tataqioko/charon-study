import { ref, watch } from "vue";

// 讲义阅读偏好:字号 + 内容宽度 + 专注模式,持久化到 localStorage
const LS_FONT = "charon:reader-font";
const LS_WIDTH = "charon:reader-width";
const LS_FOCUS = "charon:reader-focus";

const fontScale = ref<number>(Number(localStorage.getItem(LS_FONT)) || 100);
// 正文宽度百分比(50–100):100=铺满阅读区,50=舒适窄栏。默认 62(约等于原 768px 观感)
// 兼容旧版本存的是 px 值(>100),自动折算回一个合理的百分比默认值
const rawWidth = Number(localStorage.getItem(LS_WIDTH));
const contentWidth = ref<number>(rawWidth > 0 && rawWidth <= 100 ? rawWidth : 62);
const focusMode = ref<boolean>(localStorage.getItem(LS_FOCUS) === "1");

watch(fontScale, (v) => localStorage.setItem(LS_FONT, String(v)));
watch(contentWidth, (v) => localStorage.setItem(LS_WIDTH, String(v)));
watch(focusMode, (v) => localStorage.setItem(LS_FOCUS, v ? "1" : "0"));

export function useReaderPrefs() {
  function bigger() {
    fontScale.value = Math.min(240, fontScale.value + 10);
  }
  function smaller() {
    fontScale.value = Math.max(60, fontScale.value - 10);
  }
  function toggleFocus() {
    focusMode.value = !focusMode.value;
  }
  return { fontScale, contentWidth, focusMode, bigger, smaller, toggleFocus };
}
