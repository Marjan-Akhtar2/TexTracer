import { createHash } from "node:crypto";
import type { Db } from "../../db/pool";

export interface ReaderLookup {
  id: number;
  code: string;
  stage: string;
  departmentId: number;
  department: string;
  isActive: boolean;
}
export interface ScanOutcome {
  result: string;
  productId: string | null;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
}
export interface ScanLogRow {
  id: number;
  rfidUid: string;
  readerCode: string;
  productId: string | null;
  result: string;
  detail: string | null;
  deviceTs: string | null;
  scannedAt: string;
  stage: string | null;
}
export interface UnregisteredTag {
  rfidUid: string;
  lastSeenAt: string;
  readerCode: string;
  timesSeen: number;
}
export interface ScanFilter {
  result?: string;
  uid?: string;
  productId?: string;
  readerCode?: string;
  departmentId?: number;
}

export interface ScansRepo {
  findReader(code: string): Promise<ReaderLookup | null>;
  /** Reader by code whose stored key hash matches the presented device key. */
  authenticateDevice(readerCode: string, deviceKey: string): Promise<ReaderLookup | null>;
  /** Calls the database function record_scan(): validation + logging + state change in ONE transaction. */
  record(uid: string, readerCode: string, actorId: string | null, deviceTs: string | null): Promise<ScanOutcome>;
  list(filter: ScanFilter, limit: number, offset: number): Promise<{ rows: ScanLogRow[]; total: number }>;
  /** Tags a reader saw recently that no product owns yet (so the Warehouse Manager can register them without typing the UID). */
  unregistered(sinceMinutes: number, limit: number): Promise<UnregisteredTag[]>;
}

const READER_SQL = `SELECT r.id::int AS id, r.reader_code AS code, r.stage::text AS stage, d.id::int AS "departmentId",
       d.name AS department, r.is_active AS "isActive"
  FROM readers r JOIN stages s ON s.code = r.stage JOIN departments d ON d.id = s.department_id`;

export function createScansRepo(db: Db): ScansRepo {
  return {
    async findReader(code) {
      return (await db.query<ReaderLookup>(`${READER_SQL} WHERE r.reader_code = $1`, [code])).rows[0] ?? null;
    },
    async authenticateDevice(readerCode, deviceKey) {
      const hash = createHash("sha256").update(deviceKey).digest("hex");
      return (
        (await db.query<ReaderLookup>(`${READER_SQL} WHERE r.reader_code = $1 AND r.api_key_hash = $2 AND r.is_active`, [readerCode, hash])).rows[0] ?? null
      );
    },
    async record(uid, readerCode, actorId, deviceTs) {
      const r = await db.query<ScanOutcome>(
        `SELECT out_result::text AS result, out_product_id AS "productId", out_from_stage::text AS "fromStage",
                out_to_stage::text AS "toStage", out_detail AS detail
           FROM record_scan($1, $2, $3::uuid, $4::timestamptz)`,
        [uid, readerCode, actorId, deviceTs],
      );
      return r.rows[0]!;
    },
    async unregistered(sinceMinutes, limit) {
      return (
        await db.query<UnregisteredTag>(
          `SELECT s.rfid_uid AS "rfidUid", max(s.scanned_at) AS "lastSeenAt",
                  (array_agg(s.reader_code ORDER BY s.scanned_at DESC))[1] AS "readerCode", count(*)::int AS "timesSeen"
             FROM scan_logs s
            WHERE s.result = 'rejected_unknown_tag' AND s.scanned_at > now() - make_interval(mins => $1::int)
              AND NOT EXISTS (SELECT 1 FROM products p WHERE p.rfid_uid = s.rfid_uid)
            GROUP BY s.rfid_uid ORDER BY max(s.scanned_at) DESC LIMIT $2`,
          [sinceMinutes, limit],
        )
      ).rows;
    },
    async list(f, limit, offset) {
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (clause: string, v: unknown) => { params.push(v); where.push(clause.replace("$#", `$${params.length}`)); };
      if (f.result) add("s.result = $#", f.result);
      if (f.uid) add("s.rfid_uid = $#", f.uid);
      if (f.productId) add("s.product_id = $#", f.productId);
      if (f.readerCode) add("s.reader_code = $#", f.readerCode);
      if (f.departmentId !== undefined) add("st.department_id = $#", f.departmentId);
      const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const from = `FROM scan_logs s LEFT JOIN readers r ON r.id = s.reader_id LEFT JOIN stages st ON st.code = r.stage ${w}`;
      const rows = (
        await db.query<ScanLogRow>(
          `SELECT s.id::int AS id, s.rfid_uid AS "rfidUid", s.reader_code AS "readerCode", s.product_id AS "productId",
                  s.result::text AS result, s.detail, s.device_ts AS "deviceTs", s.scanned_at AS "scannedAt", r.stage::text AS stage
             ${from} ORDER BY s.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        )
      ).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n ${from}`, params)).rows[0]!.n;
      return { rows, total };
    },
  };
}
