import type { Db } from "../../db/pool";
import { AWAITING_GATE, REWORK_COMPLETED } from "../products/products.sql";

export interface KpiSummary {
  itemsInProgress: number; itemsShipped: number; rejectionRatePct: number | null; avgCycleTimeSeconds: number | null;
  stalledItems: number; anchorsConfirmed: number; anchorsPending: number;
}
export interface StageKpi {
  seq: number; stage: string; department: string; wip: number; arrivalsTotal: number; arrivals24h: number; avgDwellSeconds: number | null;
}
export interface RejectionReason { gate: string; reasonCode: string; description: string; occurrences: number }
export interface AnchorCount { chain: string; status: string; count: number }
export interface StalledItem {
  productId: string; rfidUid: string; stage: string; status: string; lastScanAt: string; idleSeconds: number; slaMinutes: number; overdueMinutes: number;
}
export interface Overview {
  totalProducts: number;
  byStatus: Record<string, number>;
  byStage: { stage: string; seq: number; department: string; count: number }[];
  pendingApprovals: { gate1_intake: number; gate2_qc: number; gate3_shipment: number };
  rework: { open: number; awaitingQcRecheck: number; totalReworkLoops: number };
  stalledItems: number;
}

export interface DashboardRepo {
  kpis(): Promise<KpiSummary>;
  stages(): Promise<StageKpi[]>;
  rejectionReasons(): Promise<RejectionReason[]>;
  anchors(): Promise<AnchorCount[]>;
  stalled(limit: number): Promise<StalledItem[]>;
  overview(): Promise<Overview>;
}

/** Reads the database views from 02_views.sql (v_kpi_summary, v_stage_kpi, ...). Read-only. */
export function createDashboardRepo(db: Db): DashboardRepo {
  return {
    async kpis() {
      return (
        await db.query<KpiSummary>(`
        SELECT items_in_progress::int AS "itemsInProgress", items_shipped::int AS "itemsShipped",
               rejection_rate_pct::float8 AS "rejectionRatePct",
               EXTRACT(EPOCH FROM avg_cycle_time)::float8 AS "avgCycleTimeSeconds",
               stalled_items::int AS "stalledItems", anchors_confirmed::int AS "anchorsConfirmed",
               anchors_pending::int AS "anchorsPending"
          FROM v_kpi_summary`)
      ).rows[0]!;
    },
    async stages() {
      return (
        await db.query<StageKpi>(`
        SELECT seq::int AS seq, stage::text AS stage, department, wip::int AS wip,
               arrivals_total::int AS "arrivalsTotal", arrivals_24h::int AS "arrivals24h",
               EXTRACT(EPOCH FROM avg_dwell)::float8 AS "avgDwellSeconds"
          FROM v_stage_kpi ORDER BY seq`)
      ).rows;
    },
    async rejectionReasons() {
      return (
        await db.query<RejectionReason>(`
        SELECT gate::text AS gate, reason_code AS "reasonCode", description, occurrences::int AS occurrences
          FROM v_rejection_reasons ORDER BY occurrences DESC, reason_code`)
      ).rows;
    },
    async anchors() {
      return (
        await db.query<AnchorCount>(`SELECT chain_code AS chain, status::text AS status, n::int AS count FROM v_anchor_summary ORDER BY chain_code, status`)
      ).rows;
    },
    async stalled(limit) {
      return (
        await db.query<StalledItem>(
          `SELECT product_id AS "productId", rfid_uid AS "rfidUid", current_stage::text AS stage, status::text AS status,
                  last_scan_at AS "lastScanAt", EXTRACT(EPOCH FROM idle_for)::float8 AS "idleSeconds", sla_minutes::int AS "slaMinutes",
                  GREATEST(0, ROUND(EXTRACT(EPOCH FROM idle_for) / 60 - sla_minutes))::int AS "overdueMinutes"
             FROM v_stalled_products ORDER BY idle_for DESC LIMIT $1`,
          [limit],
        )
      ).rows;
    },
    async overview() {
      const status = (
        await db.query<{ status: string; n: number }>(`SELECT status::text AS status, count(*)::int AS n FROM products GROUP BY status`)
      ).rows;
      const byStatus: Record<string, number> = { active: 0, rework: 0, rejected: 0, ready_for_shipment: 0, shipped: 0 };
      for (const r of status) byStatus[r.status] = r.n;
      const byStage = (
        await db.query<{ stage: string; seq: number; department: string; count: number }>(
          `SELECT s.code::text AS stage, s.seq::int AS seq, d.name AS department, count(p.id)::int AS count
             FROM stages s JOIN departments d ON d.id = s.department_id LEFT JOIN products p ON p.current_stage = s.code
            GROUP BY s.code, s.seq, d.name ORDER BY s.seq`,
        )
      ).rows;
      const gates = (
        await db.query<{ gate: string; n: number }>(
          `SELECT g AS gate, count(*)::int AS n FROM (SELECT ${AWAITING_GATE} AS g FROM products p) x WHERE g IS NOT NULL GROUP BY g`,
        )
      ).rows;
      const pendingApprovals = { gate1_intake: 0, gate2_qc: 0, gate3_shipment: 0 };
      for (const r of gates) pendingApprovals[r.gate as keyof typeof pendingApprovals] = r.n;
      const rw = (
        await db.query<{ recheck: number; loops: number }>(
          `SELECT count(*) FILTER (WHERE ${REWORK_COMPLETED})::int AS recheck, coalesce(sum(p.rework_count), 0)::int AS loops FROM products p`,
        )
      ).rows[0]!;
      const stalled = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM v_stalled_products`)).rows[0]!.n;
      return {
        totalProducts: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        byStage,
        pendingApprovals,
        rework: { open: byStatus.rework ?? 0, awaitingQcRecheck: rw.recheck, totalReworkLoops: rw.loops },
        stalledItems: stalled,
      };
    },
  };
}
