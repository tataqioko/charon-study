import { defineStore } from "pinia";
import { ref } from "vue";
import {
  hasApiKey,
  saveApiKey,
  deleteApiKey,
  getApiBaseUrl,
  setCustomBaseUrl,
  clearCustomBaseUrl,
} from "@/lib/api";

const LS_MODEL = "charon:selected-model";
const LS_FAVORITES = "charon:favorite-models";

export const useSettingsStore = defineStore("settings", () => {
  const baseUrl = ref<string>("");
  const keySaved = ref<boolean>(false);
  const selectedModel = ref<string>(localStorage.getItem(LS_MODEL) ?? "");
  const favorites = ref<string[]>(
    JSON.parse(localStorage.getItem(LS_FAVORITES) ?? "[]")
  );

  async function init() {
    baseUrl.value = await getApiBaseUrl();
    keySaved.value = await hasApiKey();
  }

  async function setKey(key: string) {
    await saveApiKey(key);
    keySaved.value = true;
  }

  async function clearKey() {
    await deleteApiKey();
    keySaved.value = false;
  }

  async function setBaseUrl(url: string) {
    await setCustomBaseUrl(url);
    baseUrl.value = url;
  }

  async function resetBaseUrl() {
    await clearCustomBaseUrl();
    baseUrl.value = await getApiBaseUrl();
  }

  function setModel(id: string) {
    selectedModel.value = id;
    localStorage.setItem(LS_MODEL, id);
  }

  function toggleFavorite(id: string) {
    const i = favorites.value.indexOf(id);
    if (i >= 0) favorites.value.splice(i, 1);
    else favorites.value.push(id);
    localStorage.setItem(LS_FAVORITES, JSON.stringify(favorites.value));
  }

  return {
    baseUrl,
    keySaved,
    selectedModel,
    favorites,
    init,
    setKey,
    clearKey,
    setBaseUrl,
    resetBaseUrl,
    setModel,
    toggleFavorite,
  };
});
