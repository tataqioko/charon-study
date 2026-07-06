// 统一的材料检索助手：返回材料引用
// 优先使用知识单元引用，回退到 RAG
import { retrieveWithSlidingWindow } from "./slidingWindow";
import { generateMaterialRefs, type MaterialRef } from "./materialRef";

export interface MaterialRetrievalResult {
  mode: 'refs' | 'content';
  refs?: MaterialRef[];
  content?: string;
}

export async function retrieveMaterialsForTopic(
  courseId: number,
  topicTitle: string,
  topicScope: string[],
  learningGoal: string,
  knowledgeBase: string | null,
  dayIndex: number = 1
): Promise<MaterialRetrievalResult> {
  if (!knowledgeBase) {
    return { mode: 'content', content: undefined };
  }

  console.log(`[材料检索] 第 ${dayIndex} 天`);

  // 方法1：滑动窗口选单元（返回段引用）——已按 topicScope 匹配 + 覆盖率补足
  const windowResult = await trySlidingWindowMode(courseId, dayIndex, topicScope);
  if (windowResult) return windowResult;

  // 方法2：回退到 RAG 模式（返回完整内容）——无知识单元或匹配为空时兜底
  const ragContent = await tryRAGMode(topicTitle, topicScope, learningGoal, knowledgeBase, 15000);
  return { mode: 'content', content: ragContent };
}

async function trySlidingWindowMode(
  courseId: number,
  dayIndex: number,
  topicScope: string[]
): Promise<MaterialRetrievalResult | undefined> {
  try {
    // 使用滑动窗口选择知识单元（会自动记录材料使用情况）
    const { unitIds } = await retrieveWithSlidingWindow(courseId, dayIndex, topicScope, 3);
    if (unitIds.length === 0) return undefined;

    // 生成材料引用
    const refs = await generateMaterialRefs(courseId, unitIds);
    if (refs.length === 0) return undefined; // 空引用不算成功，继续回退

    console.log(`[滑动窗口] 检索到 ${refs.length} 个单元，总计 ${refs.reduce((sum, r) => sum + r.char_count, 0)} 字符`);
    return { mode: 'refs', refs };
  } catch (e) {
    console.warn("滑动窗口模式失败，回退:", e);
    return undefined;
  }
}

async function tryRAGMode(
  topicTitle: string,
  topicScope: string[],
  learningGoal: string,
  knowledgeBase: string,
  maxChars: number
): Promise<string | undefined> {
  try {
    const { chunkKnowledgeBase, retrieveRelevantChunks, formatRetrievedContext } =
      await import("@/lib/knowledgeRetrieval");

    const chunks = chunkKnowledgeBase(knowledgeBase);
    const query = `${topicTitle} ${learningGoal} ${topicScope.join(' ')}`;
    const relevantChunks = retrieveRelevantChunks(chunks, query, 10);
    console.log(`[RAG 模式] 检索到 ${relevantChunks.length} 个相关块`);
    return formatRetrievedContext(relevantChunks, maxChars);
  } catch (e) {
    console.warn("RAG 模式失败:", e);
    return undefined;
  }
}
