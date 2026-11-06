import type { Db } from "../../db/pool";

/**
 * All SQL for the blockchain layer. It works ONLY on the existing `chain_anchors` outbox table
 * (created by database/01_schemas.sql and filled by record_decision()); it adds no tables or columns.
 */
export interface ClaimedAnchor {
  id: number;
  inspectionId: number;
  productUid: string;
  metadataText: string;
  metadataHash: string; // hex
  hashOk: boolean; // digest(metadata::text) still equals the stored metadata_hash
  attempts: number;
}
export interface AwaitingAnchor { id: number; txHash: string; ageSeconds: number }
export interface ProductAnchor {
  id: number;
  inspectionId: number;
  gate: string;
  decision: string;
  chain: string;
  status: string;
  txHash: string | null;
  blockNumber: number | null;
  confirmations: number;
  productUid: string;
  metadataText: string;
  metadataHash: string; // hex
  dbHashValid: boolean;
  createdAt: string;
  confirmedAt: string | null;
}
export interface QueueCount { status: string; count: number }

export interface AnchorsRepo {
  /** Re-queues rows that were claimed but never got a tx (worker crashed mid-publish). */
  recoverStale(chainCode: string, minutes: number): Promise<number>;
  /** pending -> submitted (attempts+1) for one chain only; safe with several workers (SKIP LOCKED). */
  claim(chainCode: string, limit: number): Promise<ClaimedAnchor[]>;
  markSubmitted(id: number, txid: string): Promise<void>;
  awaitingConfirmation(chainCode: string, limit: number): Promise<AwaitingAnchor[]>;
  confirm(id: number, txid: string, block: number | null, confirmations: number): Promise<void>;
  fail(id: number, error: string, maxAttempts: number): Promise<void>;
  forProduct(productId: string, chainCode: string): Promise<ProductAnchor[]>;
  queue(chainCode: string): Promise<QueueCount[]>;
}

export function createAnchorsRepo(db: Db): AnchorsRepo {
  return {
    async recoverStale(chainCode, minutes) {
      const r = await db.query(
        `UPDATE chain_anchors SET status = 'pending'
          WHERE chain_code = $1 AND status = 'submitted' AND tx_hash IS NULL
            AND submitted_at < now() - make_interval(mins => $2::int)`,
        [chainCode, minutes],
      );
      return r.rowCount;
    },

    async claim(chainCode, limit) {
      // Same logic as the database function claim_anchor_jobs(), but restricted to OUR chain code,
      // so rows queued for other chains (e.g. polygon_amoy) are never touched by this worker.
      const r = await db.query<ClaimedAnchor>(
        `WITH c AS (
           SELECT id FROM chain_anchors
            WHERE chain_code = $1 AND status = 'pending' AND next_attempt_at <= now()
            ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED),
         u AS (
           UPDATE chain_anchors a
              SET status = 'submitted', attempts = a.attempts + 1, submitted_at = now()
             FROM c WHERE a.id = c.id RETURNING a.*)
         SELECT u.id::int AS id, u.inspection_id::int AS "inspectionId", p.rfid_uid AS "productUid",
                u.metadata::text AS "metadataText", encode(u.metadata_hash, 'hex') AS "metadataHash",
                (digest(u.metadata::text, 'sha256') = u.metadata_hash) AS "hashOk", u.attempts::int AS attempts
           FROM u JOIN inspections i ON i.id = u.inspection_id JOIN products p ON p.id = i.product_id
          ORDER BY u.id`,
        [chainCode, limit],
      );
      return r.rows;
    },

    async markSubmitted(id, txid) {
      await db.query(`UPDATE chain_anchors SET tx_hash = $2, last_error = NULL WHERE id = $1`, [id, txid]);
    },

    async awaitingConfirmation(chainCode, limit) {
      const r = await db.query<AwaitingAnchor>(
        `SELECT id::int AS id, tx_hash AS "txHash", extract(epoch FROM now() - submitted_at)::int AS "ageSeconds"
           FROM chain_anchors
          WHERE chain_code = $1 AND status = 'submitted' AND tx_hash IS NOT NULL
          ORDER BY id LIMIT $2`,
        [chainCode, limit],
      );
      return r.rows;
    },

    async confirm(id, txid, block, confirmations) {
      // Existing DB function; ipfs_cid stays NULL because MultiChain streams are not IPFS.
      await db.query(`SELECT confirm_anchor_job($1::bigint, NULL::text, $2::text, $3::bigint, $4::int)`, [id, txid, block, confirmations]);
    },

    async fail(id, error, maxAttempts) {
      await db.query(`SELECT fail_anchor_job($1::bigint, $2::text, $3::int)`, [id, error.slice(0, 500), maxAttempts]);
    },

    async forProduct(productId, chainCode) {
      const r = await db.query<ProductAnchor>(
        `SELECT a.id::int AS id, a.inspection_id::int AS "inspectionId", i.gate::text AS gate, i.decision::text AS decision,
                a.chain_code AS chain, a.status::text AS status, a.tx_hash AS "txHash",
                a.block_number::float8 AS "blockNumber", a.confirmations::int AS confirmations,
                p.rfid_uid AS "productUid", a.metadata::text AS "metadataText",
                encode(a.metadata_hash, 'hex') AS "metadataHash",
                (digest(a.metadata::text, 'sha256') = a.metadata_hash) AS "dbHashValid",
                a.created_at AS "createdAt", a.confirmed_at AS "confirmedAt"
           FROM chain_anchors a
           JOIN inspections i ON i.id = a.inspection_id
           JOIN products p ON p.id = i.product_id
          WHERE i.product_id = $1 AND a.chain_code = $2
          ORDER BY a.id`,
        [productId, chainCode],
      );
      return r.rows;
    },

    async queue(chainCode) {
      const r = await db.query<QueueCount>(
        `SELECT status::text AS status, count(*)::int AS count FROM chain_anchors WHERE chain_code = $1 GROUP BY status ORDER BY status`,
        [chainCode],
      );
      return r.rows;
    },
  };
}
