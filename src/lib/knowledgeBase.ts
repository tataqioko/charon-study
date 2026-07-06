// 知识库生成：将上传材料分析为知识单元
import { chatOnce } from "@/lib/api";

export interface KnowledgeUnit {
  unit_id: string;
  title: string;
  summary: string;
  prerequisites: string[];
  source_locations: SourceLocation[];
  can_generate_lecture: boolean;
  can_generate_quiz: boolean;
}

export interface SourceLocation {
  file_name: string;
  material_index: number;
  page_start?: number;
  page_end?: number;
  char_count: number;
  content_preview: string;
  seg_refs?: string[]; // 该单元绑定的段 ref，如 ["material:0:seg_3"]（段级构建时填充）
}

export interface Example {
  unit_id: string;
  title: string;
  content: string;
  source_ref: string;
}

export interface ExerciseCandidate {
  unit_id: string;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
  difficulty?: string;
  source_ref: string;
}

export interface KnowledgeBase {
  course_topic: string;
  knowledge_units: KnowledgeUnit[];
  knowledge_hierarchy: { parent: string; child: string }[];
  examples: Example[];
  exercise_candidates: ExerciseCandidate[];
}

/**
 * 生成知识库：分析上传材料，提取知识单元
 */
export async function generateKnowledgeBase(
  courseTopic: string,
  knowledgeBaseText: string,
  model: string
): Promise<KnowledgeBase> {
  const prompt = knowledgeBasePrompt(courseTopic, knowledgeBaseText);

  const response = await chatOnce(
    model,
    [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    0.7
  );

  try {
    const kb = JSON.parse(extractJson(response));
    return kb;
  } catch (e) {
    console.error("知识库解析失败:", e, response);
    throw new Error("知识库生成失败，模型未返回有效 JSON");
  }
}

// ---- 段级 + 分批构建（资料超上下文时分批处理，绝不截断） ----

import type { Segment } from "@/lib/segmentMaterials";

/** 每批喂给模型的段落字符预算（远小于上下文上限，留足输出与系统提示空间）。 */
export const KB_BATCH_CHAR_BUDGET = 24000;

/**
 * 段级知识库构建：把切好的段按字符预算分批，逐批让模型抽取知识单元，
 * 再把各批结果合并成一个 KnowledgeBase。
 * 关键点：
 * - 绝不截断整体材料——超预算就多分几批，覆盖全部段落。
 * - 每批内 unit_id 加批次前缀（b1_u1）避免跨批冲突，examples/exercises 的 unit_id 同步重映射。
 * - 每个 source_location 带 seg_refs，指向它真正引用的那几段（解析时只注入这几段）。
 */
export async function generateKnowledgeBaseFromSegments(
  courseTopic: string,
  segments: Segment[],
  model: string,
  onBatch?: (done: number, total: number) => void
): Promise<KnowledgeBase> {
  const batches = groupSegmentsByBudget(segments, KB_BATCH_CHAR_BUDGET);
  const merged: KnowledgeBase = {
    course_topic: courseTopic,
    knowledge_units: [],
    knowledge_hierarchy: [],
    examples: [],
    exercise_candidates: [],
  };

  const failures: Array<{ batch: number; error: string }> = [];
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    onBatch?.(b, batches.length);
    try {
      const partial = await buildKbForBatch(courseTopic, batch, model);
      mergeBatchInto(merged, partial, b, batch);
    } catch (e) {
      // 单批失败不阻塞其余批次（逐单元容错）
      failures.push({ batch: b + 1, error: String(e) });
      console.warn(`[段级知识库] 第 ${b + 1}/${batches.length} 批失败，跳过:`, e);
    }
  }
  onBatch?.(batches.length, batches.length);

  if (merged.knowledge_units.length === 0) {
    const failureDetails = failures.length > 0
      ? `\n失败详情：\n${failures.map(f => `  批次 ${f.batch}: ${f.error}`).join('\n')}`
      : '';
    throw new Error(`段级知识库生成失败：所有批次均未产出知识单元${failureDetails}`);
  }

  // 如果有部分批次失败，记录警告
  if (failures.length > 0) {
    console.warn(
      `[段级知识库] ${failures.length}/${batches.length} 个批次失败，但已从成功批次产出 ${merged.knowledge_units.length} 个单元`
    );
  }

  // 分批会产生”孤岛”：同一概念被切到不同批、各出一个重复单元；跨批的
  // prerequisites/hierarchy 也建立不起来。这里做一次全局收敛（去重 + 跨批关联）。
  const converged = await convergeKnowledgeBase(merged, model, batches.length > 1);
  console.log(
    `[段级知识库] ${batches.length} 批 → 合并 ${merged.knowledge_units.length} → 收敛 ${converged.knowledge_units.length} 个知识单元`
  );
  return converged;
}

