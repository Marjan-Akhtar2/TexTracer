import type { Db } from "../../db/pool";
import { PRODUCT_COLUMNS, PRODUCT_FROM } from "./products.sql";

export interface ProductRow {
  id: string;
  rfidUid: string;
  batchCode: string | null;
  description: string | null;
  stage: string;
  status: string;
  reworkFlag: boolean;
  reworkCount: number;
  lastScanAt: string;
  createdAt: string;
  updatedAt: string;
  stageSeq: number;
  slaMinutes: number;
  departmentId: number;
  department: string;
  poId: number | null;
  poNumber: string | null;
  supplier: string | null;
  material: string | null;
  poQuantity: number | null;
  stalled: boolean;
  awaitingGate: string | null;
  reworkCompleted: boolean;
}

export interface ProductFilter {
  status?: string;
  stage?: string;
  search?: string;
  poId?: number;
  stalled?: boolean;
  awaitingGate?: string; // a gate code, or "any" for every item waiting at some gate
  departmentId?: number; // restrict to products currently in this department (Department Officer queue)
}

export interface TimelineEvent {
  type: "transition" | "decision" | "scan";
  at: string;
  [k: string]: unknown;
}

export interface ProductsRepo {
  list(filter: ProductFilter, limit: number, offset: number): Promise<{ rows: ProductRow[]; total: number }>;
  findById(id: string): Promise<ProductRow | null>;
  findByUid(uid: string): Promise<ProductRow | null>;
  /** True when the product is, or ever was, in one of the department's stages. */
  visitedDepartment(productId: string, departmentId: number): Promise<boolean>;
  receipt(productId: string): Promise<Record<string, unknown> | null>;
  currentDecisions(productId: string): Promise<Record<string, unknown>[]>;
  nextStages(stage: string): Promise<{ stage: string; requiresGate: string | null }[]>;
  history(productId: string): Promise<{ transitions: TimelineEvent[]; decisions: TimelineEvent[]; scans: TimelineEvent[] }>;
  verification(productId: string): Promise<{ chainValid: boolean; transitionCount: number; anchors: Record<string, unknown>[] }>;
  register(input: {
    rfidUid: string; poId: number; batchCode: string | null; description: string | null; receivedQty: number; notes: string | null; receivedBy: string;
  }): Promise<string>;
}

