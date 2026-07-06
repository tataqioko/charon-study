// SQLite 数据访问层。数据库结构见 src-tauri/src/lib.rs 的 migrations()
import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;

export function db(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:charon.db");
  return dbPromise;
}

export interface Course {
  id: number;
  topic: string;
  mode: string;
  total_days: number;
  daily_time: string;
  status: string;
  knowledge_base: string | null;
  schedule: string | null;
  profile: string | null;
  created_at: string;
}

export interface Step {
  id: number;
  course_id: number;
  day_index: number;
  order_in_day: number;
  kind: string;
  title: string;
  objective: string | null;
  status: string;
  bookmarked: number;
  // daily_plan 多 unit 层：单元级元数据
  need_lecture: number; // 是否需要讲义（1/0）
  need_exercise: number; // 是否需要练习（1/0）
  related_units: string | null; // JSON 数组：关联知识单元 unit_id
  source_refs: string | null; // JSON 数组：材料引用（material:xxx）
  prerequisites: string | null; // JSON 数组：前置单元
}

export interface Lecture {
  id: number;
  step_id: number;
  title: string;
  content_md: string | null;
  suggested_questions: string | null; // JSON 数组
  status: string;
  created_at: string;
}

export async function listCourses(): Promise<Course[]> {
  const d = await db();
  return d.select<Course[]>("SELECT * FROM courses ORDER BY created_at DESC");
}

// ---- 笔记 / 高亮 ----
export interface Note {
  id: number;
  step_id: number;
  kind: string; // highlight | note
  anchor_text: string | null;
  body: string | null;
  color: string;
  hl_start: number | null;
  hl_end: number | null;
  created_at: string;
}

export async function listNotes(stepId: number): Promise<Note[]> {
  const d = await db();
  return d.select<Note[]>(
    "SELECT * FROM notes WHERE step_id = $1 ORDER BY created_at",
    [stepId]
  );
}

export async function createNote(
  stepId: number, kind: string, anchorText: string, body: string, color: string,
  hlStart: number | null = null, hlEnd: number | null = null
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO notes (step_id, kind, anchor_text, body, color, hl_start, hl_end) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [stepId, kind, anchorText, body, color, hlStart, hlEnd]
  );
  return res.lastInsertId as number;
}

export async function deleteNote(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM notes WHERE id = $1", [id]);
}

export async function updateNoteOffsets(id: number, start: number, end: number): Promise<void> {
  const d = await db();
  await d.execute("UPDATE notes SET hl_start = $2, hl_end = $3 WHERE id = $1", [id, start, end]);
}

export async function getCourse(id: number): Promise<Course | null> {
  const d = await db();
  const rows = await d.select<Course[]>("SELECT * FROM courses WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createCourse(
  topic: string,
  mode: string,
  totalDays: number,
  dailyTime: string,
  knowledgeBase: string | null = null
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO courses (topic, mode, total_days, daily_time, knowledge_base) VALUES ($1, $2, $3, $4, $5)",
    [topic, mode, totalDays, dailyTime, knowledgeBase]
  );
  return res.lastInsertId as number;
}

export async function updateCourseJson(
  id: number,
  fields: Partial<Pick<Course, "knowledge_base" | "schedule" | "profile" | "status">>
): Promise<void> {
  const d = await db();
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await d.execute(`UPDATE courses SET ${set} WHERE id = $1`, [
    id,
    ...keys.map((k) => (fields as Record<string, unknown>)[k]),
  ]);
}

export async function createStep(
  s: Omit<Step, "id" | "bookmarked"> &
    Partial<Pick<Step, "need_lecture" | "need_exercise" | "related_units" | "source_refs" | "prerequisites">>
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO steps
       (course_id, day_index, order_in_day, kind, title, objective, status,
        need_lecture, need_exercise, related_units, source_refs, prerequisites)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      s.course_id, s.day_index, s.order_in_day, s.kind, s.title, s.objective, s.status,
      s.need_lecture ?? 1, s.need_exercise ?? 0,
      s.related_units ?? null, s.source_refs ?? null, s.prerequisites ?? null,
    ]
  );
  return res.lastInsertId as number;
}

