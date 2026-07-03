import { ref, watch } from "vue";

export type ThemeMode = "light" | "dark";
const LS_KEY = "charon:theme";

const mode = ref<ThemeMode>(
  (localStorage.getItem(LS_KEY) as ThemeMode) ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);

function apply(m: ThemeMode) {
  document.documentElement.classList.toggle("dark", m === "dark");
}
apply(mode.value);
watch(mode, (m) => {
  apply(m);
  localStorage.setItem(LS_KEY, m);
});

export function useTheme() {
  function toggle() {
    mode.value = mode.value === "dark" ? "light" : "dark";
  }
  return { mode, toggle };
}
