// 课程生成编排:主题 → 学习计划 → 落库 steps → 首日讲义
// 全在客户端执行,调用 Rust 的 chat_once(锁定站点)。
import { chatOnce, chatStream } from "@/lib/api";
import {
  createCourse, updateCourseJson, createStep, createLecture,
  saveLectureContent, listSteps,
} from "@/lib/db";
import {
  schedulePrompt, lecturePrompt, followUpPrompt, quizPrompt,
  diagnosticPrompt, profilePrompt,
  extractJson, type SchedulePayload, type QuizPayload,
  type DiagnosticPayload, type UserProfile,
} from "@/lib/prompts";

export interface GenProgress {
  stage: string;
  detail?: string;
}

export interface NewCourseInput {
  topic: string;
  mode: string; // daily | sprint | leisure
  totalDays: number;
  dailyTime: string;
  model: string;
  knowledgeBase?: string | null; // 上传的材料文本
}

/**
 * 生成课程主链路。onProgress 回调用于 UI 展示阶段。
 * 返回新课程 id。
 */
export async function generateCourse(
  input: NewCourseInput,
  onProgress: (p: GenProgress) => void
): Promise<number> {
  const { topic, mode, totalDays, dailyTime, model, knowledgeBase } = input;

  onProgress({ stage: "创建课程" });
  const courseId = await createCourse(topic, mode, totalDays, dailyTime, knowledgeBase ?? null);

  // 1. 生成用户画像（当前使用默认画像，后续可加诊断问卷）
  onProgress({ stage: "分析学习画像" });
  const profile = getDefaultProfile();
  const { saveProfile } = await import("@/lib/db");
  await saveProfile(courseId, JSON.stringify(profile));

  // 2. 生成学习计划
  onProgress({ stage: "规划学习计划", detail: `${totalDays} 天` });
  const sp = schedulePrompt(topic, totalDays, dailyTime, mode, knowledgeBase ?? undefined, profile);
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
    throw new Error("学习计划解析失败,模型未返回有效 JSON。可换个模型重试。");
  }
  await updateCourseJson(courseId, { schedule: JSON.stringify(schedule) });

  // 2. 落库 steps(每天一个讲义 step)
  onProgress({ stage: "写入学习步骤" });
  for (const day of schedule.days) {
    await createStep({
      course_id: courseId,
      day_index: day.day_index,
      order_in_day: 1,
      kind: "lecture",
      title: day.day_title,
      objective: day.learning_goal,
      status: day.day_index === 1 ? "active" : "pending",
    });
  }

  // 3. 首日讲义(eager 生成,其余按需)
  onProgress({ stage: "生成首日讲义" });
  const steps = await listSteps(courseId);
  const firstStep = steps.find((s) => s.day_index === 1);
  const day1 = schedule.days.find((d) => d.day_index === 1);
  if (firstStep && day1) {
    const lectureId = await createLecture(firstStep.id, firstStep.title);
    const lp = lecturePrompt(
      topic, day1.day_title, day1.learning_goal, day1.topic_scope, dailyTime
    );
    const md = await chatOnce(
      model,
      [
        { role: "system", content: lp.system },
        { role: "user", content: lp.user },
      ],
      0.8
    );
    await saveLectureContent(lectureId, md);
  }

  await updateCourseJson(courseId, { status: "active" });
  onProgress({ stage: "完成" });

  // 后台批量生成剩余讲义(不阻塞返回)
  batchGenerateLectures(courseId, model).catch(() => {
    // 静默失败,不影响主流程
  });

  return courseId;
}

/** 按需生成某个 step 的讲义(点开未生成的天时调用) */
export async function generateLectureForStep(
  courseId: number,
  stepId: number,
  model: string
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
  if (!day) throw new Error("找不到该天计划");

  let lecture = await getLectureByStep(stepId);
  let lectureId = lecture?.id;
  if (!lectureId) lectureId = await createLecture(stepId, step.title);

  const lp = lecturePrompt(
    course.topic, day.day_title, day.learning_goal, day.topic_scope, course.daily_time
  );
  const md = await chatOnce(
    model,
    [
      { role: "system", content: lp.system },
      { role: "user", content: lp.user },
    ],
    0.8
  );
  await saveLectureContent(lectureId, md);
  return md;
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
  if (!day) throw new Error("找不到该天计划");

  const existing = await getLectureByStep(stepId);
  let lectureId = existing?.id;
  if (!lectureId) lectureId = await createLecture(stepId, step.title);

  const lp = lecturePrompt(
    course.topic, day.day_title, day.learning_goal, day.topic_scope, course.daily_time
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

  await saveLectureContent(lectureId, acc);
  return acc;
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

/** 生成某节的测验并落库,返回题目数组 */
export async function generateQuizForStep(
  courseId: number,
  stepId: number,
  model: string
): Promise<QuizPayload> {
  const { getCourse, listSteps, saveTest } = await import("@/lib/db");
  const course = await getCourse(courseId);
  if (!course?.schedule) throw new Error("课程缺少计划数据");
  const schedule: SchedulePayload = JSON.parse(course.schedule);
  const steps = await listSteps(courseId);
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error("找不到该步骤");
  const day = schedule.days.find((d) => d.day_index === step.day_index);
  if (!day) throw new Error("找不到该天计划");

  const qp = quizPrompt(course.topic, day.day_title, day.learning_goal, day.topic_scope);
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
  return payload;
}

/**
 * 后台批量生成剩余讲义(day 2~N)。
 * 静默执行,失败不抛异常,避免影响主流程。
 */
async function batchGenerateLectures(courseId: number, model: string): Promise<void> {
  const { getCourse, listSteps, getLectureByStep, createLecture, saveLectureContent } =
    await import("@/lib/db");
  const course = await getCourse(courseId);
  if (!course?.schedule) return;
  const schedule: SchedulePayload = JSON.parse(course.schedule);
  const steps = await listSteps(courseId);

  // 筛选 day_index > 1 且未生成讲义的步骤
  const pending = steps.filter((s) => s.day_index > 1);
  for (const step of pending) {
    try {
      const lecture = await getLectureByStep(step.id);
      if (lecture?.content_md) continue; // 已生成,跳过
      const day = schedule.days.find((d) => d.day_index === step.day_index);
      if (!day) continue;

      const lectureId = lecture?.id ?? await createLecture(step.id, step.title);
      const lp = lecturePrompt(
        course.topic, day.day_title, day.learning_goal, day.topic_scope, course.daily_time
      );
      const md = await chatOnce(
        model,
        [
          { role: "system", content: lp.system },
          { role: "user", content: lp.user },
        ],
        0.8
      );
      await saveLectureContent(lectureId, md);
      console.log(`[后台] 已生成第 ${step.day_index} 天讲义`);
    } catch (e) {
      console.warn(`[后台] 第 ${step.day_index} 天讲义生成失败:`, e);
    }
  }
}

/** 生成诊断问卷 */
export async function generateDiagnostic(topic: string, model: string): Promise<DiagnosticPayload> {
  const dp = diagnosticPrompt(topic);
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

  // 重新创建 steps
  onProgress({ stage: "写入新的学习步骤" });
  const { createStep } = await import("@/lib/db");
  for (const day of schedule.days) {
    await createStep({
      course_id: courseId,
      day_index: day.day_index,
      order_in_day: 1,
      kind: "lecture",
      title: day.day_title,
      objective: day.learning_goal,
      status: day.day_index === 1 ? "active" : "pending",
    });
  }

  onProgress({ stage: "完成" });
}
