// 基于知识图谱拓扑排序生成学习计划
// 核心思路：从 knowledge_units 读出 prerequisites，拓扑排序后按天分组，
// 保证学习顺序永远尊重"先学前置、再学后继"的依赖关系。

import type { SchedulePayload, DayUnit } from "@/lib/prompts";

export interface KnowledgeNode {
  unit_id: string;
  title: string;
  summary: string;
  prerequisites: string[]; // 前置单元 unit_id 列表
  can_generate_lecture: boolean;
  can_generate_quiz: boolean;
}

/**
 * Kahn 算法拓扑排序（处理环和孤岛）。
 * 返回合法学习顺序（unit_id 数组）；有环时断开入度最小的边，孤岛放最后。
 */
function topologicalSort(nodes: KnowledgeNode[]): string[] {
  const nodeMap = new Map(nodes.map((n) => [n.unit_id, n]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // parent -> [children]

  // 初始化入度和邻接表
  for (const n of nodes) {
    if (!inDegree.has(n.unit_id)) inDegree.set(n.unit_id, 0);
    if (!adjList.has(n.unit_id)) adjList.set(n.unit_id, []);
    for (const prereq of n.prerequisites) {
      if (nodeMap.has(prereq)) {
        inDegree.set(n.unit_id, (inDegree.get(n.unit_id) ?? 0) + 1);
        const children = adjList.get(prereq) ?? [];
        children.push(n.unit_id);
        adjList.set(prereq, children);
      }
    }
  }

  const result: string[] = [];
  const queue: string[] = [];

  // 把所有入度为 0 的节点入队
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    result.push(cur);
    for (const child of adjList.get(cur) ?? []) {
      const newDeg = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  // 如果有环（剩余节点入度 > 0），断开入度最小的边继续（简单处理：直接按入度排序放后面）
  const remaining = nodes
    .map((n) => n.unit_id)
    .filter((id) => !result.includes(id))
    .sort((a, b) => (inDegree.get(a) ?? 0) - (inDegree.get(b) ?? 0));

  return [...result, ...remaining];
}

/**
 * 把拓扑序按时间预算切成 N 天，每天 1-3 个单元（均匀分配，尊重顺序）。
 */
function splitIntoDays(
  sortedIds: string[],
  nodeMap: Map<string, KnowledgeNode>,
  totalDays: number
): DayUnit[][] {
  if (sortedIds.length === 0 || totalDays <= 0) return [];

  const unitsPerDay = Math.ceil(sortedIds.length / totalDays);
  const days: DayUnit[][] = [];

  for (let d = 0; d < totalDays; d++) {
    const start = d * unitsPerDay;
    const end = Math.min(start + unitsPerDay, sortedIds.length);
    if (start >= sortedIds.length) break;

    const dayUnits: DayUnit[] = [];
    for (let i = start; i < end; i++) {
      const node = nodeMap.get(sortedIds[i]);
      if (!node) continue;
      dayUnits.push({
        order_in_day: dayUnits.length + 1,
        title: node.title,
        objective: node.summary || `学习 ${node.title}`,
        need_lecture: node.can_generate_lecture,
        need_exercise: node.can_generate_quiz,
        related_knowledge_units: [node.unit_id],
        source_refs: [], // 后续 populateStepSourceRefs 会填充
        prerequisites: node.prerequisites,
      });
    }
    days.push(dayUnits);
  }

  return days;
}

/**
 * 从知识图谱生成学习计划（拓扑排序驱动）。
 * 输入：知识单元列表（从 knowledge_units 表读出）+ 时间参数
 * 输出：符合 SchedulePayload 格式的排期
 */
export function scheduleFromKnowledgeGraph(
  nodes: KnowledgeNode[],
  courseTopic: string,
  totalDays: number,
  dailyTime: string
): SchedulePayload {
  if (nodes.length === 0) {
    throw new Error("知识图谱为空，无法生成排期");
  }

  // 1. 拓扑排序
  const sortedIds = topologicalSort(nodes);
  const nodeMap = new Map(nodes.map((n) => [n.unit_id, n]));

  // 2. 按天分组
  const dayUnits = splitIntoDays(sortedIds, nodeMap, totalDays);

  // 3. 构建 SchedulePayload
  const days = dayUnits.map((units, idx) => {
    const dayIndex = idx + 1;
    const titles = units.map((u) => u.title).join("、");
    return {
      day_index: dayIndex,
      day_title: `第 ${dayIndex} 天：${titles.length > 30 ? titles.slice(0, 30) + "..." : titles}`,
      learning_goal: units.map((u) => u.objective).join("；"),
      topic_scope: units.map((u) => u.title),
      estimated_time: dailyTime,
      completion_standard: `完成 ${units.length} 个学习单元`,
      units,
    };
  });

  return {
    course_topic: courseTopic,
    total_days: days.length,
    daily_available_time: dailyTime,
    days,
  };
}
