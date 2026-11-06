import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../../db/pool";

export interface StageInfo {
  code: string;
  seq: number;
  slaMinutes: number;
  departmentId: number;
  department: string;
  readers: { id: number; code: string; isActive: boolean; description: string | null; hasDeviceKey: boolean }[];
  next: { stage: string; requiresGate: string | null }[];
}
export interface ReaderInfo {
  id: number;
  code: string;
  stage: string;
  departmentId: number;
  department: string;
  isActive: boolean;
  description: string | null;
  hasDeviceKey: boolean;
}

export interface StagesRepo {
  listStages(): Promise<StageInfo[]>;
  listReaders(): Promise<ReaderInfo[]>;
  /** Stores only the SHA-256 of a fresh random key; returns the key ONCE. null = reader not found. */
  provisionReaderKey(readerId: number): Promise<{ readerId: number; readerCode: string; deviceKey: string } | null>;
}

export function createStagesRepo(db: Db): StagesRepo {
  return {
    async listStages() {
      return (
        await db.query<StageInfo>(`
        SELECT s.code::text AS code, s.seq::int AS seq, s.sla_minutes::int AS "slaMinutes",
               d.id::int AS "departmentId", d.name AS department,
               coalesce((SELECT json_agg(json_build_object('id', r.id, 'code', r.reader_code, 'isActive', r.is_active,
                           'description', r.description, 'hasDeviceKey', r.api_key_hash IS NOT NULL) ORDER BY r.id)
                           FROM readers r WHERE r.stage = s.code), '[]'::json) AS readers,
               coalesce((SELECT json_agg(json_build_object('stage', t.to_stage, 'requiresGate', t.requires_gate) ORDER BY t.to_stage)
                           FROM allowed_transitions t WHERE t.from_stage = s.code AND t.kind = 'forward'), '[]'::json) AS "next"
          FROM stages s JOIN departments d ON d.id = s.department_id
         ORDER BY s.seq`)
      ).rows;
    },
    async listReaders() {
      return (
        await db.query<ReaderInfo>(`
        SELECT r.id::int AS id, r.reader_code AS code, r.stage::text AS stage, d.id::int AS "departmentId",
               d.name AS department, r.is_active AS "isActive", r.description,
               (r.api_key_hash IS NOT NULL) AS "hasDeviceKey"
          FROM readers r JOIN stages s ON s.code = r.stage JOIN departments d ON d.id = s.department_id
         ORDER BY r.id`)
      ).rows;
    },
    async provisionReaderKey(readerId) {
      const deviceKey = randomBytes(32).toString("hex");
      const hash = createHash("sha256").update(deviceKey).digest("hex");
      const r = await db.query<{ id: number; code: string }>(
        `UPDATE readers SET api_key_hash = $2 WHERE id = $1 RETURNING id::int AS id, reader_code AS code`,
        [readerId, hash],
      );
      const row = r.rows[0];
      return row ? { readerId: row.id, readerCode: row.code, deviceKey } : null;
    },
  };
}
