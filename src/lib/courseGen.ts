// 课程生成编排:主题 → 学习计划 → 落库 steps → 首日讲义
// 全在客户端执行,调用 Rust 的 chat_once(锁定站点)。
// 材料引用采用确定性注入：按单元 seg_refs / RAG 检索出相关段落，直接拼进 prompt 上下文
// （不走 LLM 工具调用，避免多轮往返与不确定性）。
import { chatOnce, chatStream } from "@/lib/api";
import {
  createCourse, updateCourseJson, createStep, createLecture,
  saveLectureContent, listSteps,
} from "@/lib/db";
import {
  schedulePrompt, lecturePrompt, followUpPrompt, quizPrompt,
  diagnosticPrompt, profilePrompt, parseLectureResponse,
  extractJson, type SchedulePayload, type ScheduleDay, type DayUnit,
  type QuizPayload, type QuizQuestion,
  type DiagnosticPayload, type UserProfile,
} from "@/lib/prompts";
import type { Step } from "@/lib/db";

export interface GenProgress {
  stage: string;
  detail?: string;
}

/**
 * 把一个排期「天」展开为学习单元列表（daily_plan 多 unit 层）。
 * 若该天已有 units 则直接用；否则从天级字段合成单个 unit（向后兼容旧排期）。
 */
export function expandDayToUnits(day: ScheduleDay): DayUnit[] {
  if (day.units && day.units.length > 0) {
    return day.units
      .map((u, i) => ({
        order_in_day: u.order_in_day ?? i + 1,
        title: u.title,
        objective: u.objective ?? day.learning_goal,
        need_lecture: u.need_lecture ?? true,
        need_exercise: u.need_exercise ?? false,
        related_knowledge_units: u.related_knowledge_units ?? [],
        source_refs: u.source_refs ?? [],
        prerequisites: u.prerequisites ?? [],
      }))
      .sort((a, b) => a.order_in_day - b.order_in_day);
  }
  // 回退：整天作为一个单元
  return [
    {
      order_in_day: 1,
      title: day.day_title,
      objective: day.learning_goal,
      need_lecture: true,
      need_exercise: false,
      related_knowledge_units: day.topic_scope ?? [],
      source_refs: [],
      prerequisites: [],
    },
  ];
}