export function buildWhere(f: ProductFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("$#", `$${params.length}`));
  };
  if (f.status) add("p.status = $#", f.status);
  if (f.stage) add("p.current_stage = $#", f.stage);
  if (f.poId !== undefined) add("p.po_id = $#", f.poId);
  if (f.departmentId !== undefined) add("st.department_id = $#", f.departmentId);
  if (f.stalled === true) where.push("sp.product_id IS NOT NULL");
  if (f.stalled === false) where.push("sp.product_id IS NULL");
  if (f.search) {
    const term = `%${f.search.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    params.push(term);
    const n = params.length;
    where.push(`(p.rfid_uid ILIKE $${n} OR p.batch_code ILIKE $${n} OR po.po_number ILIKE $${n} OR p.description ILIKE $${n})`);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export function createProductsRepo(db: Db): ProductsRepo {
  const one = async (where: string, param: unknown) =>
    (await db.query<ProductRow>(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE ${where}`, [param])).rows[0] ?? null;

  return {
    async list(filter, limit, offset) {
      const { sql, params } = buildWhere(filter);
      // awaitingGate is a computed column, so it is applied by wrapping the query
      const specificGate = filter.awaitingGate && filter.awaitingGate !== "any" ? filter.awaitingGate : null;
      const gateClause = specificGate ? `WHERE x."awaitingGate" = $${params.length + 1}` : filter.awaitingGate === "any" ? `WHERE x."awaitingGate" IS NOT NULL` : "";
      const gateParams = specificGate ? [...params, specificGate] : params;
      const inner = `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} ${sql}`;
      const rows = (
        await db.query<ProductRow>(
          `SELECT x.* FROM (${inner}) x ${gateClause} ORDER BY x."createdAt" DESC, x.id LIMIT $${gateParams.length + 1} OFFSET $${gateParams.length + 2}`,
          [...gateParams, limit, offset],
        )
      ).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${inner}) x ${gateClause}`, gateParams)).rows[0]!.n;
      return { rows, total };
    },

    findById: (id) => one("p.id = $1", id),
    findByUid: (uid) => one("p.rfid_uid = $1", uid),

    async visitedDepartment(productId, departmentId) {
      const r = await db.query(
        `SELECT 1 FROM stage_transitions t JOIN stages s ON s.code = t.to_stage
          WHERE t.product_id = $1 AND s.department_id = $2 LIMIT 1`,
        [productId, departmentId],
      );
      return r.rowCount > 0;
    },

    async receipt(productId) {
      const r = await db.query(
        `SELECT m.id::int AS id, m.received_qty::float8 AS "receivedQty", m.notes, m.received_at AS "receivedAt",
                u.full_name AS "receivedBy"
           FROM material_receipts m LEFT JOIN users u ON u.id = m.received_by WHERE m.product_id = $1`,
        [productId],
      );
      return r.rows[0] ?? null;
    },

    async currentDecisions(productId) {
      return (
        await db.query(
          `SELECT ci.id::int AS "inspectionId", ci.gate::text AS gate, ci.decision::text AS decision,
                  rc.code AS "reasonCode", ci.notes, u.full_name AS "decidedBy", ci.decided_at AS "decidedAt",
                  ci.supersedes_id::int AS "supersedesId"
             FROM v_current_inspections ci
             JOIN users u ON u.id = ci.decided_by
             LEFT JOIN reason_codes rc ON rc.id = ci.reason_code_id
            WHERE ci.product_id = $1 ORDER BY ci.id`,
          [productId],
        )
      ).rows;
    },

    async nextStages(stage) {
      return (
        await db.query<{ stage: string; requiresGate: string | null }>(
          `SELECT to_stage::text AS stage, requires_gate::text AS "requiresGate"
             FROM allowed_transitions WHERE from_stage = $1 AND kind = 'forward' ORDER BY to_stage`,
          [stage],
        )
      ).rows;
    },

    async history(productId) {
      const transitions = (
        await db.query<TimelineEvent>(
          `SELECT 'transition' AS type, t.occurred_at AS at, t.id::int AS id, t.kind::text AS kind,
                  t.from_stage::text AS "fromStage", t.to_stage::text AS "toStage",
                  r.reader_code AS "readerCode", u.full_name AS "actorName", t.inspection_id::int AS "inspectionId"
             FROM stage_transitions t
             LEFT JOIN readers r ON r.id = t.reader_id
             LEFT JOIN users u ON u.id = t.actor_user_id
            WHERE t.product_id = $1 ORDER BY t.id`,
          [productId],
        )
      ).rows;
      const decisions = (
        await db.query<TimelineEvent>(
          `SELECT 'decision' AS type, i.decided_at AS at, i.id::int AS id, i.gate::text AS gate, i.decision::text AS decision,
                  rc.code AS "reasonCode", i.notes, u.full_name AS "decidedBy", i.supersedes_id::int AS "supersedesId",
                  (SELECT coalesce(json_agg(json_build_object('chain', a.chain_code, 'status', a.status,
                            'ipfsCid', a.ipfs_cid, 'txHash', a.tx_hash, 'confirmations', a.confirmations) ORDER BY a.id), '[]'::json)
                     FROM chain_anchors a WHERE a.inspection_id = i.id) AS anchors
             FROM inspections i
             JOIN users u ON u.id = i.decided_by
             LEFT JOIN reason_codes rc ON rc.id = i.reason_code_id
            WHERE i.product_id = $1 ORDER BY i.id`,
          [productId],
        )
      ).rows;
      const scans = (
        await db.query<TimelineEvent>(
          `SELECT 'scan' AS type, s.scanned_at AS at, s.id::int AS id, s.reader_code AS "readerCode",
                  s.result::text AS result, s.detail
             FROM scan_logs s WHERE s.product_id = $1 ORDER BY s.id`,
          [productId],
        )
      ).rows;
      return { transitions, decisions, scans };
    },

    async verification(productId) {
      const chain = (await db.query<{ ok: boolean }>(`SELECT verify_transition_chain($1) AS ok`, [productId])).rows[0]!;
      const count = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stage_transitions WHERE product_id = $1`, [productId])).rows[0]!;
      const anchors = (
        await db.query(
          `SELECT a.id::int AS id, a.inspection_id::int AS "inspectionId", i.gate::text AS gate, i.decision::text AS decision,
                  a.chain_code AS chain, a.status::text AS status, a.ipfs_cid AS "ipfsCid", a.tx_hash AS "txHash",
                  a.block_number::float8 AS "blockNumber", a.confirmations::int AS confirmations,
                  (digest(a.metadata::text, 'sha256') = a.metadata_hash) AS "metadataHashValid",
                  a.created_at AS "createdAt", a.confirmed_at AS "confirmedAt"
             FROM chain_anchors a JOIN inspections i ON i.id = a.inspection_id
            WHERE i.product_id = $1 ORDER BY a.id`,
          [productId],
        )
      ).rows;
      return { chainValid: chain.ok === true, transitionCount: count.n, anchors };
    },

    register: (i) =>
      db.transaction(async (tx) => {
        const p = await tx.query<{ id: string }>(
          `INSERT INTO products (rfid_uid, po_id, batch_code, description) VALUES ($1, $2, $3, $4) RETURNING id`,
          [i.rfidUid, i.poId, i.batchCode, i.description],
        );
        const id = p.rows[0]!.id;
        await tx.query(
          `INSERT INTO material_receipts (po_id, product_id, received_qty, notes, received_by) VALUES ($1, $2, $3, $4, $5)`,
          [i.poId, id, i.receivedQty, i.notes, i.receivedBy],
        );
        return id;
      }),
  };
}