export async function setStepStatus(stepId: number, status: string): Promise<void> {
  const d = await db();
  await d.execute("UPDATE steps SET status = $2 WHERE id = $1", [stepId, status]);
}

/** 更新某个 step 的材料引用（归因锚点，JSON 数组字符串） */
export async function updateStepSourceRefs(stepId: number, sourceRefs: string[]): Promise<void> {
  const d = await db();
  await d.execute("UPDATE steps SET source_refs = $2 WHERE id = $1", [
    stepId,
    JSON.stringify(sourceRefs),
  ]);
}

export async function toggleStepBookmark(stepId: number, on: boolean): Promise<void> {
  const d = await db();
  await d.execute("UPDATE steps SET bookmarked = $2 WHERE id = $1", [stepId, on ? 1 : 0]);
}

export async function listSteps(courseId: number): Promise<Step[]> {
  const d = await db();
  return d.select<Step[]>(
    "SELECT * FROM steps WHERE course_id = $1 ORDER BY day_index, order_in_day",
    [courseId]
  );
}

export async function createLecture(stepId: number, title: string): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO lectures (step_id, title, status) VALUES ($1, $2, 'pending')",
    [stepId, title]
  );
  return res.lastInsertId as number;
}

export async function saveLectureContent(
  id: number,
  md: string,
  suggestedQuestions?: string[]
): Promise<void> {
  const d = await db();
  const questionsJson = suggestedQuestions ? JSON.stringify(suggestedQuestions) : null;
  await d.execute(
    "UPDATE lectures SET content_md = $2, suggested_questions = $3, status = 'done' WHERE id = $1",
    [id, md, questionsJson]
  );
}

export async function getLectureByStep(stepId: number): Promise<Lecture | null> {
  const d = await db();
  const rows = await d.select<Lecture[]>(
    "SELECT * FROM lectures WHERE step_id = $1 LIMIT 1",
    [stepId]
  );
  return rows[0] ?? null;
}

export async function deleteCourse(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM courses WHERE id = $1", [id]);
}

// ---- 测验 ----
export interface Test {
  id: number;
  step_id: number;
  day_index: number;
  questions_json: string | null;
  status: string;
}

export async function getTestByStep(stepId: number): Promise<Test | null> {
  const d = await db();
  const rows = await d.select<Test[]>("SELECT * FROM tests WHERE step_id = $1 LIMIT 1", [stepId]);
  return rows[0] ?? null;
}

export async function saveTest(
  stepId: number, dayIndex: number, questionsJson: string
): Promise<number> {
  const d = await db();
  const existing = await getTestByStep(stepId);
  if (existing) {
    await d.execute("UPDATE tests SET questions_json = $2, status = 'ready' WHERE id = $1", [existing.id, questionsJson]);
    return existing.id;
  }
  const res = await d.execute(
    "INSERT INTO tests (step_id, day_index, questions_json, status) VALUES ($1,$2,$3,'ready')",
    [stepId, dayIndex, questionsJson]
  );
  return res.lastInsertId as number;
}

// ---- 测验答题记录 ----
export interface TestAttempt {
  id: number;
  test_id: number;
  question_index: number;
  user_answer: string;
  is_correct: number;
  created_at: string;
}

export async function saveTestAttempt(
  testId: number,
  questionIndex: number,
  userAnswer: string,
  isCorrect: boolean
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO test_attempts (test_id, question_index, user_answer, is_correct) VALUES ($1,$2,$3,$4)",
    [testId, questionIndex, userAnswer, isCorrect ? 1 : 0]
  );
  return res.lastInsertId as number;
}

export async function getTestAttempts(testId: number): Promise<TestAttempt[]> {
  const d = await db();
  return d.select<TestAttempt[]>(
    "SELECT * FROM test_attempts WHERE test_id = $1 ORDER BY question_index",
    [testId]
  );
}