/** 讲义/测验生成所需的单元级上下文 */
export interface StepContext {
  title: string;
  learningGoal: string;
  topicScope: string[];
  dayIndex: number;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/**
 * 解析某个 step（学习单元）的生成上下文。
 * 优先用单元自身的标题/目标/关联知识点；缺省时回退到当天排期的天级字段。
 */
export function resolveStepContext(step: Step, day: ScheduleDay | undefined): StepContext {
  const related = parseJsonArray(step.related_units);
  return {
    title: step.title || day?.day_title || "",
    learningGoal: step.objective || day?.learning_goal || "",
    topicScope: related.length > 0 ? related : day?.topic_scope ?? [],
    dayIndex: step.day_index,
  };
}

/**
 * 按 daily_plan 多 unit 层落库 steps：每天展开为 1-N 个单元 step。
 * 首日的 active 单元必须与 eager 讲义目标一致——即“首个 need_lecture 的单元”，
 * 若首日无任何需讲义单元则退回首日第一个单元。否则会出现：active 落在纯练习单元、
 * 讲义却生成到另一个 pending 单元，用户点开 active 单元看到空白。
 */
async function persistScheduleSteps(courseId: number, schedule: SchedulePayload): Promise<void> {
  const day1 = schedule.days.find((d) => d.day_index === 1);
  const day1Units = day1 ? expandDayToUnits(day1) : [];
  // 与 startCourseGeneration 里 eager 讲义的选取规则保持一致
  // 安全检查：防止空数组访问
  const activeUnit = day1Units.length > 0
    ? (day1Units.find((u) => u.need_lecture) ?? day1Units[0])
    : null;

  for (const day of schedule.days) {
    const units = expandDayToUnits(day);
    for (const unit of units) {
      const isActive =
        day.day_index === 1 && !!activeUnit && unit.order_in_day === activeUnit.order_in_day;
      await createStep({
        course_id: courseId,
        day_index: day.day_index,
        order_in_day: unit.order_in_day,
        kind: unit.need_lecture ? "lecture" : "exercise",
        title: unit.title,
        objective: unit.objective,
        status: isActive ? "active" : "pending",
        need_lecture: unit.need_lecture ? 1 : 0,
        need_exercise: unit.need_exercise ? 1 : 0,
        related_units: JSON.stringify(unit.related_knowledge_units),
        source_refs: JSON.stringify(unit.source_refs),
        prerequisites: JSON.stringify(unit.prerequisites),
      });
    }
  }
}

/**
 * 为每个单元 step 填充材料引用 source_refs（归因锚点）。
 * 按单元作用域（related_units / 标题）匹配知识单元，把命中的 material:unit_id 写回 step。
 * 纯归因用途，失败不影响主流程。
 */
async function populateStepSourceRefs(courseId: number): Promise<void> {
  try {
    const { listSteps, getKnowledgeUnits, updateStepSourceRefs } = await import("@/lib/db");
    const units = await getKnowledgeUnits(courseId);
    if (units.length === 0) return;

    const steps = await listSteps(courseId);
    for (const step of steps) {
      const scope = resolveStepContext(step, undefined).topicScope;
      // 单元标题与作用域词互相包含即视为命中
      const matched = units.filter((u) =>
        scope.some(
          (topic) =>
            u.title.toLowerCase().includes(topic.toLowerCase()) ||
            topic.toLowerCase().includes(u.title.toLowerCase())
        )
      );
      if (matched.length === 0) continue;
      const refs = matched.map((u) => `material:${u.unit_id}`);
      await updateStepSourceRefs(step.id, refs);
    }
  } catch (e) {
    console.warn("[材料引用] 填充 source_refs 失败:", e);
  }
}

/**
 * 为某个 step（学习单元）生成讲义并落库，记录材料使用。
 * 供首日 eager 生成、按需生成、后台批量生成共用（非流式）。
 */
async function generateLectureIntoStep(
  courseId: number,
  step: Step,
  day: ScheduleDay | undefined,
  courseTopic: string,
  dailyTime: string,
  model: string,
  knowledgeBase: string | null
): Promise<string> {
  const { prepareMaterialContext } = await import("@/lib/materialGather");
  const { recordMaterialUsage, getLectureByStep } = await import("@/lib/db");

  const existing = await getLectureByStep(step.id);
  const lectureId = existing?.id ?? await createLecture(step.id, step.title);

  const ctx = resolveStepContext(step, day);
  const { contextSection, usedUnitIds } = await prepareMaterialContext(
    courseId, ctx.title, ctx.topicScope, ctx.learningGoal, knowledgeBase, ctx.dayIndex
  );

  // 掌握度回流（）
  const { calculateMastery, formatMasteryContext } = await import("@/lib/masteryTracking");
  let masteryContext = "";
  try {
    const mastery = await calculateMastery(courseId);
    masteryContext = formatMasteryContext(mastery);
  } catch (e) {
    console.warn("掌握度统计失败，跳过自适应:", e);
  }

  const lp = lecturePrompt(
    courseTopic, ctx.title, ctx.learningGoal, ctx.topicScope, dailyTime, contextSection, masteryContext
  );
  const response = await chatOnce(
    model,
    [
      { role: "system", content: lp.system },
      { role: "user", content: lp.user },
    ],
    0.8
  );

  const { content_md, suggested_questions } = parseLectureResponse(response);
  await saveLectureContent(lectureId, content_md, suggested_questions);

  for (const unitId of usedUnitIds) {
    await recordMaterialUsage(courseId, ctx.dayIndex, unitId, 'lecture');
  }
  return content_md;
}

export interface MaterialMetadata {
  file_name: string;
  mime_type: string;
  kind: string;
  file_size: number;
  preview_url: string | null;
  ocr_text: string;
}

export interface NewCourseInput {
  topic: string;
  mode: string; // daily | sprint | leisure
  totalDays: number;
  dailyTime: string;
  model: string;
  knowledgeBase?: string | null; // 上传的材料文本
  materials?: MaterialMetadata[]; // 材料元数据（ material 管理）
  profile?: UserProfile; // 诊断得到的用户画像（缺省用默认画像）
  diagnostic?: {
    questionsJson: string;
    answersJson: string;
    customAnswersJson?: string; // 自定义补充答案（）
  }; // 诊断问卷原始记录（用于落库存档）
  /**
   * 预建课程 id：若知识库已在诊断阶段之前构建（：KB→诊断→画像→排期），
   * 则复用该课程，跳过重复的创建课程 + 建库步骤，直接走画像/排期/讲义。
   */
  prebuiltCourseId?: number;
}

/**
 * 构建课程知识库（切段 + 分批建库 + 落库知识单元/示例/习题）。
 * 从 generateCourse 抽出，供「诊断前先建库」流程复用（ 依赖链：先 KB 后 diagnostic）。
 * 幂等：若该课程已存在知识单元则直接跳过，避免重复建库。
 * 失败不抛异常（与原内嵌逻辑一致），调用方可回退到 RAG 模式。
 */
export async function buildKnowledgeBaseForCourse(
  courseId: number,
  topic: string,
  knowledgeBase: string,
  model: string,
  onProgress: (p: GenProgress) => void
): Promise<void> {
  const {
    getKnowledgeUnits, createKnowledgeUnit, createSourceLocation,
    createExample, createExerciseCandidate,
  } = await import("@/lib/db");

  // 幂等：已建过库就跳过（诊断阶段已建，生成阶段不再重复）
  const existingUnits = await getKnowledgeUnits(courseId);
  if (existingUnits.length > 0) {
    console.log(`[知识库] 课程 ${courseId} 已有 ${existingUnits.length} 个知识单元，跳过重复构建`);
    return;
  }

  onProgress({ stage: "分析学习材料" });
  const { generateKnowledgeBaseFromSegments } = await import("@/lib/knowledgeBase");
  const { segmentAndPersistMaterials } = await import("@/lib/segmentMaterials");

  try {
    // 入库切段：把每个文件按字符边界切成有界段并落库（生成 material:idx:seg_n 级 ref）
    onProgress({ stage: "材料切段与建库" });
    const segments = await segmentAndPersistMaterials(courseId, knowledgeBase);

    // 段级 + 分批构建知识库：绝不截断，资料越大只是分更多批
    const kb = await generateKnowledgeBaseFromSegments(topic, segments, model, (done, total) => {
      onProgress({ stage: "分析学习材料", detail: `知识库构建 ${done}/${total} 批` });
    });

    // 保存知识单元到数据库
    for (const unit of kb.knowledge_units) {
      const unitId = await createKnowledgeUnit({
        course_id: courseId,
        unit_id: unit.unit_id,
        title: unit.title,
        summary: unit.summary,
        prerequisites: JSON.stringify(unit.prerequisites),
        can_generate_lecture: unit.can_generate_lecture ? 1 : 0,
        can_generate_quiz: unit.can_generate_quiz ? 1 : 0,
      });

      // 保存材料位置（含 seg_refs：该单元绑定的段，解析时只注入这几段）
      for (const loc of unit.source_locations) {
        await createSourceLocation({
          unit_id: unitId,
          file_name: loc.file_name,
          material_index: loc.material_index,
          page_start: loc.page_start ?? null,
          page_end: loc.page_end ?? null,
          char_count: loc.char_count,
          content_preview: loc.content_preview,
          seg_refs: loc.seg_refs && loc.seg_refs.length > 0 ? JSON.stringify(loc.seg_refs) : null,
        });
      }
    }

    // 保存示例（Examples）
    for (const example of kb.examples || []) {
      await createExample({
        course_id: courseId,
        unit_id: example.unit_id,
        title: example.title,
        content: example.content,
        source_ref: example.source_ref,
      });
    }

    // 保存习题候选（Exercise Candidates）
    for (const exercise of kb.exercise_candidates || []) {
      await createExerciseCandidate({
        course_id: courseId,
        unit_id: exercise.unit_id,
        question: exercise.question,
        options_json: exercise.options ? JSON.stringify(exercise.options) : null,
        answer: exercise.answer,
        explanation: exercise.explanation ?? null,
        difficulty: exercise.difficulty ?? null,
        source_ref: exercise.source_ref,
      });
    }

    // 保存知识层级图谱（Knowledge Hierarchy，）
    if (kb.knowledge_hierarchy && kb.knowledge_hierarchy.length > 0) {
      const { createKnowledgeHierarchy } = await import("@/lib/db");
      for (const edge of kb.knowledge_hierarchy) {
        try {
          await createKnowledgeHierarchy(courseId, edge.parent, edge.child);
        } catch (e) {
          // 忽略重复边（UNIQUE 约束）
          console.warn(`知识层级边重复: ${edge.parent} -> ${edge.child}`, e);
        }
      }
    }

    onProgress({
      stage: "知识库已生成",
      detail: `${kb.knowledge_units.length} 个知识单元，${kb.examples?.length || 0} 个示例，${kb.exercise_candidates?.length || 0} 个习题`
    });
  } catch (e) {
    console.warn("知识库生成失败，将使用原有 RAG 模式:", e);
  }
}

/**
 * 生成课程主链路。onProgress 回调用于 UI 展示阶段。
 * 返回新课程 id。
 */
export async function generateCourse(
  input: NewCourseInput,
  onProgress: (p: GenProgress) => void
): Promise<number> {
  const { topic, mode, totalDays, dailyTime, model, knowledgeBase, diagnostic, materials } = input;

  // 复用诊断阶段预建的课程（含已建知识库），否则新建课程
  let courseId: number;
  if (input.prebuiltCourseId) {
    courseId = input.prebuiltCourseId;
  } else {
    onProgress({ stage: "创建课程" });
    courseId = await createCourse(topic, mode, totalDays, dailyTime, knowledgeBase ?? null);

    // 保存 materials 记录（ material 管理，并行创建避免竞态条件）
    if (materials && materials.length > 0) {
      const { createMaterial } = await import("@/lib/db");
      await Promise.all(materials.map(mat =>
        createMaterial({
          course_id: courseId,
          file_name: mat.file_name,
          mime_type: mat.mime_type,
          kind: mat.kind,
          file_size: mat.file_size,
          preview_url: mat.preview_url,
          ocr_text: mat.ocr_text,
          status: 'processed',
        })
      ));
    }
  }

  // 0. 生成知识库（如果有上传材料）；buildKnowledgeBaseForCourse 幂等，
  //    诊断阶段已建过则自动跳过，不会重复调用模型。
  if (knowledgeBase) {
    await buildKnowledgeBaseForCourse(courseId, topic, knowledgeBase, model, onProgress);
  }

  // 1. 用户画像：优先用诊断得到的画像，否则回退默认画像
  onProgress({ stage: "分析学习画像" });
  const profile = input.profile ?? getDefaultProfile();
  const { saveProfile, saveDiagnostic } = await import("@/lib/db");
  await saveProfile(courseId, JSON.stringify(profile));
  // 存档诊断问卷原始记录（若有）
  if (diagnostic) {
    try {
      await saveDiagnostic(
        courseId,
        diagnostic.questionsJson,
        diagnostic.answersJson,
        diagnostic.customAnswersJson
      );
    } catch (e) {
      console.warn("诊断记录存档失败:", e);
    }
  }

  // 2. 生成学习计划（优先用拓扑排序驱动，回退到 LLM）
  onProgress({ stage: "规划学习计划", detail: `${totalDays} 天` });
  let schedule: SchedulePayload;

  // 2a. 有知识库：先尝试从知识图谱拓扑排序生成排期（）
  if (knowledgeBase) {
    try {
      const { getKnowledgeUnits } = await import("@/lib/db");
      const { scheduleFromKnowledgeGraph } = await import("@/lib/topologicalSchedule");
      const units = await getKnowledgeUnits(courseId);
      if (units.length > 0) {
        const nodes = units.map((u) => ({
          unit_id: u.unit_id,
          title: u.title,
          summary: u.summary ?? "",
          prerequisites: u.prerequisites ? JSON.parse(u.prerequisites) : [],
          can_generate_lecture: u.can_generate_lecture !== 0,
          can_generate_quiz: u.can_generate_quiz !== 0,
        }));
        schedule = scheduleFromKnowledgeGraph(nodes, topic, totalDays, dailyTime);
        onProgress({ stage: "排期已生成", detail: "基于知识图谱拓扑排序" });
      } else {
        throw new Error("knowledge_units 为空");
      }
    } catch (e) {
      console.warn("拓扑排序生成失败，回退到 LLM 排期:", e);
      // 回退到 LLM
      const sp = schedulePrompt(topic, totalDays, dailyTime, mode, knowledgeBase, profile);
      const scheduleRaw = await chatOnce(
        model,
        [
          { role: "system", content: sp.system },
          { role: "user", content: sp.user },
        ],
        0.7
      );
      try {
        schedule = JSON.parse(extractJson(scheduleRaw));
      } catch {
        throw new Error("学习计划解析失败,模型未返回有效 JSON。可换个模型重试。");
      }
    }
  } else {
    // 2b. 无知识库：直接用 LLM 排期
    const sp = schedulePrompt(topic, totalDays, dailyTime, mode, undefined, profile);
    const scheduleRaw = await chatOnce(
      model,
      [
        { role: "system", content: sp.system },
        { role: "user", content: sp.user },
      ],
      0.7
    );
    try {
      schedule = JSON.parse(extractJson(scheduleRaw));
    } catch {
      throw new Error("学习计划解析失败,模型未返回有效 JSON。可换个模型重试。");
    }
  }

  await updateCourseJson(courseId, { schedule: JSON.stringify(schedule) });

  // 2. 落库 steps(daily_plan 多 unit 层：每天展开为 1-N 个单元 step)
  onProgress({ stage: "写入学习步骤" });
  await persistScheduleSteps(courseId, schedule);

  // 2.5 若有知识库，为每个单元 step 填充材料引用 source_refs（归因锚点）
  if (knowledgeBase) {
    await populateStepSourceRefs(courseId);
  }

  // 3. 首日首个单元讲义(eager 生成,其余按需)
  onProgress({ stage: "生成首日讲义" });
  const steps = await listSteps(courseId);
  const firstStep = steps.find((s) => s.day_index === 1 && s.need_lecture !== 0);
  const day1 = schedule.days.find((d) => d.day_index === 1);
  if (firstStep) {
    await generateLectureIntoStep(courseId, firstStep, day1, topic, dailyTime, model, knowledgeBase ?? null);
  }

  await updateCourseJson(courseId, { status: "active" });
  onProgress({ stage: "完成" });

  // 后台批量生成剩余讲义(不阻塞返回)
  batchGenerateLectures(courseId, model).catch(() => {
    // 静默失败,不影响主流程
  });

  return courseId;
}

/** 按需生成某个 step(学习单元)的讲义(点开未生成的单元时调用) */
export async function generateLectureForStep(
  courseId: number,
  stepId: number,
  model: string
): Promise<string> {
  const { getCourse, listSteps } = await import("@/lib/db");
  const course = await getCourse(courseId);
  if (!course?.schedule) throw new Error("课程缺少计划数据");
  const schedule: SchedulePayload = JSON.parse(course.schedule);
  const steps = await listSteps(courseId);
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error("找不到该步骤");
  const day = schedule.days.find((d) => d.day_index === step.day_index);

  return generateLectureIntoStep(
    courseId, step, day, course.topic, course.daily_time, model, course.knowledge_base
  );
}

/**
 * 流式生成某个 step 的讲义:边生成边通过 onChunk 回调累计文本,收完落库。
 * 返回完整 Markdown。
 */
export async function streamLectureForStep(
  courseId: number,
  stepId: number,
  model: string,
  onChunk: (accumulated: string) => void
): Promise<string> {
  const { getCourse, listSteps, createLecture, saveLectureContent, getLectureByStep } =
    await import("@/lib/db");
  const course = await getCourse(courseId);
  if (!course?.schedule) throw new Error("课程缺少计划数据");
  const schedule: SchedulePayload = JSON.parse(course.schedule);
  const steps = await listSteps(courseId);
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error("找不到该步骤");
  const day = schedule.days.find((d) => d.day_index === step.day_index);

  const existing = await getLectureByStep(stepId);
  let lectureId = existing?.id;
  if (!lectureId) lectureId = await createLecture(stepId, step.title);

  // 确定性材料注入：先按单元 seg_refs / RAG 解析出相关段落原文（prepareMaterialContext），
  // 再把原文拼进上下文做流式生成（保留流式 UX，无 LLM 工具调用往返）。
  const { prepareMaterialContext } = await import("@/lib/materialGather");
  const { recordMaterialUsage } = await import("@/lib/db");

  const ctx = resolveStepContext(step, day);
  const { contextSection, usedUnitIds } = await prepareMaterialContext(
    courseId, ctx.title, ctx.topicScope, ctx.learningGoal, course.knowledge_base, ctx.dayIndex
  );

  // 掌握度回流（ 自适应）：从历史测验推断薄弱/强项知识点，告诉 LLM 调整讲解重点
  const { calculateMastery, formatMasteryContext } = await import("@/lib/masteryTracking");
  let masteryContext = "";
  try {
    const mastery = await calculateMastery(courseId);
    masteryContext = formatMasteryContext(mastery);
  } catch (e) {
    console.warn("掌握度统计失败，跳过自适应:", e);
  }

  const lp = lecturePrompt(
    course.topic, ctx.title, ctx.learningGoal, ctx.topicScope, course.daily_time, contextSection, masteryContext
  );

  let acc = "";
  await new Promise<void>((resolve, reject) => {
    chatStream(
      model,
      [
        { role: "system", content: lp.system },
        { role: "user", content: lp.user },
      ],
      (e) => {
        if (e.type === "chunk") {
          acc += e.content;
          onChunk(acc);
        } else if (e.type === "error") {
          reject(new Error(e.message));
        } else if (e.type === "done") {
          resolve();
        }
      }
    ).then(resolve).catch(reject);
  });

  const { content_md, suggested_questions } = parseLectureResponse(acc);
  await saveLectureContent(lectureId, content_md, suggested_questions);

  for (const unitId of usedUnitIds) {
    await recordMaterialUsage(courseId, ctx.dayIndex, unitId, 'lecture');
  }
  return content_md;
}

/**
 * 讲义追问:基于当前讲义内容回答,返回答案文本(不追加到讲义)。
 * onChunk 回调收到的是"答案的累积文本"。
 */
export async function askFollowUp(
  courseId: number,
  stepId: number,
  model: string,
  question: string,
  currentMd: string,
  onChunk: (answerText: string) => void
): Promise<string> {
  const { getCourse, listSteps } = await import("@/lib/db");
  const course = await getCourse(courseId);
  const steps = await listSteps(courseId);
  const step = steps.find((s) => s.id === stepId);
  const dayTitle = step?.title ?? "";

  const fp = followUpPrompt(course?.topic ?? "", dayTitle, currentMd, question);

  let answer = "";
  await new Promise<void>((resolve, reject) => {
    chatStream(
      model,
      [
        { role: "system", content: fp.system },
        { role: "user", content: fp.user },
      ],
      (e) => {
        if (e.type === "chunk") {
          answer += e.content;
          onChunk(answer);
        } else if (e.type === "error") {
          reject(new Error(e.message));
        } else if (e.type === "done") {
          resolve();
        }
      }
    ).then(resolve).catch(reject);
  });

  return answer;
}

/**
 * 把预提取的习题候选转换为前端可判分的 QuizQuestion。
 * 关键：answer 存的是“原始答案文本”（如“选项B”/“B”/正确选项内容），
 * 而前端判分比较的是选项 id（a/b/c/d）。这里做映射与题型推断。
 */
function toQuizQuestion(ex: {
  question: string;
  options_json: string | null;
  answer: string;
  explanation: string | null;
}): QuizQuestion {
  const rawAnswer = (ex.answer ?? "").trim();
  const explanation = ex.explanation ?? "";

  let options: string[] = [];
  if (ex.options_json) {
    try {
      const parsed = JSON.parse(ex.options_json);
      if (Array.isArray(parsed)) options = parsed.map((o) => String(o));
    } catch {
      options = [];
    }
  }

  // 无选项 → 按判断/主观处理
  if (options.length === 0) {
    const lower = rawAnswer.toLowerCase();
    const isJudgment = ["true", "false", "正确", "错误", "对", "错"].includes(lower);
    if (isJudgment) {
      const truthy = ["true", "正确", "对"].includes(lower);
      return { kind: "judgment", stem: ex.question, answer: truthy ? "true" : "false", explanation };
    }
    // 归为主观题（不自动判分），保留参考答案
    return { kind: "free_response", stem: ex.question, answer: rawAnswer, explanation };
  }

  // 有选项 → 单选题，选项 id 用 a/b/c/d（与 LLM 生成路径一致）
  const choices = options.map((opt, idx) => ({
    id: String.fromCharCode(97 + idx), // a, b, c, d...
    label: opt,
  }));

  const answerId = mapAnswerToChoiceId(rawAnswer, choices);
  return { kind: "single_choice", stem: ex.question, choices, answer: answerId, explanation };
}

/**
 * 将原始答案文本映射为选项 id（a/b/c...）。按可靠性从高到低匹配：
 * 精确 label > 唯一子串 > 独立字母 token > 序号。
 * 收紧点：子串匹配要求“唯一命中”（多个选项都含该串时不猜）；字母提取只认“独立字母”
 * （前后都不是字母/数字），避免把选项正文里的字母（如 "x86 架构" 的 x）误当作答案编号。
 */
function mapAnswerToChoiceId(
  rawAnswer: string,
  choices: { id: string; label: string }[]
): string {
  const ans = rawAnswer.trim();
  if (!ans) return choices[0]?.id ?? "a";

  // 1) 与某个选项 label 完全一致
  const exact = choices.find((c) => c.label.trim() === ans);
  if (exact) return exact.id;

  // 2) 唯一子串：label 含 ans 或 ans 含 label，且【只有一个】选项命中才采纳
  const substrMatches = choices.filter(
    (c) => c.label.includes(ans) || ans.includes(c.label.trim())
  );
  if (substrMatches.length === 1) return substrMatches[0].id;

  // 3) 独立字母 token（如“选项B”“B.”“答案：C”）：字母前后都不是字母/数字，
  //    避免命中 "x86"、"COVID" 等选项正文里的字母
  const letterMatch = ans.match(/(?:^|[^A-Za-z0-9])([A-Za-z])(?![A-Za-z0-9])/);
  if (letterMatch) {
    const idx = letterMatch[1].toLowerCase().charCodeAt(0) - 97;
    if (idx >= 0 && idx < choices.length) return choices[idx].id;
  }

  // 4) 独立序号（1 → a）：同样要求前后不是数字，避免命中 "2024" 之类
  const numMatch = ans.match(/(?:^|[^\d])(\d+)(?![\d])/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx].id;
  }

