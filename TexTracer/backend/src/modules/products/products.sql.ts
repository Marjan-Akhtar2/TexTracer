/**
 * Shared SQL fragments for products. Other modules (approvals, rework) reuse them so that
 * "what is awaiting a gate" is defined in exactly one place.
 */

/** Which gate (if any) is waiting for a decision on this product. */
export const AWAITING_GATE = `
  CASE
    WHEN p.status NOT IN ('active','rework') THEN NULL
    WHEN p.current_stage = 'intake' AND NOT EXISTS (
      SELECT 1 FROM v_current_inspections ci
       WHERE ci.product_id = p.id AND ci.gate = 'gate1_intake' AND ci.decision = 'approved') THEN 'gate1_intake'
    WHEN p.current_stage = 'production' AND NOT EXISTS (
      SELECT 1 FROM v_current_inspections ci
       WHERE ci.product_id = p.id AND ci.gate = 'gate2_qc' AND ci.decision = 'approved') THEN 'gate2_qc'
    WHEN p.current_stage = 'packaging' AND NOT EXISTS (
      SELECT 1 FROM v_current_inspections ci
       WHERE ci.product_id = p.id AND ci.gate = 'gate3_shipment' AND ci.decision = 'ready_for_shipment') THEN 'gate3_shipment'
    ELSE NULL
  END`;

/**
 * Rework counts as completed when a 'rework_completed' notification exists that is newer than the
 * latest Gate 2 rejection (the database has no dedicated column for this - see docs/DATABASE_NOTES.md).
 */
export const REWORK_COMPLETED = `
  (p.status = 'rework' AND EXISTS (
     SELECT 1 FROM notifications n
      WHERE n.product_id = p.id AND n.type = 'rework_completed'
        AND n.created_at > coalesce((SELECT max(i.decided_at) FROM inspections i
                                      WHERE i.product_id = p.id AND i.gate = 'gate2_qc' AND i.decision = 'rejected'),
                                    '-infinity'::timestamptz)))`;

export const PRODUCT_COLUMNS = `
  p.id, p.rfid_uid AS "rfidUid", p.batch_code AS "batchCode", p.description,
  p.current_stage::text AS stage, p.status::text AS status,
  p.rework_flag AS "reworkFlag", p.rework_count::int AS "reworkCount",
  p.last_scan_at AS "lastScanAt", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  st.seq::int AS "stageSeq", st.sla_minutes::int AS "slaMinutes",
  d.id::int AS "departmentId", d.name AS department,
  po.id::int AS "poId", po.po_number AS "poNumber", po.supplier_name AS supplier,
  po.material_description AS material, po.quantity::float8 AS "poQuantity",
  (sp.product_id IS NOT NULL) AS stalled,
  ${AWAITING_GATE} AS "awaitingGate",
  ${REWORK_COMPLETED} AS "reworkCompleted"`;

export const PRODUCT_FROM = `
  FROM products p
  JOIN stages st ON st.code = p.current_stage
  JOIN departments d ON d.id = st.department_id
  LEFT JOIN purchase_orders po ON po.id = p.po_id
  LEFT JOIN v_stalled_products sp ON sp.product_id = p.id`;