export async function getWrongAnswers(courseId: number): Promise<Array<TestAttempt & { questions_json: string; step_id: number }>> {
  const d = await db();
  return d.select<Array<TestAttempt & { questions_json: string; step_id: number }>>(
    `SELECT ta.*, t.questions_json, t.step_id
     FROM test_attempts ta
     JOIN tests t ON ta.test_id = t.id
     JOIN steps s ON t.step_id = s.id
     WHERE s.course_id = $1 AND ta.is_correct = 0
     ORDER BY ta.created_at DESC`,
    [courseId]
  );
}

// ---- 问答(追问) ----
export interface QA {
  id: number;
  step_id: number;
  question: string;
  answer: string;
  created_at: string;
}

export async function listQA(stepId: number): Promise<QA[]> {
  const d = await db();
  return d.select<QA[]>(
    "SELECT * FROM qa WHERE step_id = $1 ORDER BY created_at",
    [stepId]
  );
}

export async function createQA(
  stepId: number, question: string, answer: string
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO qa (step_id, question, answer) VALUES ($1,$2,$3)",
    [stepId, question, answer]
  );
  return res.lastInsertId as number;
}

export async function deleteQA(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM qa WHERE id = $1", [id]);
}

// ---- 诊断问卷 & 用户画像 ----
export interface Diagnostic {
  id: number;
  course_id: number;
  questions_json: string;
  answers_json: string | null;
  created_at: string;
}

export interface Profile {
  id: number;
  course_id: number;
  profile_json: string;
  created_at: string;
}

export async function saveDiagnostic(
  courseId: number,
  questionsJson: string,
  answersJson?: string,
  customAnswersJson?: string
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO diagnostics (course_id, questions_json, answers_json, custom_answers_json) VALUES ($1,$2,$3,$4)",
    [courseId, questionsJson, answersJson ?? null, customAnswersJson ?? null]
  );
  return res.lastInsertId as number;
}

export async function getDiagnostic(courseId: number): Promise<Diagnostic | null> {
  const d = await db();
  const rows = await d.select<Diagnostic[]>("SELECT * FROM diagnostics WHERE course_id = $1 LIMIT 1", [courseId]);
  return rows[0] ?? null;
}

export async function updateDiagnosticAnswers(courseId: number, answersJson: string): Promise<void> {
  const d = await db();
  await d.execute("UPDATE diagnostics SET answers_json = $2 WHERE course_id = $1", [courseId, answersJson]);
}

export async function saveProfile(courseId: number, profileJson: string): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO profiles (course_id, profile_json) VALUES ($1,$2)",
    [courseId, profileJson]
  );
  return res.lastInsertId as number;
}

export async function getProfile(courseId: number): Promise<Profile | null> {
  const d = await db();
  const rows = await d.select<Profile[]>("SELECT * FROM profiles WHERE course_id = $1 LIMIT 1", [courseId]);
  return rows[0] ?? null;
}

// ---- FSRS 复习系统 ----
export interface Card {
  id: number;
  step_id: number;
  state: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  last_review: string | null;
  created_at: string;
}

export interface ReviewLog {
  id: number;
  card_id: number;
  rating: number;
  state: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  review_time: string;
}

export async function getCardByStep(stepId: number): Promise<Card | null> {
  const d = await db();
  const rows = await d.select<Card[]>("SELECT * FROM cards WHERE step_id = $1 LIMIT 1", [stepId]);
  return rows[0] ?? null;
}

export async function createCard(card: Omit<Card, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO cards (step_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [card.step_id, card.state, card.due, card.stability, card.difficulty, card.elapsed_days, card.scheduled_days, card.reps, card.lapses, card.last_review]
  );
  return res.lastInsertId as number;
}