  // 兜底：第一个选项（避免 undefined 破坏判分，但记录警告）
  console.warn(
    `[习题解析] 无法映射答案「${rawAnswer}」到任何选项，题目选项：${choices.map(c => c.label).join('/')}，默认使用第一个选项`
  );
  return choices[0]?.id ?? "a";
}

/** 生成某节的测验并落库,返回题目数组 */
export async function generateQuizForStep(
  courseId: number,
  stepId: number,
  model: string
): Promise<QuizPayload> {
  const { getCourse, listSteps, saveTest, getExerciseCandidatesByCourse, recordMaterialUsage } = await import("@/lib/db");
  const course = await getCourse(courseId);
  if (!course?.schedule) throw new Error("课程缺少计划数据");
  const schedule: SchedulePayload = JSON.parse(course.schedule);
  const steps = await listSteps(courseId);
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error("找不到该步骤");
  const day = schedule.days.find((d) => d.day_index === step.day_index);

  // 单元级作用域：优先用该单元的关联知识点，回退到当天主题
  const ctx = resolveStepContext(step, day);
  const scope = ctx.topicScope;

  // 方法 1：优先尝试使用预提取的习题候选
  const exerciseCandidates = await getExerciseCandidatesByCourse(courseId);
  if (exerciseCandidates.length > 0) {
    const { getKnowledgeUnits } = await import("@/lib/db");
    const units = await getKnowledgeUnits(courseId);

    // 找出与本单元作用域相关的知识单元（按单元标题匹配，而非 unit_id slug）
    const relevantUnitIds = new Set(
      units
        .filter(u =>
          scope.some(topic =>
            u.title.toLowerCase().includes(topic.toLowerCase()) ||
            topic.toLowerCase().includes(u.title.toLowerCase())
          )
        )
        .map(u => u.unit_id)
    );

    // 相关习题：所属单元命中作用域，或题干直接包含作用域词
    const relevantExercises = exerciseCandidates.filter(ex =>
      relevantUnitIds.has(ex.unit_id) ||
      scope.some(topic => ex.question.toLowerCase().includes(topic.toLowerCase()))
    ).slice(0, 5);  // 最多 5 道题

    if (relevantExercises.length >= 3) {
      // 有足够的习题，直接使用
      const questions: QuizQuestion[] = relevantExercises.map(ex => toQuizQuestion(ex));
      const payload: QuizPayload = { questions };

      await saveTest(stepId, step.day_index, JSON.stringify(payload));

      // 记录材料使用（测验用途，不占用讲义额度）
      for (const ex of relevantExercises) {
        await recordMaterialUsage(courseId, ctx.dayIndex, ex.unit_id, 'quiz');
      }

      console.log(`[测验生成] 使用 ${relevantExercises.length} 个预提取习题`);
      return payload;
    }
  }

  // 方法 2：从材料生成习题（回退方案）
  // 确定性材料注入：解析出相关段落原文后拼进 prompt 再出题（无 LLM 工具调用）
  const { prepareMaterialContext } = await import("@/lib/materialGather");

  const { contextSection, usedUnitIds } = await prepareMaterialContext(
    courseId, ctx.title, scope, ctx.learningGoal, course.knowledge_base, ctx.dayIndex
  );

  // 掌握度回流（）：自适应测验难度
  const { calculateMastery, formatMasteryContext } = await import("@/lib/masteryTracking");
  let masteryContext = "";
  try {
    const mastery = await calculateMastery(courseId);
    masteryContext = formatMasteryContext(mastery);
  } catch (e) {
    console.warn("掌握度统计失败，跳过自适应:", e);
  }

  const qp = quizPrompt(course.topic, ctx.title, ctx.learningGoal, scope, contextSection, masteryContext);
  const raw = await chatOnce(
    model,
    [
      { role: "system", content: qp.system },
      { role: "user", content: qp.user },
    ],
    0.7
  );
  let payload: QuizPayload;
  try {
    payload = JSON.parse(extractJson(raw));
  } catch {
    throw new Error("测验解析失败,模型未返回有效 JSON。可换个模型重试。");
  }
  if (!payload.questions?.length) throw new Error("测验为空,请重试");
  await saveTest(stepId, step.day_index, JSON.stringify(payload));

  // 记录材料使用（测验用途）
  for (const unitId of usedUnitIds) {
    await recordMaterialUsage(courseId, ctx.dayIndex, unitId, 'quiz');
  }
  return payload;
}