/** 按字符预算把段分批；单段即使超预算也自成一批，保证不丢内容。 */
function groupSegmentsByBudget(segments: Segment[], budget: number): Segment[][] {
  const batches: Segment[][] = [];
  let cur: Segment[] = [];
  let curChars = 0;
  for (const seg of segments) {
    const len = seg.content.length;
    if (cur.length > 0 && curChars + len > budget) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(seg);
    curChars += len;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** 对一批段调用模型抽取知识单元（要求 seg_refs 只能取自本批给出的 ref）。 */
async function buildKbForBatch(
  courseTopic: string,
  batch: Segment[],
  model: string
): Promise<KnowledgeBase> {
  const prompt = segmentKbPrompt(courseTopic, batch);
  const response = await chatOnce(
    model,
    [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    0.7
  );
  return JSON.parse(extractJson(response)) as KnowledgeBase;
}

/**
 * 把一批的结果合并进总 KB：
 * - unit_id 加批次前缀，避免跨批 "u1" 冲突；
 * - examples / exercise_candidates 的 unit_id 同步重映射；
 * - source_locations 若模型漏填 seg_refs，则兜底绑定整批的段 ref（至少有界到本批）。
 */
function mergeBatchInto(
  target: KnowledgeBase,
  partial: KnowledgeBase,
  batchIdx: number,
  batch: Segment[]
): void {
  const prefix = `b${batchIdx + 1}_`;
  const validRefs = new Set(batch.map((s) => s.ref));
  const batchFileByIndex = new Map(batch.map((s) => [s.material_index, s.file_name]));
  const remap = (id: string) => `${prefix}${id}`;

  for (const unit of partial.knowledge_units ?? []) {
    const locs = (unit.source_locations ?? []).map((loc) => {
      const segRefs = (loc.seg_refs ?? []).filter((r) => validRefs.has(r));
      const finalRefs = segRefs.length > 0 ? segRefs : batch.map((s) => s.ref);
      return {
        ...loc,
        file_name: loc.file_name || batchFileByIndex.get(loc.material_index) || batch[0]?.file_name || "",
        seg_refs: finalRefs,
      };
    });
    target.knowledge_units.push({
      ...unit,
      unit_id: remap(unit.unit_id),
      prerequisites: (unit.prerequisites ?? []).map(remap),
      source_locations: locs.length > 0
        ? locs
        : [fallbackLocation(batch)],
    });
  }

  for (const ex of partial.examples ?? []) {
    target.examples.push({ ...ex, unit_id: remap(ex.unit_id) });
  }
  for (const ex of partial.exercise_candidates ?? []) {
    target.exercise_candidates.push({ ...ex, unit_id: remap(ex.unit_id) });
  }
  for (const h of partial.knowledge_hierarchy ?? []) {
    // parent 若为课程主题本身（顶层节点）则保持原样，否则同样加批次前缀
    const isTopLevel = h.parent === partial.course_topic || h.parent === target.course_topic;
    target.knowledge_hierarchy.push({
      parent: isTopLevel ? h.parent : remap(h.parent),
      child: remap(h.child),
    });
  }
}

/** 模型漏给任何 source_location 时，兜底把整批段绑给该单元（仍有界到本批）。 */
function fallbackLocation(batch: Segment[]): SourceLocation {
  const chars = batch.reduce((n, s) => n + s.content.length, 0);
  return {
    file_name: batch[0]?.file_name ?? "",
    material_index: batch[0]?.material_index ?? 0,
    char_count: chars,
    content_preview: (batch[0]?.content ?? "").slice(0, 200),
    seg_refs: batch.map((s) => s.ref),
  };
}

/** 标题归一化：用于跨批去重（忽略大小写、空白、常见标点差异）。 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}]+/gu, "");
}

/** 合并两个单元的 source_locations：按 (material_index, file_name) 归并并去重 seg_refs。 */
function mergeLocations(a: SourceLocation[], b: SourceLocation[]): SourceLocation[] {
  const byKey = new Map<string, SourceLocation>();
  for (const loc of [...a, ...b]) {
    const key = `${loc.material_index}|${loc.file_name}`;
    const existing = byKey.get(key);
    if (existing) {
      const refs = new Set([...(existing.seg_refs ?? []), ...(loc.seg_refs ?? [])]);
      existing.seg_refs = [...refs];
      existing.char_count = Math.max(existing.char_count, loc.char_count);
    } else {
      byKey.set(key, { ...loc, seg_refs: [...(loc.seg_refs ?? [])] });
    }
  }
  return [...byKey.values()];
}

/**
 * 全局收敛：先按标题确定性去重（把重复单元的 source_locations/prerequisites 归并，
 * 并把所有指向被合并 id 的引用重定向到留存 id），再可选地做一次 LLM 关联补全。
 */
async function convergeKnowledgeBase(
  kb: KnowledgeBase,
  model: string,
  tryLlmLink: boolean
): Promise<KnowledgeBase> {
  // ---- 第一步：按标题确定性去重 ----
  const canonicalByTitle = new Map<string, KnowledgeUnit>(); // 归一化标题 → 留存单元
  const idRemap = new Map<string, string>(); // 被合并 id → 留存 id
  for (const unit of kb.knowledge_units) {
    const key = normalizeTitle(unit.title);
    const canonical = canonicalByTitle.get(key);
    if (canonical) {
      // 重复单元：并入留存单元
      canonical.source_locations = mergeLocations(canonical.source_locations, unit.source_locations);
      canonical.prerequisites = [...new Set([...canonical.prerequisites, ...unit.prerequisites])];
      canonical.can_generate_lecture ||= unit.can_generate_lecture;
      canonical.can_generate_quiz ||= unit.can_generate_quiz;
      idRemap.set(unit.unit_id, canonical.unit_id);
    } else {
      canonicalByTitle.set(key, unit);
    }
  }

  const dedupedUnits = [...canonicalByTitle.values()];
  const liveIds = new Set(dedupedUnits.map((u) => u.unit_id));
  const redirect = (id: string) => idRemap.get(id) ?? id;

  // 重定向所有引用到留存 id，并丢弃自指/悬空引用（记录丢失的前置依赖）
  for (const unit of dedupedUnits) {
    const originalPrereqs = unit.prerequisites.map(redirect);
    const droppedPrereqs: string[] = [];
    unit.prerequisites = [...new Set(originalPrereqs)]
      .filter((p) => {
        if (p === unit.unit_id) return false; // 自指
        if (!liveIds.has(p)) {
          droppedPrereqs.push(p);
          return false;
        }
        return true;
      });
    if (droppedPrereqs.length > 0) {
      console.warn(`[知识库] 单元 ${unit.unit_id} 丢失前置依赖: ${droppedPrereqs.join(', ')}`);
    }
  }
  const hierarchy = kb.knowledge_hierarchy
    .map((h) => ({ parent: redirect(h.parent), child: redirect(h.child) }))
    .filter((h) => h.parent !== h.child && (liveIds.has(h.child) || h.parent === kb.course_topic));
  const examples = kb.examples.map((e) => ({ ...e, unit_id: redirect(e.unit_id) }));
  const exercises = kb.exercise_candidates.map((e) => ({ ...e, unit_id: redirect(e.unit_id) }));

  // hierarchy 去重
  const seenEdge = new Set<string>();
  const dedupedHierarchy = hierarchy.filter((h) => {
    const k = `${h.parent}>${h.child}`;
    if (seenEdge.has(k)) return false;
    seenEdge.add(k);
    return true;
  });

  const result: KnowledgeBase = {
    course_topic: kb.course_topic,
    knowledge_units: dedupedUnits,
    knowledge_hierarchy: dedupedHierarchy,
    examples,
    exercise_candidates: exercises,
  };

  // ---- 第二步：跨批关联补全（仅多批 + 单元数适中时）----
  // 只喂标题+summary（不含原文），上下文有界；失败不影响已去重的结果。
  if (tryLlmLink && dedupedUnits.length >= 2 && dedupedUnits.length <= 60) {
    try {
      await linkUnitsAcrossBatches(result, model);
    } catch (e) {
      console.warn("[段级知识库] 跨批关联补全失败，保留去重结果:", e);
    }
  }

  return result;
}

/**
 * 用 LLM 在“已去重单元”的标题+summary 之上重建跨批 prerequisites/hierarchy。
 * 只允许引用现有 unit_id，产出经校验后并入（不删除已有关系，只补全）。
 */
async function linkUnitsAcrossBatches(kb: KnowledgeBase, model: string): Promise<void> {
  const roster = kb.knowledge_units
    .map((u) => `${u.unit_id}｜${u.title}｜${u.summary}`)
    .join("\n");
  const validIds = new Set(kb.knowledge_units.map((u) => u.unit_id));

  const system = `你是知识图谱工程师。下面是一份已去重的知识单元清单（格式：unit_id｜标题｜概述），它们由多批抽取合并而来，跨批的先后依赖关系可能缺失。
请仅依据标题和概述，判断单元之间的“前置依赖”（学 A 之前应先掌握 B）与“上下位归属”（父节点包含子节点）。
输出严格 JSON（不要解释或代码块标记）：
{
  "prerequisites": [{"unit": "unit_id", "requires": ["前置unit_id"]}],
  "hierarchy": [{"parent": "父unit_id", "child": "子unit_id"}]
}
规则：
1. unit_id【只能】使用清单中出现的 id，不得编造。
2. 不要制造环（A 依赖 B 且 B 依赖 A）。
3. 只输出你有把握的关系，宁缺毋滥。`;
  const user = `知识单元清单（共 ${kb.knowledge_units.length} 个）：\n${roster}\n\n请补全跨单元的前置依赖与上下位关系。`;

  const response = await chatOnce(
    model,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.3
  );

  const parsed = JSON.parse(extractJson(response)) as {
    prerequisites?: { unit: string; requires: string[] }[];
    hierarchy?: { parent: string; child: string }[];
  };

  // 合并 prerequisites（只接受合法且非自指的 id）
  const unitById = new Map(kb.knowledge_units.map((u) => [u.unit_id, u]));
  for (const p of parsed.prerequisites ?? []) {
    const unit = unitById.get(p.unit);
    if (!unit) continue;
    const add = (p.requires ?? []).filter((r) => validIds.has(r) && r !== p.unit);
    unit.prerequisites = [...new Set([...unit.prerequisites, ...add])];
  }

  // 合并 hierarchy（去重、去自环、只接受合法 id）
  const seen = new Set(kb.knowledge_hierarchy.map((h) => `${h.parent}>${h.child}`));
  for (const h of parsed.hierarchy ?? []) {
    if (!validIds.has(h.parent) || !validIds.has(h.child) || h.parent === h.child) continue;
    const k = `${h.parent}>${h.child}`;
    if (seen.has(k)) continue;
    seen.add(k);
    kb.knowledge_hierarchy.push({ parent: h.parent, child: h.child });
  }
}

/** 段级抽取 prompt：给模型带 ref 标签的一批段落，要求 seg_refs 只能引用这些 ref。 */
function segmentKbPrompt(courseTopic: string, batch: Segment[]): { system: string; user: string } {
  const labeled = batch
    .map((s) => `【${s.ref}｜文件：${s.file_name}】\n${s.content}`)
    .join("\n\n----\n\n");

  return {
    system: `你是知识结构分析专家。下面给出一批带引用标签的材料片段，每段以【material:文件序号:seg_段号｜文件：文件名】开头。
你的任务是从这批片段中提取知识单元、示例和习题候选，输出严格 JSON（不要任何解释或代码块标记）：
{
  "course_topic": "课程主题",
  "knowledge_units": [
    {
      "unit_id": "u1",
      "title": "知识单元标题",
      "summary": "简要概述（1-2句话）",
      "prerequisites": ["前置知识单元ID"],
      "source_locations": [
        {
          "file_name": "文件名",
          "material_index": 0,
          "char_count": 1200,
          "content_preview": "内容预览（前200字符）",
          "seg_refs": ["material:0:seg_3"]
        }
      ],
      "can_generate_lecture": true,
      "can_generate_quiz": true
    }
  ],
  "knowledge_hierarchy": [{"parent": "课程主题", "child": "u1"}],
  "examples": [{"unit_id": "u1", "title": "示例标题", "content": "示例内容", "source_ref": "material:0:seg_3"}],
  "exercise_candidates": [{"unit_id": "u1", "question": "题目", "options": ["A","B"], "answer": "A", "explanation": "解析", "difficulty": "easy|medium|hard", "source_ref": "material:0:seg_3"}]
}

关键规则：
1. seg_refs 和 source_ref 里的引用【只能】使用上面这批片段给出的 ref，不得编造、不得引用未给出的段。
2. 每个知识单元的 source_locations.seg_refs 要精确到它真正涉及的那几段（通常 1-3 段），不要把整批都填进去。
3. unit_id 从 u1 开始递增（只需在本批内唯一，系统会自动加前缀避免跨批冲突）。
4. 只依据本批片段的内容抽取，不要臆测本批之外的内容。`,
    user: `课程主题：${courseTopic}

本批材料片段（共 ${batch.length} 段）：

${labeled}

请从这批片段中提取知识单元、示例和习题候选。`,
  };
}

function knowledgeBasePrompt(courseTopic: string, materialText: string): { system: string; user: string } {
  return {
    system: `你是知识结构分析专家。你的任务是分析用户上传的学习材料，提取其中的知识单元、示例和习题。

输出严格的 JSON 格式，不要有任何解释或代码块标记：
{
  "course_topic": "课程主题",
  "knowledge_units": [
    {
      "unit_id": "u1",
      "title": "知识单元标题",
      "summary": "简要概述（1-2句话）",
      "prerequisites": ["前置知识单元ID"],
      "source_locations": [
        {
          "file_name": "文件名",
          "material_index": 0,
          "char_count": 1200,
          "content_preview": "内容预览（前200字符）"
        }
      ],
      "can_generate_lecture": true,
      "can_generate_quiz": true
    }
  ],
  "knowledge_hierarchy": [
    {"parent": "课程主题", "child": "u1"},
    {"parent": "u1", "child": "u2"}
  ],
  "examples": [
    {
      "unit_id": "u1",
      "title": "示例标题",
      "content": "示例内容（完整描述）",
      "source_ref": "material:0:page_1"
    }
  ],
  "exercise_candidates": [
    {
      "unit_id": "u1",
      "question": "习题题目",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "正确答案",
      "explanation": "解析",
      "difficulty": "easy|medium|hard",
      "source_ref": "material:0:page_2"
    }
  ]
}

规则：
1. 每个知识单元对应材料中的一个明确知识点或章节
2. unit_id 从 u1 开始递增
3. source_locations 记录该知识点在哪些文件的哪些位置
4. prerequisites 记录依赖的前置知识单元
5. knowledge_hierarchy 构建知识图谱
6. examples：从材料中提取典型示例（案例、例题、代码示例等）
7. exercise_candidates：从材料中提取或生成习题候选（用于后续测验生成）
8. source_ref 格式：material:材料索引:page_页码`,

    user: `课程主题：${courseTopic}

用户上传的学习材料如下（每个文件以 ### 分隔）：

${materialText.slice(0, 50000)}

请分析材料，提取知识单元、示例和习题候选。`,
  };
}

function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

/**
 * 解析 knowledgeBaseText，构建文件名到内容的映射
 */
export function parseKnowledgeBaseToMap(knowledgeBaseText: string): Map<string, string> {
  const map = new Map<string, string>();
  const rawBlocks = knowledgeBaseText.split(/\n\n---\n\n/);

  // 文件正文内部可能本身含有 markdown 水平线（\n\n---\n\n），会被上面切开。
  // 只有以「### 文件名」开头的块才是真正的新文件块；否则把它当作上一块的延续拼回去。
  const blocks: string[] = [];
  for (const block of rawBlocks) {
    if (/^### .+/.test(block) || blocks.length === 0) {
      blocks.push(block);
    } else {
      blocks[blocks.length - 1] += `\n\n---\n\n${block}`;
    }
  }

  for (const block of blocks) {
    const match = block.match(/^### (.+?)\n\n([\s\S]+)$/);
    if (match) {
      const [, filename, content] = match;
      map.set(filename, content);
    }
  }

  return map;
}
