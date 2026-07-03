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
}

export interface Lecture {
  id: number;
  step_id: number;
  title: string;
  content_md: string | null;
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
  s: Omit<Step, "id" | "bookmarked">
): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO steps (course_id, day_index, order_in_day, kind, title, objective, status) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [s.course_id, s.day_index, s.order_in_day, s.kind, s.title, s.objective, s.status]
  );
  return res.lastInsertId as number;
}

export async function setStepStatus(stepId: number, status: string): Promise<void> {
  const d = await db();
  await d.execute("UPDATE steps SET status = $2 WHERE id = $1", [stepId, status]);
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

export async function saveLectureContent(id: number, md: string): Promise<void> {
  const d = await db();
  await d.execute(
    "UPDATE lectures SET content_md = $2, status = 'done' WHERE id = $1",
    [id, md]
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

export async function saveDiagnostic(courseId: number, questionsJson: string, answersJson?: string): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO diagnostics (course_id, questions_json, answers_json) VALUES ($1,$2,$3)",
    [courseId, questionsJson, answersJson ?? null]
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
