// 滑动上下文窗口：基于覆盖率的材料分配
// 策略：优先选择未使用的知识单元，确保全材料覆盖

/**
 * 滑动窗口检索：基于覆盖率分配知识单元
 */
export async function retrieveWithSlidingWindow(
  courseId: number,
  dayIndex: number,
  topicScope: string[],
  maxUnits: number = 3  // 每次最多 3 个知识单元
): Promise<{ unitIds: string[], contentMap: Map<string, string> }> {
  const { getKnowledgeUnits, getUnusedUnits } = await import("@/lib/db");

  const allUnits = await getKnowledgeUnits(courseId);
  if (allUnits.length === 0) {
    return { unitIds: [], contentMap: new Map() };
  }

  // 获取未使用的知识单元
  const unusedUnitIds = await getUnusedUnits(courseId);

  // 找到相关的知识单元
  const relevantUnits = allUnits.filter(u =>
    topicScope.some(topic =>
      u.title.toLowerCase().includes(topic.toLowerCase()) ||
      topic.toLowerCase().includes(u.title.toLowerCase())
    )
  );

  // 只在“与本节主题相关”的单元里选，覆盖率仅用于在相关集合内排序（未用优先），
  // 绝不用无关单元把窗口补满——否则会给本节讲义注入跑题材料。
  const unusedRelevantUnits = relevantUnits.filter(u => unusedUnitIds.includes(u.unit_id));
  const usedRelevantUnits = relevantUnits.filter(u => !unusedUnitIds.includes(u.unit_id));
  // 相关单元内部：未使用的排前面（提升整体覆盖率），已用过的兜底补齐名额
  const selectedUnits = [...unusedRelevantUnits, ...usedRelevantUnits].slice(0, maxUnits);

  const unitIds = selectedUnits.map(u => u.unit_id);

  // 注意：这里只做“选择”，不记录使用情况。
  // 使用情况应在内容真正生成并落库后，由调用方针对“实际用到的单元”记录，
  // 避免生成失败也把单元标记为已用（会永久排除出后续滑动窗口）。

  const contentMap = new Map<string, string>();

  // 覆盖率退化为“报告指标”：只观测，不驱动选择（选择由相关性决定）
  const coverageRatio = allUnits.length > 0
    ? (allUnits.length - unusedUnitIds.length) / allUnits.length
    : 0;

  console.log(`[滑动窗口] 第 ${dayIndex} 天候选知识单元: ${unitIds.join(', ') || '（本节无相关单元，将回退 RAG）'}`);
  console.log(`[滑动窗口] 全局覆盖率: ${(coverageRatio * 100).toFixed(0)}%（剩余未使用 ${unusedUnitIds.length} 个，仅作报告）`);

  return { unitIds, contentMap };
}
