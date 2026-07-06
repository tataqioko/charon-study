// 材料覆盖率统计工具
import { getCoverageStats, getMaterialCoverage, getKnowledgeUnits } from "@/lib/db";

export interface CoverageReport {
  totalUnits: number;
  coveredUnits: number;
  coverageRatio: number;
  unusedUnits: string[];
  dayBreakdown: {
    dayIndex: number;
    unitIds: string[];
    usageTypes: string[];
  }[];
}

/**
 * 生成课程材料覆盖率报告
 */
export async function generateCoverageReport(courseId: number): Promise<CoverageReport> {
  // 获取总体覆盖率
  const stats = await getCoverageStats(courseId);

  // 获取所有知识单元
  const allUnits = await getKnowledgeUnits(courseId);

  // 获取详细的使用记录
  const coverage = await getMaterialCoverage(courseId);

  // 找出未使用的单元
  const usedUnitIds = new Set(coverage.map(c => c.unit_id));
  const unusedUnits = allUnits
    .filter(u => !usedUnitIds.has(u.unit_id))
    .map(u => u.unit_id);

  // 按天分组统计
  const dayMap = new Map<number, { unitIds: Set<string>; usageTypes: Set<string> }>();
  for (const c of coverage) {
    if (!dayMap.has(c.day_index)) {
      dayMap.set(c.day_index, { unitIds: new Set(), usageTypes: new Set() });
    }
    const day = dayMap.get(c.day_index)!;
    day.unitIds.add(c.unit_id);
    day.usageTypes.add(c.usage_type);
  }

  const dayBreakdown = Array.from(dayMap.entries())
    .map(([dayIndex, data]) => ({
      dayIndex,
      unitIds: Array.from(data.unitIds),
      usageTypes: Array.from(data.usageTypes),
    }))
    .sort((a, b) => a.dayIndex - b.dayIndex);

  return {
    totalUnits: stats.totalUnits,
    coveredUnits: stats.coveredUnits,
    coverageRatio: stats.coverageRatio,
    unusedUnits,
    dayBreakdown,
  };
}

/**
 * 打印覆盖率报告（用于调试）
 */
export function printCoverageReport(report: CoverageReport): void {
  console.log("=== 材料覆盖率报告 ===");
  console.log(`总知识单元: ${report.totalUnits}`);
  console.log(`已使用单元: ${report.coveredUnits}`);
  console.log(`覆盖率: ${(report.coverageRatio * 100).toFixed(1)}%`);

  if (report.unusedUnits.length > 0) {
    console.log(`未使用单元 (${report.unusedUnits.length}): ${report.unusedUnits.join(', ')}`);
  } else {
    console.log("✓ 所有材料已全部覆盖");
  }

  console.log("\n--- 每日材料分配 ---");
  for (const day of report.dayBreakdown) {
    console.log(`第 ${day.dayIndex} 天: ${day.unitIds.join(', ')} (${day.usageTypes.join(', ')})`);
  }
}