export async function updateCard(card: Card): Promise<void> {
  const d = await db();
  await d.execute(
    `UPDATE cards SET state=$2, due=$3, stability=$4, difficulty=$5, elapsed_days=$6, scheduled_days=$7, reps=$8, lapses=$9, last_review=$10 WHERE id=$1`,
    [card.id, card.state, card.due, card.stability, card.difficulty, card.elapsed_days, card.scheduled_days, card.reps, card.lapses, card.last_review]
  );
}

export async function createReviewLog(log: Omit<ReviewLog, "id" | "review_time">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO reviews (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [log.card_id, log.rating, log.state, log.due, log.stability, log.difficulty, log.elapsed_days, log.scheduled_days]
  );
  return res.lastInsertId as number;
}

export async function getDueCards(courseId: number, now: string): Promise<Card[]> {
  const d = await db();
  return d.select<Card[]>(
    `SELECT cards.* FROM cards
     JOIN steps ON cards.step_id = steps.id
     WHERE steps.course_id = $1 AND cards.due <= $2
     ORDER BY cards.due`,
    [courseId, now]
  );
}

export async function getCardStats(courseId: number): Promise<{ new: number; learning: number; review: number; total: number }> {
  const d = await db();
  const rows = await d.select<{ state: string; count: number }[]>(
    `SELECT cards.state, COUNT(*) as count FROM cards
     JOIN steps ON cards.step_id = steps.id
     WHERE steps.course_id = $1
     GROUP BY cards.state`,
    [courseId]
  );
  const stats = { new: 0, learning: 0, review: 0, total: 0 };
  for (const r of rows) {
    if (r.state === "new") stats.new = r.count;
    else if (r.state === "learning" || r.state === "relearning") stats.learning += r.count;
    else if (r.state === "review") stats.review = r.count;
    stats.total += r.count;
  }
  return stats;
}

// ---- 知识单元（Knowledge Units）----

export interface KnowledgeUnit {
  id: number;
  course_id: number;
  unit_id: string;
  title: string;
  summary: string | null;
  prerequisites: string | null; // JSON 数组
  can_generate_lecture: number;
  can_generate_quiz: number;
  created_at: string;
}

export interface SourceLocation {
  id: number;
  unit_id: number;
  file_name: string;
  material_index: number;
  page_start: number | null;
  page_end: number | null;
  char_count: number | null;
  content_preview: string | null;
  seg_refs: string | null; // JSON 数组，如 ["material:0:seg_3"]；旧数据为 null（回退整文件注入）
  created_at: string;
}

export async function createKnowledgeUnit(unit: Omit<KnowledgeUnit, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO knowledge_units (course_id, unit_id, title, summary, prerequisites, can_generate_lecture, can_generate_quiz)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [unit.course_id, unit.unit_id, unit.title, unit.summary, unit.prerequisites, unit.can_generate_lecture ? 1 : 0, unit.can_generate_quiz ? 1 : 0]
  );
  return res.lastInsertId as number;
}

export async function createSourceLocation(loc: Omit<SourceLocation, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO source_locations (unit_id, file_name, material_index, page_start, page_end, char_count, content_preview, seg_refs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [loc.unit_id, loc.file_name, loc.material_index, loc.page_start, loc.page_end, loc.char_count, loc.content_preview, loc.seg_refs ?? null]
  );
  return res.lastInsertId as number;
}

export async function getKnowledgeUnits(courseId: number): Promise<KnowledgeUnit[]> {
  const d = await db();
  return d.select<KnowledgeUnit[]>(
    `SELECT * FROM knowledge_units WHERE course_id = $1 ORDER BY unit_id`,
    [courseId]
  );
}

export async function getSourceLocations(unitId: number): Promise<SourceLocation[]> {
  const d = await db();
  return d.select<SourceLocation[]>(
    `SELECT * FROM source_locations WHERE unit_id = $1`,
    [unitId]
  );
}

// ---- Material Segments（入库时切段，source_locations 段级对齐）----