/**
 * 后台批量生成剩余讲义(day 2~N)。
 * 静默执行,失败不抛异常,避免影响主流程。
 */
async function batchGenerateLectures(courseId: number, model: string): Promise<void> {
  const { getCourse, listSteps, getLectureByStep } = await import("@/lib/db");
  const course = await getCourse(courseId);
  if (!course?.schedule) return;
  const schedule: SchedulePayload = JSON.parse(course.schedule);
  const steps = await listSteps(courseId);

  // 需要讲义、且尚未生成的单元 step（首个单元已在主链路 eager 生成，这里跳过已有内容）
  const pending = steps.filter((s) => s.need_lecture !== 0);
  for (const step of pending) {
    try {
      const lecture = await getLectureByStep(step.id);
      if (lecture?.content_md) continue; // 已生成,跳过
      const day = schedule.days.find((d) => d.day_index === step.day_index);

      await generateLectureIntoStep(
        courseId, step, day, course.topic, course.daily_time, model, course.knowledge_base
      );
      console.log(`[后台] 已生成第 ${step.day_index} 天「${step.title}」讲义`);
    } catch (e) {
      console.warn(`[后台] 第 ${step.day_index} 天「${step.title}」讲义生成失败:`, e);
    }
  }
}

/** 主观题 LLM 评分：返回 0-100 分 + 评语 */
export async function gradeFreeResponse(
  model: string,
  stem: string,
  userAnswer: string,
  rubric: string,
  referenceAnswer: string
): Promise<{ score: number; feedback: string }> {
  const { gradeFreeResponsePrompt } = await import("@/lib/prompts");
  const gp = gradeFreeResponsePrompt(stem, userAnswer, rubric, referenceAnswer);
  const raw = await chatOnce(
    model,
    [
      { role: "system", content: gp.system },
      { role: "user", content: gp.user },
    ],
    0.3
  );
  try {
    const parsed = JSON.parse(extractJson(raw)) as { score?: number; feedback?: string };
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    return { score, feedback: parsed.feedback ?? "" };
  } catch {
    throw new Error("评分解析失败，模型未返回有效 JSON。");
  }
}

