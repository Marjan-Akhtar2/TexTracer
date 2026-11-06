import type { StageKpi } from "./dashboard.repo";

export interface StageWithFlag extends StageKpi { isBottleneck: boolean }
export interface DepartmentKpi {
  department: string; wip: number; arrivalsTotal: number; arrivals24h: number; avgDwellSeconds: number | null; isBottleneck: boolean;
}

/**
 * Bottleneck rule (FR-8): the stage with the most items currently waiting (WIP);
 * ties are broken by the longer average dwell time. No bottleneck if nothing is in progress.
 */
export function findBottleneckStage(stages: StageKpi[]): string | null {
  let best: StageKpi | null = null;
  for (const s of stages) {
    if (s.wip <= 0) continue;
    if (!best || s.wip > best.wip || (s.wip === best.wip && (s.avgDwellSeconds ?? 0) > (best.avgDwellSeconds ?? 0))) best = s;
  }
  return best?.stage ?? null;
}

export function buildStageReport(stages: StageKpi[]) {
  const bottleneckStage = findBottleneckStage(stages);
  const flagged: StageWithFlag[] = stages.map((s) => ({ ...s, isBottleneck: s.stage === bottleneckStage }));

  const byDept = new Map<string, StageKpi[]>();
  for (const s of stages) byDept.set(s.department, [...(byDept.get(s.department) ?? []), s]);

  const departments: DepartmentKpi[] = [...byDept.entries()].map(([department, rows]) => {
    const withDwell = rows.filter((r) => r.avgDwellSeconds !== null && r.arrivalsTotal > 0);
    const weight = withDwell.reduce((a, r) => a + r.arrivalsTotal, 0);
    const avgDwellSeconds = weight
      ? Math.round(withDwell.reduce((a, r) => a + (r.avgDwellSeconds as number) * r.arrivalsTotal, 0) / weight)
      : null;
    return {
      department,
      wip: rows.reduce((a, r) => a + r.wip, 0),
      arrivalsTotal: rows.reduce((a, r) => a + r.arrivalsTotal, 0),
      arrivals24h: rows.reduce((a, r) => a + r.arrivals24h, 0),
      avgDwellSeconds,
      isBottleneck: rows.some((r) => r.stage === bottleneckStage),
    };
  });
  return { stages: flagged, departments, bottleneckStage, bottleneckDepartment: departments.find((d) => d.isBottleneck)?.department ?? null };
}