export interface MaterialSegment {
  id: number;
  course_id: number;
  material_index: number;
  file_name: string;
  seg_index: number;
  char_start: number;
  char_end: number;
  content: string;
  created_at: string;
}

export async function createMaterialSegment(seg: Omit<MaterialSegment, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO material_segments (course_id, material_index, file_name, seg_index, char_start, char_end, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [seg.course_id, seg.material_index, seg.file_name, seg.seg_index, seg.char_start, seg.char_end, seg.content]
  );
  return res.lastInsertId as number;
}

export async function getMaterialSegments(courseId: number): Promise<MaterialSegment[]> {
  const d = await db();
  return d.select<MaterialSegment[]>(
    `SELECT * FROM material_segments WHERE course_id = $1 ORDER BY material_index, seg_index`,
    [courseId]
  );
}

/** 按段 ref（material:<material_index>:seg_<seg_index>）取单段原文；找不到返回 null。 */
export async function getSegmentByRef(courseId: number, materialIndex: number, segIndex: number): Promise<MaterialSegment | null> {
  const d = await db();
  const rows = await d.select<MaterialSegment[]>(
    `SELECT * FROM material_segments WHERE course_id = $1 AND material_index = $2 AND seg_index = $3 LIMIT 1`,
    [courseId, materialIndex, segIndex]
  );
  return rows[0] ?? null;
}

export async function getUnitsByIds(courseId: number, unitIds: string[]): Promise<KnowledgeUnit[]> {
  if (unitIds.length === 0) return [];
  const d = await db();
  // 安全：验证所有 unitIds 只包含字母数字和下划线，防止 SQL 注入
  const safeIds = unitIds.filter(id => /^[a-zA-Z0-9_]+$/.test(id));
  if (safeIds.length !== unitIds.length) {
    console.warn('getUnitsByIds: 过滤了非法 unit_id');
  }
  if (safeIds.length === 0) return [];
  const placeholders = safeIds.map((_, i) => `$${i + 2}`).join(',');
  return d.select<KnowledgeUnit[]>(
    `SELECT * FROM knowledge_units WHERE course_id = $1 AND unit_id IN (${placeholders})`,
    [courseId, ...safeIds]
  );
}

// ---- Materials（材料管理，）----

export interface Material {
  id: number;
  course_id: number;
  file_name: string;
  mime_type: string;
  kind: string; // image, pdf, document, text
  file_size: number | null;
  preview_url: string | null;
  ocr_text: string | null;
  status: string;
  created_at: string;
}

export async function createMaterial(material: Omit<Material, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO materials (course_id, file_name, mime_type, kind, file_size, preview_url, ocr_text, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [material.course_id, material.file_name, material.mime_type, material.kind, material.file_size, material.preview_url, material.ocr_text, material.status]
  );
  return res.lastInsertId as number;
}

export async function getMaterials(courseId: number): Promise<Material[]> {
  const d = await db();
  return d.select<Material[]>(
    `SELECT * FROM materials WHERE course_id = $1 ORDER BY created_at`,
    [courseId]
  );
}

export async function updateMaterialStatus(materialId: number, status: string, ocrText?: string): Promise<void> {
  const d = await db();
  if (ocrText !== undefined) {
    await d.execute(
      `UPDATE materials SET status = $2, ocr_text = $3 WHERE id = $1`,
      [materialId, status, ocrText]
    );
  } else {
    await d.execute(
      `UPDATE materials SET status = $2 WHERE id = $1`,
      [materialId, status]
    );
  }
}

// ---- Knowledge Hierarchy（知识层级图谱）----

export interface KnowledgeHierarchy {
  id: number;
  course_id: number;
  parent_unit_id: string;
  child_unit_id: string;
  created_at: string;
}