/** 生成诊断问卷 */
export async function generateDiagnostic(
  topic: string,
  model: string,
  courseId?: number
): Promise<DiagnosticPayload> {
  // ：若课程已建知识库，则基于真实知识单元（标题+概述）出诊断题；
  // 否则回退到只看主题名的原版 prompt（无材料 / 建库失败时）。
  let dp = diagnosticPrompt(topic);
  if (courseId !== undefined) {
    try {
      const { getKnowledgeUnits } = await import("@/lib/db");
      const { diagnosticFromUnitsPrompt } = await import("@/lib/prompts");
      const units = await getKnowledgeUnits(courseId);
      if (units.length > 0) {
        const briefs = units.map((u) => ({ title: u.title, summary: u.summary ?? "" }));
        dp = diagnosticFromUnitsPrompt(topic, briefs);
        console.log(`[诊断问卷] 基于 ${units.length} 个知识单元出题（）`);
      }
    } catch (e) {
      console.warn("[诊断问卷] 读取知识单元失败，回退到主题版:", e);
    }
  }

  const raw = await chatOnce(
    model,
    [
      { role: "system", content: dp.system },
      { role: "user", content: dp.user },
    ],
    0.7
  );
  try {
    return JSON.parse(extractJson(raw));
  } catch {
    throw new Error("诊断问卷解析失败,模型未返回有效 JSON。");
  }
}

