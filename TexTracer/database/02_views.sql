-- =====================================================================
-- 02_views.sql : read-only views for Auditor (FR-6, FR-17) and Management (FR-8, FR-9)
-- =====================================================================
BEGIN;

-- Full history of one product: scans/transitions + gate decisions, in time order
CREATE VIEW v_product_timeline AS
SELECT t.product_id, t.occurred_at AS event_time, 'transition'::text AS event_type,
       (coalesce(t.from_stage::text, '-') || ' -> ' || t.to_stage::text) AS summary,
       t.kind::text AS detail, t.actor_user_id AS actor_id
  FROM stage_transitions t
UNION ALL
SELECT i.product_id, i.decided_at, 'decision'::text,
       (i.gate::text || ': ' || i.decision::text),
       (coalesce(rc.code, '') || coalesce(' ' || i.notes, '')), i.decided_by
  FROM inspections i LEFT JOIN reason_codes rc ON rc.id = i.reason_code_id;

-- Auditor: every approval/rejection with who, why, supersede link, and chain status
CREATE VIEW v_audit_history AS
SELECT i.id AS inspection_id, p.rfid_uid, i.product_id, i.gate, i.decision,
       rc.code AS reason_code, i.notes, u.full_name AS decided_by, i.decided_at,
       i.supersedes_id,
       a.chain_code, a.status AS anchor_status, a.ipfs_cid, a.tx_hash, a.confirmations
  FROM inspections i
  JOIN products p        ON p.id = i.product_id
  JOIN users u           ON u.id = i.decided_by
  LEFT JOIN reason_codes rc ON rc.id = i.reason_code_id
  LEFT JOIN chain_anchors a ON a.inspection_id = i.id;

-- Time spent per stage (arrival until next movement)
CREATE VIEW v_stage_dwell AS
WITH s AS (
  SELECT product_id, to_stage AS stage, occurred_at,
         lead(occurred_at) OVER (PARTITION BY product_id ORDER BY id) AS left_at
    FROM stage_transitions WHERE kind <> 'rework')
SELECT stage,
       count(*)                                             AS arrivals_total,
       count(*) FILTER (WHERE occurred_at > now() - interval '24 hours') AS arrivals_24h,
       avg(left_at - occurred_at) FILTER (WHERE left_at IS NOT NULL)      AS avg_dwell
  FROM s GROUP BY stage;

-- Management: per-department/stage throughput + WIP; highest wip/dwell = bottleneck
CREATE VIEW v_stage_kpi AS
SELECT st.seq, st.code AS stage, d.name AS department,
       (SELECT count(*) FROM products p
         WHERE p.current_stage = st.code
           AND p.status IN ('active','rework','ready_for_shipment')) AS wip,
       coalesce(w.arrivals_total, 0) AS arrivals_total,
       coalesce(w.arrivals_24h, 0)   AS arrivals_24h,
       w.avg_dwell
  FROM stages st
  JOIN departments d ON d.id = st.department_id
  LEFT JOIN v_stage_dwell w ON w.stage = st.code
 ORDER BY st.seq;

CREATE VIEW v_rejection_reasons AS
SELECT i.gate, rc.code AS reason_code, rc.description, count(*) AS occurrences
  FROM inspections i JOIN reason_codes rc ON rc.id = i.reason_code_id
 WHERE i.decision = 'rejected'
 GROUP BY i.gate, rc.code, rc.description
 ORDER BY occurrences DESC;

-- FR-9: items idle longer than their stage SLA
CREATE VIEW v_stalled_products AS
SELECT p.id AS product_id, p.rfid_uid, p.current_stage, p.status, p.last_scan_at,
       now() - p.last_scan_at AS idle_for, s.sla_minutes
  FROM products p JOIN stages s ON s.code = p.current_stage
 WHERE p.status IN ('active','rework','ready_for_shipment')
   AND p.last_scan_at < now() - make_interval(mins => s.sla_minutes);

CREATE VIEW v_anchor_summary AS
SELECT chain_code, status, count(*) AS n FROM chain_anchors GROUP BY chain_code, status;

-- Headline numbers for the Management dashboard
CREATE VIEW v_kpi_summary AS
SELECT
  (SELECT count(*) FROM products WHERE status IN ('active','rework','ready_for_shipment')) AS items_in_progress,
  (SELECT count(*) FROM products WHERE status = 'shipped')                               AS items_shipped,
  (SELECT round(100.0 * count(*) FILTER (WHERE decision = 'rejected')
          / nullif(count(*) FILTER (WHERE gate <> 'gate3_shipment'), 0), 2)
     FROM inspections)                                                                   AS rejection_rate_pct,
  (SELECT avg(t.occurred_at - p.created_at)
     FROM products p JOIN stage_transitions t
       ON t.product_id = p.id AND t.to_stage = 'shipping'
    WHERE p.status = 'shipped')                                                          AS avg_cycle_time,
  (SELECT count(*) FROM v_stalled_products)                                              AS stalled_items,
  (SELECT count(*) FROM chain_anchors WHERE status = 'confirmed')                        AS anchors_confirmed,
  (SELECT count(*) FROM chain_anchors WHERE status IN ('pending','submitted'))           AS anchors_pending;

COMMIT;
