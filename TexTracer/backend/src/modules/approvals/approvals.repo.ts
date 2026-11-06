import type { Db } from "../../db/pool";

export interface ReasonCode { code: string; gate: string; description: string }
export interface DecisionRow {
  inspectionId: number;
  productId: string;
  gate: string;
  decision: string;
  reasonCode: string | null;
  notes: string | null;
  decidedBy: string;
  decidedAt: string;
  supersedesId: number | null;
  isCurrent: boolean;
  anchors: { chain: string; status: string; ipfsCid: string | null; txHash: string | null; confirmations: number }[];
}

export interface ApprovalsRepo {
  reasonCodes(gate?: string): Promise<ReasonCode[]>;
  decisions(productId: string): Promise<DecisionRow[]>;
  decision(inspectionId: number): Promise<DecisionRow | null>;
  /** Calls the database function record_decision() (role check, gate rules, rework loop, anchor queue). */
  record(input: { productId: string; gate: string; decision: string; actorId: string; reasonCode: string | null; notes: string | null }): Promise<number>;
}

const DECISION_SQL = `
  SELECT i.id::int AS "inspectionId", i.product_id AS "productId", i.gate::text AS gate, i.decision::text AS decision,
         rc.code AS "reasonCode", i.notes, u.full_name AS "decidedBy", i.decided_at AS "decidedAt",
         i.supersedes_id::int AS "supersedesId",
         NOT EXISTS (SELECT 1 FROM inspections s WHERE s.supersedes_id = i.id) AS "isCurrent",
         (SELECT coalesce(json_agg(json_build_object('chain', a.chain_code, 'status', a.status, 'ipfsCid', a.ipfs_cid,
                   'txHash', a.tx_hash, 'confirmations', a.confirmations) ORDER BY a.id), '[]'::json)
            FROM chain_anchors a WHERE a.inspection_id = i.id) AS anchors
    FROM inspections i
    JOIN users u ON u.id = i.decided_by
    LEFT JOIN reason_codes rc ON rc.id = i.reason_code_id`;

export function createApprovalsRepo(db: Db): ApprovalsRepo {
  return {
    async reasonCodes(gate) {
      return (
        await db.query<ReasonCode>(
          `SELECT code, gate::text AS gate, description FROM reason_codes WHERE is_active ${gate ? "AND gate = $1" : ""} ORDER BY gate, code`,
          gate ? [gate] : [],
        )
      ).rows;
    },
    async decisions(productId) {
      return (await db.query<DecisionRow>(`${DECISION_SQL} WHERE i.product_id = $1 ORDER BY i.id`, [productId])).rows;
    },
    async decision(id) {
      return (await db.query<DecisionRow>(`${DECISION_SQL} WHERE i.id = $1`, [id])).rows[0] ?? null;
    },
    async record(i) {
      const r = await db.query<{ id: number }>(
        `SELECT record_decision($1::uuid, $2::gate_code, $3::decision_code, $4::uuid, $5::text, $6::text)::int AS id`,
        [i.productId, i.gate, i.decision, i.actorId, i.reasonCode, i.notes],
      );
      return r.rows[0]!.id;
    },
  };
}
