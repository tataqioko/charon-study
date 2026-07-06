// 入库时切段（段级材料管理）
// 把上传的多文件知识库按「文件 → 有界小段」确定性切分，每段一个稳定 ref
// （material:<material_index>:seg_<seg_index>），并落库到 material_segments。
// 这样后续讲义/测验生成只需注入知识单元真正绑定的那几段原文，
// 单次模型调用的上下文天然有界，资料再大也不会撑爆上下文。

import { parseKnowledgeBaseToMap } from "@/lib/knowledgeBase";
import { createMaterialSegment } from "@/lib/db";

/** 单段的目标字符数（软上限，遇段落边界会略微伸缩以避免切碎句子）。 */
export const SEGMENT_TARGET_CHARS = 2400;
/** 单段硬上限：超过则即使没遇到段落边界也强制切分。 */
export const SEGMENT_MAX_CHARS = 3200;

/** 切好的一段（未落库，供 KB 构建阶段做标注）。 */
export interface Segment {
  material_index: number;
  file_name: string;
  seg_index: number;
  char_start: number;
  char_end: number;
  content: string;
  ref: string; // material:<material_index>:seg_<seg_index>
}

export function segRef(materialIndex: number, segIndex: number): string {
  return `material:${materialIndex}:seg_${segIndex}`;
}

/**
 * 把单个文件正文切成有界小段。
 * 优先在空行（段落）处断开；段落本身超过硬上限时按硬上限硬切。
 * char_start/char_end 是相对该文件正文的字符偏移，保证可回溯定位。
 */
export function splitFileIntoSegments(
  materialIndex: number,
  fileName: string,
  text: string
): Segment[] {
  const segments: Segment[] = [];
  const total = text.length;
  let cursor = 0;
  let segIndex = 0;

  while (cursor < total) {
    let end = Math.min(cursor + SEGMENT_TARGET_CHARS, total);

    // 未到文件尾：尝试把 end 挪到最近的段落边界（\n\n），
    // 但不超过硬上限，也不早于目标长度太多。
    if (end < total) {
      const searchFrom = end;
      const searchTo = Math.min(cursor + SEGMENT_MAX_CHARS, total);
      const paraBreak = text.indexOf("\n\n", searchFrom);
      if (paraBreak !== -1 && paraBreak <= searchTo) {
        end = paraBreak + 2; // 含分隔的换行
      } else {
        // 没有合适的段落边界，退而求其次找单换行或空格，避免切在词中间
        const window = text.slice(searchFrom, searchTo);
        const nl = window.lastIndexOf("\n");
        const sp = window.lastIndexOf(" ");
        const rel = nl !== -1 ? nl : sp;
        if (rel !== -1) end = searchFrom + rel + 1;
        else end = searchTo; // 实在没有则硬切到硬上限
      }
    }

    const content = text.slice(cursor, end);
    // 跳过纯空白段，但仍推进游标
    if (content.trim().length > 0) {
      segments.push({
        material_index: materialIndex,
        file_name: fileName,
        seg_index: segIndex,
        char_start: cursor,
        char_end: end,
        content,
        ref: segRef(materialIndex, segIndex),
      });
      segIndex++;
    }
    cursor = end;
  }

  return segments;
}

/**
 * 把整个课程知识库（多文件拼接文本）切成段并落库。
 * 返回内存中的段数组，供 KB 构建阶段做「段 → 知识单元」标注。
 * 注意：文件顺序即 parseKnowledgeBaseToMap 的插入顺序，material_index 与之对齐。
 */
export async function segmentAndPersistMaterials(
  courseId: number,
  knowledgeBase: string
): Promise<Segment[]> {
  const filesMap = parseKnowledgeBaseToMap(knowledgeBase);
  const all: Segment[] = [];

  let materialIndex = 0;
  for (const [fileName, content] of filesMap) {
    const segs = splitFileIntoSegments(materialIndex, fileName, content);
    for (const seg of segs) {
      await createMaterialSegment({
        course_id: courseId,
        material_index: seg.material_index,
        file_name: seg.file_name,
        seg_index: seg.seg_index,
        char_start: seg.char_start,
        char_end: seg.char_end,
        content: seg.content,
      });
    }
    all.push(...segs);
    materialIndex++;
  }

  console.log(`[入库切段] 课程 ${courseId}：${filesMap.size} 个文件 → ${all.length} 段`);
  return all;
}
