-- =====================================================================
-- 06_multichain_chain.sql : OPTIONAL data-only step that switches the blockchain target to MultiChain.
--   * NO tables, columns, functions or views are created or changed.
--   * Safe to run more than once.
--   * Run it once in the Supabase SQL editor (or: psql "$DATABASE_URL" -f database/06_multichain_chain.sql)
--     BEFORE or AFTER starting the backend - the worker simply waits until the chain row exists.
-- Why: record_decision() queues one chain_anchors row per ACTIVE row in `chains`. The seed only knows
-- polygon_amoy / sepolia, which nothing publishes to. We register 'multichain' (the value of
-- MULTICHAIN_ANCHOR_CHAIN_CODE) and stop queuing for the unused testnets so they do not pile up as "pending".
-- =====================================================================
BEGIN;

INSERT INTO chains(code, name, is_active)
VALUES ('multichain', 'MultiChain (permissioned stream)', true)
ON CONFLICT (code) DO UPDATE SET is_active = true, name = EXCLUDED.name;

-- Stop queuing for chains that have no publisher
UPDATE chains SET is_active = false WHERE code IN ('polygon_amoy', 'sepolia');

-- Anchors queued earlier for those chains were never published (nothing publishes to them), so they hold no
-- evidence; remove them so they do not sit in the dashboard as "pending". (Rows with a tx_hash are never touched.)
DELETE FROM chain_anchors
 WHERE chain_code IN ('polygon_amoy', 'sepolia') AND status IN ('pending', 'submitted') AND tx_hash IS NULL;

-- Backfill: decisions that were recorded BEFORE this step get a MultiChain anchor too.
-- Same metadata shape as record_decision(), so the worker treats them like any other job.
INSERT INTO chain_anchors(inspection_id, chain_code, metadata, metadata_hash)
SELECT i.id, 'multichain', m.meta, digest(m.meta::text, 'sha256')
  FROM inspections i
  JOIN products p ON p.id = i.product_id
  LEFT JOIN reason_codes rc ON rc.id = i.reason_code_id
  CROSS JOIN LATERAL (SELECT jsonb_build_object(
          'schema', 'texchain.event.v1',
          'product_id', p.id, 'product_uid', p.rfid_uid,
          'gate', i.gate, 'decision', i.decision,
          'reason_code', rc.code, 'notes', i.notes,
          'decided_by', i.decided_by, 'decided_at', i.decided_at,
          'supersedes_inspection_id', i.supersedes_id,
          'inspection_id', i.id) AS meta) m
 WHERE NOT EXISTS (SELECT 1 FROM chain_anchors a WHERE a.inspection_id = i.id AND a.chain_code = 'multichain')
 ORDER BY i.id;

COMMIT;
