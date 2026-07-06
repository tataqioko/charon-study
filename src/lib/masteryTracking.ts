// 学习者掌握度追踪（自适应机制）
// 从测验历史推断每个知识单元的掌握程度，回流到后续讲义/测验生成

import { db } from "@/lib/db";

export interface UnitMastery {
  unit_id: string;
  title: string;
  total_questions: number; // 该单元总共做过多少题
  correct_count: number; // 答对多少题
  accuracy: number; // 正确率 0-1
  mastery_level: "weak" | "moderate" | "strong"; // 掌握等级
}

/**
 * 计算课程内每个知识单元的掌握度。
 * 通过 test → step → knowledge_units 关联，统计每个单元相关测验的正确率。
 */
export async function calculateMastery(courseId: number): Promise<UnitMastery[]> {
  const d = await db();

  // JOIN 路径：test_attempts → tests → steps → course_id，
  // 再通过 step.related_units (JSON) 关联到 knowledge_units
  const rows = await d.select<
    Array<{
      step_id: number;
      related_units: string; // JSON 数组
      question_index: number;
      is_correct: number;
    }>
  >(
    `SELECT s.id as step_id, s.related_units, ta.question_index, ta.is_correct
     FROM test_attempts ta
     JOIN tests t ON ta.test_id = t.id
     JOIN steps s ON t.step_id = s.id
     WHERE s.course_id = $1`,
    [courseId]
  );

  // 按 unit_id 聚合统计
  const stats = new Map<
    string,
    { title: string; total: number; correct: number }
  >();

  for (const row of rows) {
    let unitIds: string[] = [];
    try {
      unitIds = JSON.parse(row.related_units || "[]");
    } catch {
      // 旧数据或格式问题，跳过
      continue;
    }

    for (const unitId of unitIds) {
      if (!stats.has(unitId)) {
        stats.set(unitId, { title: unitId, total: 0, correct: 0 });
      }
      const s = stats.get(unitId)!;
      s.total++;
      if (row.is_correct) s.correct++;
    }
  }

  // 从 knowledge_units 表拿标题（关联 unit_id）
  const units = await d.select<Array<{ unit_id: string; title: string }>>(
    `SELECT unit_id, title FROM knowledge_units WHERE course_id = $1`,
    [courseId]
  );
  const titleMap = new Map(units.map((u) => [u.unit_id, u.title]));

  // 转成结果格式
  const result: UnitMastery[] = [];
  for (const [unitId, s] of stats.entries()) {
    if (s.total === 0) continue; // 没做过题的单元跳过
    const accuracy = s.correct / s.total;
    result.push({
      unit_id: unitId,
      title: titleMap.get(unitId) ?? unitId,
      total_questions: s.total,
      correct_count: s.correct,
      accuracy,
      mastery_level: accuracy >= 0.8 ? "strong" : accuracy >= 0.5 ? "moderate" : "weak",
    });
  }

  // 按正确率升序排序（薄弱的在前）
  result.sort((a, b) => a.accuracy - b.accuracy);
  return result;
}

/**
 * 格式化掌握度为人类可读的总结文本（拼进 prompt 用）
 */
export function formatMasteryContext(mastery: UnitMastery[]): string {
  if (mastery.length === 0) return "";

  const weak = mastery.filter((m) => m.mastery_level === "weak");
  const strong = mastery.filter((m) => m.mastery_level === "strong");

  let text = "\n\n**学习者掌握度分析**（基于历史测验表现）：\n";

  if (weak.length > 0) {
    text += `\n薄弱知识点（需加强讲解）：\n`;
    for (const m of weak.slice(0, 5)) {
      // 最多列 5 个
      text += `- ${m.title}（正确率 ${(m.accuracy * 100).toFixed(0)}%）\n`;
    }
  }

  if (strong.length > 0) {
    text += `\n已掌握知识点（可快速带过）：\n`;
    for (const m of strong.slice(0, 3)) {
      text += `- ${m.title}（正确率 ${(m.accuracy * 100).toFixed(0)}%）\n`;
    }
  }

  return text;
}