export async function createKnowledgeHierarchy(
  courseId: number,
  parentUnitId: string,
  childUnitId: string
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO knowledge_hierarchy (course_id, parent_unit_id, child_unit_id)
     VALUES ($1, $2, $3)`,
    [courseId, parentUnitId, childUnitId]
  );
  return res.lastInsertId as number;
}

export async function getKnowledgeHierarchy(courseId: number): Promise<KnowledgeHierarchy[]> {
  const d = await db();
  return d.select<KnowledgeHierarchy[]>(
    `SELECT * FROM knowledge_hierarchy WHERE course_id = $1`,
    [courseId]
  );
}

// ---- Course Preferences（课程偏好）----

export interface CoursePreferences {
  id: number;
  course_id: number;
  is_exam_prep: number;
  exam_material_ids: string | null; // JSON 数组
  learning_goal_option: string | null;
  learning_goal_custom_text: string | null;
  teaching_style_option: string | null;
  teaching_style_custom_text: string | null;
  ppt_scope_mode: string | null;
  ppt_scope_option: string | null;
  ppt_focus_text: string | null;
  diagnostic_custom_focus: string | null; // JSON 数组
  created_at: string;
}

export async function saveCoursePreferences(prefs: Omit<CoursePreferences, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO course_preferences
     (course_id, is_exam_prep, exam_material_ids, learning_goal_option, learning_goal_custom_text,
      teaching_style_option, teaching_style_custom_text, ppt_scope_mode, ppt_scope_option,
      ppt_focus_text, diagnostic_custom_focus)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT(course_id) DO UPDATE SET
       is_exam_prep = excluded.is_exam_prep,
       exam_material_ids = excluded.exam_material_ids,
       learning_goal_option = excluded.learning_goal_option,
       learning_goal_custom_text = excluded.learning_goal_custom_text,
       teaching_style_option = excluded.teaching_style_option,
       teaching_style_custom_text = excluded.teaching_style_custom_text,
       ppt_scope_mode = excluded.ppt_scope_mode,
       ppt_scope_option = excluded.ppt_scope_option,
       ppt_focus_text = excluded.ppt_focus_text,
       diagnostic_custom_focus = excluded.diagnostic_custom_focus`,
    [prefs.course_id, prefs.is_exam_prep, prefs.exam_material_ids, prefs.learning_goal_option,
     prefs.learning_goal_custom_text, prefs.teaching_style_option, prefs.teaching_style_custom_text,
     prefs.ppt_scope_mode, prefs.ppt_scope_option, prefs.ppt_focus_text, prefs.diagnostic_custom_focus]
  );
  return res.lastInsertId as number;
}

export async function getCoursePreferences(courseId: number): Promise<CoursePreferences | null> {
  const d = await db();
  const rows = await d.select<CoursePreferences[]>(
    `SELECT * FROM course_preferences WHERE course_id = $1 LIMIT 1`,
    [courseId]
  );
  return rows[0] ?? null;
}

export async function updateCoursePreferences(
  courseId: number,
  fields: Partial<Omit<CoursePreferences, "id" | "course_id" | "created_at">>
): Promise<void> {
  const d = await db();
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await d.execute(
    `UPDATE course_preferences SET ${set} WHERE course_id = $1`,
    [courseId, ...keys.map((k) => (fields as Record<string, unknown>)[k])]
  );
}

// ---- Examples（示例库）----

export interface Example {
  id: number;
  course_id: number;
  unit_id: string;
  title: string;
  content: string;
  source_ref: string;
  created_at: string;
}

