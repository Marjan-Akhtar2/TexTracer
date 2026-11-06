import type { Db } from "../../db/pool";

export interface DecisionAuditFilter { gate?: string; decision?: string; productId?: string; uid?: string; reasonCode?: string; from?: string; to?: string }
export interface TransitionFilter { productId?: string; kind?: string; from?: string; to?: string }

export interface AuditRepo {
  decisions(f: DecisionAuditFilter, limit: number, offset: number): Promise<{ rows: Record<string, unknown>[]; total: number }>;
  transitions(f: TransitionFilter, limit: number, offset: number): Promise<{ rows: Record<string, unknown>[]; total: number }>;
}

function where(entries: [string, unknown][]): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [clause, value] of entries) {
    if (value === undefined) continue;
    params.push(value);
    parts.push(clause.replace("$#", `$${params.length}`));
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

export function createAuditRepo(db: Db): AuditRepo {
  return {
    /** Reads the database view v_audit_history: one row per decision per blockchain (the view's own shape). */
    async decisions(f, limit, offset) {
      const w = where([
        ["gate = $#::gate_code", f.gate], ["decision = $#::decision_code", f.decision], ["product_id = $#::uuid", f.productId],
        ["rfid_uid = $#", f.uid], ["reason_code = $#", f.reasonCode], ["decided_at >= $#::timestamptz", f.from], ["decided_at <= $#::timestamptz", f.to],
      ]);
      const rows = (
        await db.query(
          `SELECT inspection_id::int AS "inspectionId", rfid_uid AS "rfidUid", product_id AS "productId", gate::text AS gate,
                  decision::text AS decision, reason_code AS "reasonCode", notes, decided_by AS "decidedBy", decided_at AS "decidedAt",
                  supersedes_id::int AS "supersedesId", chain_code AS chain, anchor_status::text AS "anchorStatus",
                  ipfs_cid AS "ipfsCid", tx_hash AS "txHash", confirmations::int AS confirmations
             FROM v_audit_history ${w.sql} ORDER BY decided_at DESC, inspection_id DESC LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`,
          [...w.params, limit, offset],
        )
      ).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM v_audit_history ${w.sql}`, w.params)).rows[0]!.n;
      return { rows, total };
    },

    async transitions(f, limit, offset) {
      const w = where([
        ["t.product_id = $#::uuid", f.productId], ["t.kind = $#::transition_kind", f.kind],
        ["t.occurred_at >= $#::timestamptz", f.from], ["t.occurred_at <= $#::timestamptz", f.to],
      ]);
      const from = `FROM stage_transitions t JOIN products p ON p.id = t.product_id
                    LEFT JOIN readers r ON r.id = t.reader_id LEFT JOIN users u ON u.id = t.actor_user_id ${w.sql}`;
      const rows = (
        await db.query(
          `SELECT t.id::int AS id, t.product_id AS "productId", p.rfid_uid AS "rfidUid", t.kind::text AS kind,
                  t.from_stage::text AS "fromStage", t.to_stage::text AS "toStage", r.reader_code AS "readerCode",
                  u.full_name AS "actorName", t.inspection_id::int AS "inspectionId", t.occurred_at AS "occurredAt",
                  encode(t.row_hash, 'hex') AS "rowHash", encode(t.prev_hash, 'hex') AS "prevHash"
             ${from} ORDER BY t.id DESC LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`,
          [...w.params, limit, offset],
        )
      ).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n ${from}`, w.params)).rows[0]!.n;
      return { rows, total };
    },
  };
}
