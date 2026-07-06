// 材料上下文准备（确定性注入）
// 不再用 LLM 工具调用按需拉取，而是：检索得到相关材料引用后，
// 直接、确定性地把每个引用的原文按「覆盖清单(manifest) + 原文摘录(excerpt)」拼接进上下文。
// ref 只是归因锚点，材料由系统确定性解析注入。

import { resolveMaterialRef, type MaterialRef } from "@/lib/materialRef";

export interface PreparedContext {
  /** 注入到生成 prompt 的上下文段落（已含材料原文或空串） */
  contextSection: string;
  /** 本次实际用到的知识单元 ID（用于生成后记录覆盖率） */
  usedUnitIds: string[];
}

/**
 * 格式化「课程材料覆盖清单」。
 * 只列出 ref/标题/字符数/来源，作为注入原文前的索引。
 */
function formatCoverageManifest(refs: MaterialRef[]): string {
  const lines = ["【课程材料覆盖清单】", "本节将基于以下材料单元讲解（原文见下方摘录）："];
  for (const r of refs) {
    lines.push(
      `- ${r.ref} | ${r.title} | ${r.char_count.toLocaleString()} 字符 | 来源：${r.source_files.join("、") || "未知"}`
    );
  }
  return lines.join("\n");
}

/**
 * 为某节内容准备材料上下文（确定性注入版）：
 * 1. 检索得到可用材料引用（滑动窗口 / 知识单元 / RAG）
 * 2. refs 模式 → 逐个确定性解析原文，按 manifest + excerpt 拼接注入
 * 3. content 模式（RAG）→ 直接注入检索到的内容
 *
 * 返回的 usedUnitIds 供调用方在内容成功落库后调用 recordMaterialUsage。
 */
export async function prepareMaterialContext(
  courseId: number,
  topicTitle: string,
  topicScope: string[],
  learningGoal: string,
  knowledgeBase: string | null,
  dayIndex: number
): Promise<PreparedContext> {
  const { retrieveMaterialsForTopic } = await import("@/lib/materialRetrieval");

  const retrievalResult = await retrieveMaterialsForTopic(
    courseId,
    topicTitle,
    topicScope,
    learningGoal,
    knowledgeBase,
    dayIndex
  );

  // refs 模式：确定性解析每个引用的原文，按 manifest + excerpt 注入
  if (retrievalResult.mode === "refs" && retrievalResult.refs && retrievalResult.refs.length > 0) {
    const refs = retrievalResult.refs;
    const excerpts: string[] = [];
    const usedUnitIds: string[] = [];

    for (const ref of refs) {
      try {
        const content = await resolveMaterialRef(courseId, ref.ref);
        excerpts.push(`【材料原文摘录 ref=${ref.ref} 标题=${ref.title}】\n${content}`);
        usedUnitIds.push(ref.unit_id);
      } catch (e) {
        console.warn(`[材料注入] 解析 ${ref.ref} 失败:`, e);
      }
    }

    if (excerpts.length > 0) {
      const manifest = formatCoverageManifest(refs);
      const contextSection =
        `\n\n${manifest}\n\n${excerpts.join("\n\n---\n\n")}\n\n` +
        `请严格基于上述材料原文讲解、举例与出题，不要脱离材料凭空编造。`;
      console.log(`[材料注入] 确定性注入 ${usedUnitIds.length} 个材料单元：${usedUnitIds.join(", ")}`);
      return { contextSection, usedUnitIds };
    }

    return { contextSection: "", usedUnitIds: [] };
  }

  // content 模式（RAG）：直接注入检索内容
  if (retrievalResult.mode === "content" && retrievalResult.content) {
    return {
      contextSection: `\n\n${retrievalResult.content}\n\n请严格基于上述材料内容生成。`,
      usedUnitIds: [],
    };
  }

  return { contextSection: "", usedUnitIds: [] };
}