export async function createExample(example: Omit<Example, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO examples (course_id, unit_id, title, content, source_ref)
     VALUES ($1, $2, $3, $4, $5)`,
    [example.course_id, example.unit_id, example.title, example.content, example.source_ref]
  );
  return res.lastInsertId as number;
}

export async function getExamplesByUnit(courseId: number, unitId: string): Promise<Example[]> {
  const d = await db();
  return d.select<Example[]>(
    `SELECT * FROM examples WHERE course_id = $1 AND unit_id = $2`,
    [courseId, unitId]
  );
}

export async function getExamplesByCourse(courseId: number): Promise<Example[]> {
  const d = await db();
  return d.select<Example[]>(
    `SELECT * FROM examples WHERE course_id = $1`,
    [courseId]
  );
}

// ---- Exercise Candidates（习题候选库）----

export interface ExerciseCandidate {
  id: number;
  course_id: number;
  unit_id: string;
  question: string;
  options_json: string | null;
  answer: string;
  explanation: string | null;
  difficulty: string | null;
  source_ref: string;
  created_at: string;
}

export async function createExerciseCandidate(exercise: Omit<ExerciseCandidate, "id" | "created_at">): Promise<number> {
  const d = await db();
  const res = await d.execute(
    `INSERT INTO exercise_candidates (course_id, unit_id, question, options_json, answer, explanation, difficulty, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [exercise.course_id, exercise.unit_id, exercise.question, exercise.options_json, exercise.answer, exercise.explanation, exercise.difficulty, exercise.source_ref]
  );
  return res.lastInsertId as number;
}

export async function getExerciseCandidatesByUnit(courseId: number, unitId: string): Promise<ExerciseCandidate[]> {
  const d = await db();
  return d.select<ExerciseCandidate[]>(
    `SELECT * FROM exercise_candidates WHERE course_id = $1 AND unit_id = $2`,
    [courseId, unitId]
  );
}

export async function getExerciseCandidatesByCourse(courseId: number): Promise<ExerciseCandidate[]> {
  const d = await db();
  return d.select<ExerciseCandidate[]>(
    `SELECT * FROM exercise_candidates WHERE course_id = $1`,
    [courseId]
  );
}

// ---- Material Coverage（材料覆盖率跟踪）----

export interface MaterialCoverage {
  id: number;
  course_id: number;
  day_index: number;
  unit_id: string;
  usage_type: string; // 'lecture' | 'quiz' | 'example'
  created_at: string;
}

export async function recordMaterialUsage(
  courseId: number,
  dayIndex: number,
  unitId: string,
  usageType: string
): Promise<void> {
  const d = await db();
  await d.execute(
    `INSERT OR IGNORE INTO material_coverage (course_id, day_index, unit_id, usage_type)
     VALUES ($1, $2, $3, $4)`,
    [courseId, dayIndex, unitId, usageType]
  );
}

export async function getMaterialCoverage(courseId: number): Promise<MaterialCoverage[]> {
  const d = await db();
  return d.select<MaterialCoverage[]>(
    `SELECT * FROM material_coverage WHERE course_id = $1 ORDER BY day_index`,
    [courseId]
  );
}

export async function getCoverageStats(courseId: number): Promise<{
  totalUnits: number;
  coveredUnits: number;
  coverageRatio: number;
}> {
  const d = await db();

  // 总知识单元数
  const totalResult = await d.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM knowledge_units WHERE course_id = $1`,
    [courseId]
  );
  const totalUnits = totalResult[0]?.count ?? 0;

  // 已使用的知识单元数（去重）
  const coveredResult = await d.select<{ count: number }[]>(
    `SELECT COUNT(DISTINCT unit_id) as count FROM material_coverage WHERE course_id = $1`,
    [courseId]
  );
  const coveredUnits = coveredResult[0]?.count ?? 0;

  const coverageRatio = totalUnits > 0 ? coveredUnits / totalUnits : 0;

  return { totalUnits, coveredUnits, coverageRatio };
}

/**
 * 返回尚未被“讲义”使用过的知识单元。
 * 只按 usage_type='lecture' 过滤：测验（quiz）消耗的单元不应把它排除出讲义滑动窗口。
 */
export async function getUnusedUnits(courseId: number): Promise<string[]> {
  const d = await db();
  const result = await d.select<{ unit_id: string }[]>(
    `SELECT unit_id FROM knowledge_units
     WHERE course_id = $1
     AND unit_id NOT IN (
       SELECT DISTINCT unit_id FROM material_coverage
       WHERE course_id = $1 AND usage_type = 'lecture'
     )`,
    [courseId]
  );
  return result.map(r => r.unit_id);
}