/** 生成用户画像 */
export async function generateProfile(
  topic: string,
  questionsJson: string,
  answersJson: string,
  model: string
): Promise<UserProfile> {
  const pp = profilePrompt(topic, questionsJson, answersJson);
  const raw = await chatOnce(
    model,
    [
      { role: "system", content: pp.system },
      { role: "user", content: pp.user },
    ],
    0.7
  );
  try {
    return JSON.parse(extractJson(raw));
  } catch {
    throw new Error("画像解析失败,模型未返回有效 JSON。");
  }
}

/** 默认画像(跳过诊断时使用) */
export function getDefaultProfile(): UserProfile {
  return {
    level: "intermediate",
    learning_style: "reading",
    goal: "systematic",
    daily_time: "1h",
    strengths: [],
    weaknesses: [],
    preferences: ["循序渐进", "理论与实践结合"],
  };
}

/**
 * 重新调整课程排期（压缩或扩展天数）
 */
export async function reschedule(
  courseId: number,
  newTotalDays: number,
  model: string,
  onProgress: (p: GenProgress) => void
): Promise<void> {
  const { getCourse, updateCourseJson, getProfile } = await import("@/lib/db");

  onProgress({ stage: "加载课程信息" });
  const course = await getCourse(courseId);
  if (!course) throw new Error("课程不存在");

  // 获取用户画像
  const profileRecord = await getProfile(courseId);
  const profile: UserProfile | undefined = profileRecord ? JSON.parse(profileRecord.profile_json) : undefined;

  // 重新生成排期
  onProgress({ stage: "重新规划学习计划", detail: `${newTotalDays} 天` });
  const sp = schedulePrompt(
    course.topic,
    newTotalDays,
    course.daily_time,
    course.mode,
    course.knowledge_base ?? undefined,
    profile
  );
  const scheduleRaw = await chatOnce(
    model,
    [
      { role: "system", content: sp.system },
      { role: "user", content: sp.user },
    ],
    0.7
  );

  let schedule: SchedulePayload;
  try {
    schedule = JSON.parse(extractJson(scheduleRaw));
  } catch {
    throw new Error("学习计划解析失败,模型未返回有效 JSON。");
  }

  // 更新课程
  await updateCourseJson(courseId, { schedule: JSON.stringify(schedule) });

  // 删除旧的 steps（注意：会级联删除讲义/测验）
  const db = await import("@tauri-apps/plugin-sql").then(m => m.default.load("sqlite:charon.db"));
  await db.execute("DELETE FROM steps WHERE course_id = $1", [courseId]);

  // 重新创建 steps（daily_plan 多 unit 层）
  onProgress({ stage: "写入新的学习步骤" });
  await persistScheduleSteps(courseId, schedule);

  onProgress({ stage: "完成" });
}
