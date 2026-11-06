import type { Db } from "../../db/pool";
import { PRODUCT_COLUMNS, PRODUCT_FROM } from "../products/products.sql";
import type { ProductRow } from "../products/products.repo";

export interface ReworkCase extends ProductRow {
  inspectionId: number | null;
  reasonCode: string | null;
  rejectionNotes: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  assignedDepartment: string;
}

export interface ReworkRepo {
  list(limit: number, offset: number): Promise<{ rows: ReworkCase[]; total: number }>;
  history(productId: string): Promise<{ qcDecisions: Record<string, unknown>[]; reworkTransitions: Record<string, unknown>[]; completions: Record<string, unknown>[] }>;
  /** Writes the 'rework_completed' marker (a notification to QC). Returns its id. */
  markCompleted(productId: string, actorId: string, actorName: string, rfidUid: string, notes: string | null): Promise<number | null>;
}

const FROM = `${PRODUCT_FROM}
  LEFT JOIN LATERAL (
    SELECT i.id::int AS id, c.code AS code, i.notes AS notes, u.full_name AS by, i.decided_at AS at
      FROM inspections i JOIN users u ON u.id = i.decided_by LEFT JOIN reason_codes c ON c.id = i.reason_code_id
     WHERE i.product_id = p.id AND i.gate = 'gate2_qc' AND i.decision = 'rejected'
     ORDER BY i.id DESC LIMIT 1) lr ON true
  LEFT JOIN LATERAL (
    SELECT n.created_at AS at, u2.full_name AS by FROM notifications n LEFT JOIN users u2 ON u2.id = n.user_id
     WHERE n.product_id = p.id AND n.type = 'rework_completed' AND n.created_at > coalesce(lr.at, '-infinity'::timestamptz)
     ORDER BY n.id DESC LIMIT 1) rc ON true
  WHERE p.status = 'rework'`;

export function createReworkRepo(db: Db): ReworkRepo {
  return {
    async list(limit, offset) {
      const rows = (
        await db.query<ReworkCase>(
          `SELECT ${PRODUCT_COLUMNS}, lr.id AS "inspectionId", lr.code AS "reasonCode", lr.notes AS "rejectionNotes",
                  lr.by AS "rejectedBy", lr.at AS "rejectedAt", rc.at AS "completedAt", rc.by AS "completedBy",
                  'Production'::text AS "assignedDepartment"
             ${FROM} ORDER BY lr.at DESC NULLS LAST, p.id LIMIT $1 OFFSET $2`,
          [limit, offset],
        )
      ).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE status = 'rework'`)).rows[0]!.n;
      return { rows, total };
    },

    async history(productId) {
      const qcDecisions = (
        await db.query(
          `SELECT i.id::int AS "inspectionId", i.decision::text AS decision, c.code AS "reasonCode", i.notes,
                  u.full_name AS "decidedBy", i.decided_at AS "decidedAt", i.supersedes_id::int AS "supersedesId"
             FROM inspections i JOIN users u ON u.id = i.decided_by LEFT JOIN reason_codes c ON c.id = i.reason_code_id
            WHERE i.product_id = $1 AND i.gate = 'gate2_qc' ORDER BY i.id`,
          [productId],
        )
      ).rows;
      const reworkTransitions = (
        await db.query(
          `SELECT t.id::int AS id, t.occurred_at AS "occurredAt", t.from_stage::text AS "fromStage", t.to_stage::text AS "toStage",
                  t.inspection_id::int AS "inspectionId", u.full_name AS "actorName"
             FROM stage_transitions t LEFT JOIN users u ON u.id = t.actor_user_id
            WHERE t.product_id = $1 AND t.kind = 'rework' ORDER BY t.id`,
          [productId],
        )
      ).rows;
      const completions = (
        await db.query(
          `SELECT n.id::int AS id, n.created_at AS "completedAt", u.full_name AS "completedBy", n.message
             FROM notifications n LEFT JOIN users u ON u.id = n.user_id
            WHERE n.product_id = $1 AND n.type = 'rework_completed' ORDER BY n.id`,
          [productId],
        )
      ).rows;
      return { qcDecisions, reworkTransitions, completions };
    },

    async markCompleted(productId, actorId, actorName, rfidUid, notes) {
      const message = `Rework completed for item ${rfidUid} by ${actorName}${notes ? ` - ${notes}` : ""}. Ready for QC re-inspection.`;
      const r = await db.query<{ id: number }>(
        `INSERT INTO notifications (user_id, target_role, department_id, product_id, type, message)
         SELECT $1::uuid, 'qc_officer'::role_code, d.id, $2::uuid, 'rework_completed', $3
           FROM departments d WHERE d.code = 'stitching_qc'
         RETURNING id::int AS id`,
        [actorId, productId, message],
      );
      return r.rows[0]?.id ?? null;
    },
  };
}
