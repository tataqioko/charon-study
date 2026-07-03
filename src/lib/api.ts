// 前端 API 层:封装对 Rust 后端的 invoke 调用
import { invoke, Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** 用系统默认浏览器打开外部链接 */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

export interface ModelInfo {
  id: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { type: "chunk"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** 锁死的站点地址(仅用于展示) */
export function getApiBaseUrl(): Promise<string> {
  return invoke<string>("get_api_base_url");
}

/** 保存 API key 到系统凭据管理器 */
export function saveApiKey(key: string): Promise<void> {
  return invoke<void>("save_api_key", { key });
}

/** 是否已保存 key */
export function hasApiKey(): Promise<boolean> {
  return invoke<boolean>("has_api_key");
}

/** 删除已保存的 key */
export function deleteApiKey(): Promise<void> {
  return invoke<void>("delete_api_key");
}

/** 拉取模型列表(用已保存的 key) */
export function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models");
}

/** 用传入的 key 校验并拉模型(首启实时校验,不预先保存) */
export function listModelsWithKey(key: string): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models_with_key", { key });
}

/**
 * 流式对话。onEvent 逐块回调,返回的 Promise 在流结束/出错时 resolve/reject。
 */
export function chatStream(
  model: string,
  messages: ChatMessage[],
  onEvent: (e: StreamEvent) => void
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("chat_stream", { model, messages, onEvent: channel });
}

/** 非流式对话:一次返回完整文本(生成结构化 JSON 用) */
export function chatOnce(
  model: string,
  messages: ChatMessage[],
  temperature?: number
): Promise<string> {
  return invoke<string>("chat_once", { model, messages, temperature });
}

/** 设置自定义站点（仅开发模式） */
export function setCustomBaseUrl(url: string): Promise<void> {
  return invoke<void>("set_custom_base_url", { url });
}

/** 清除自定义站点（仅开发模式） */
export function clearCustomBaseUrl(): Promise<void> {
  return invoke<void>("clear_custom_base_url");
}
