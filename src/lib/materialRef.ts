// 材料引用系统
// 用引用代替完整内容传递，充分利用长上下文

import { getKnowledgeUnits, getSourceLocations, getCourse, getSegmentByRef } from "@/lib/db";
import { parseKnowledgeBaseToMap } from "@/lib/knowledgeBase";

/**
 * 材料引用元数据（传给 LLM 的轻量数据）
 */
export interface MaterialRef {
  ref: string; // "material:u1" 或 "material:u1:page_15-18"
  unit_id: string;
  title: string;
  summary: string;
  source_files: string[]; // 关联的文件名列表
  char_count: number; // 总字符数
}

/**
 * 为课程生成材料引用清单
 */
export async function generateMaterialRefs(
  courseId: number,
  unitIds: string[]
): Promise<MaterialRef[]> {
  const allUnits = await getKnowledgeUnits(courseId);
  const selectedUnits = allUnits.filter(u => unitIds.includes(u.unit_id));

  const refs: MaterialRef[] = [];

  for (const unit of selectedUnits) {
    const locs = await getSourceLocations(unit.id);
    const sourceFiles = Array.from(new Set(locs.map(l => l.file_name)));
    const totalChars = locs.reduce((sum, l) => sum + (l.char_count ?? 0), 0);

    refs.push({
      ref: `material:${unit.unit_id}`,
      unit_id: unit.unit_id,
      title: unit.title,
      summary: unit.summary ?? '',
      source_files: sourceFiles,
      char_count: totalChars,
    });
  }

  return refs;
}

/** 收集某知识单元绑定的段 ref（来自 source_locations.seg_refs，去重）。 */
async function collectUnitSegRefs(unitDbId: number): Promise<string[]> {
  const locs = await getSourceLocations(unitDbId);
  const out = new Set<string>();
  for (const loc of locs) {
    if (!loc.seg_refs) continue;
    try {
      const arr = JSON.parse(loc.seg_refs) as string[];
      for (const r of arr) if (typeof r === "string") out.add(r);
    } catch {
      // 忽略损坏的 seg_refs，回退到整文件注入
    }
  }
  return Array.from(out);
}

/** 解析单个段 ref（material:<material_index>:seg_<seg_index>）为原文；找不到返回 null。 */
async function resolveSegmentRef(courseId: number, segReference: string): Promise<string | null> {
  const m = segReference.match(/^material:(\d+):seg_(\d+)$/);
  if (!m) return null;
  const seg = await getSegmentByRef(courseId, Number(m[1]), Number(m[2]));
  if (!seg) return null;
  return `【${segReference}｜${seg.file_name}】\n${seg.content}`;
}

/**
 * 解析材料引用，返回完整内容
 */
export async function resolveMaterialRef(
  courseId: number,
  materialRef: string
): Promise<string> {
  // 解析 ref 格式: "material:unit_id" 或 "material:unit_id:page_15-18"
  const parts = materialRef.split(':');
  if (parts.length < 2 || parts[0] !== 'material') {
    throw new Error(`无效的材料引用格式: ${materialRef}`);
  }

  const unitId = parts[1];
  const pageRange = parts.length >= 3 ? parts[2] : undefined;

  // 情况 A：直接就是段 ref（material:<material_index>:seg_<seg_index>）→ 只解析该段
  if (pageRange && /^seg_\d+$/.test(pageRange)) {
    const segContent = await resolveSegmentRef(courseId, materialRef);
    if (segContent) return segContent;
    throw new Error(`找不到材料段: ${materialRef}`);
  }

  // 获取知识单元
  const allUnits = await getKnowledgeUnits(courseId);
  const unit = allUnits.find(u => u.unit_id === unitId);
  if (!unit) {
    throw new Error(`找不到知识单元: ${unitId}`);
  }

  // 情况 B：单元绑定了段 ref → 只注入这几段原文（段级有界注入）
  const segRefs = await collectUnitSegRefs(unit.id);
  if (segRefs.length > 0) {
    const segContents: string[] = [];
    for (const r of segRefs) {
      const c = await resolveSegmentRef(courseId, r);
      if (c) segContents.push(c);
    }
    if (segContents.length > 0) {
      return segContents.join("\n\n---\n\n");
    }
    // 段全部解析失败（如旧课程无 material_segments）→ 落到整文件回退
  }

  // 情况 C（回退）：无段绑定，注入整文件（兼容旧课程）
  // 获取材料位置
  const locs = await getSourceLocations(unit.id);
  if (locs.length === 0) {
    throw new Error(`知识单元 ${unitId} 没有关联的材料位置`);
  }

  // 获取完整知识库
  const course = await getCourse(courseId);
  if (!course?.knowledge_base) {
    throw new Error(`课程 ${courseId} 没有知识库`);
  }

  // 解析知识库
  const materialsMap = parseKnowledgeBaseToMap(course.knowledge_base);

  // 提取对应文件的内容（同一文件的多个 source location 只注入一次，避免整份文件重复）
  const contents: string[] = [];
  const seenFiles = new Set<string>();

  for (const loc of locs) {
    if (seenFiles.has(loc.file_name)) continue;
    const fileContent = materialsMap.get(loc.file_name);
    if (fileContent) {
      seenFiles.add(loc.file_name);
      const header = pageRange ? `### ${loc.file_name} (${pageRange})` : `### ${loc.file_name}`;
      contents.push(`${header}\n\n${fileContent}`);
    }
  }

  if (contents.length === 0) {
    throw new Error(`无法找到材料内容: ${materialRef}`);
  }

  return contents.join('\n\n---\n\n');
}

// 注：材料注入采用「确定性注入」（见 materialGather.ts）：
// 检索得到相关引用后，由系统确定性解析每个 ref 的原文，按 manifest + excerpt 拼接进上下文，
// ref 只作为归因锚点，不再由 LLM 通过工具按需拉取。
//
// 已移除的两版历史方案：
// 1)「事后标记替换」（formatMaterialRefsForPrompt / extractMaterialRefs / resolveMaterialRefsInContent）：
//    LLM 常忽略 <material-ref> 元指令导致讲义零真实材料；字符串替换还会损坏 LaTeX（$ 序列）、只替换首个标记。
// 2)「工具调用 agentic 循环」（GET_MATERIAL_TOOL / executeGetMaterial / gatherMaterialsWithTools）：
//    能拿到真实原文，但每次生成多几轮 LLM 往返，比确定性注入更慢更贵；已回退。
