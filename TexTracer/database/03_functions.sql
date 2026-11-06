-- =====================================================================
-- 03_functions.sql : the rules of the system, enforced inside the DB
-- FastAPI calls these; every call is one atomic transaction.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- record_scan : FR-13..16  (UID -> product, reader -> stage, validate, record)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_scan(
  p_uid         text,
  p_reader_code text,
  p_actor       uuid        DEFAULT NULL,
  p_device_ts   timestamptz DEFAULT NULL)
RETURNS TABLE (out_result scan_result, out_product_id uuid,
               out_from_stage stage_code, out_to_stage stage_code, out_detail text)
LANGUAGE plpgsql AS $$
DECLARE
  v_uid    text := upper(trim(p_uid));
  v_reader readers%ROWTYPE;
  v_prod   products%ROWTYPE;
  v_trans  allowed_transitions%ROWTYPE;
  v_res    scan_result;
  v_detail text;
BEGIN
  SELECT * INTO v_reader FROM readers WHERE reader_code = p_reader_code AND is_active;
  IF NOT FOUND THEN
    v_res := 'rejected_unknown_reader'; v_detail := 'Reader not registered or inactive';
  ELSE
    SELECT * INTO v_prod FROM products WHERE rfid_uid = v_uid FOR UPDATE;
    IF NOT FOUND THEN
      v_res := 'rejected_unknown_tag'; v_detail := 'No product registered for this UID';
    ELSIF v_prod.status IN ('rejected','shipped') THEN
      v_res := 'rejected_product_blocked'; v_detail := format('Product is %s', v_prod.status);
    ELSIF v_prod.current_stage = v_reader.stage THEN
      v_res := 'duplicate'; v_detail := 'Product already at this stage';
    ELSE
      SELECT * INTO v_trans FROM allowed_transitions
       WHERE from_stage = v_prod.current_stage AND to_stage = v_reader.stage AND kind = 'forward';
      IF NOT FOUND THEN
        v_res := 'rejected_out_of_sequence';
        v_detail := format('Cannot move from %s to %s', v_prod.current_stage, v_reader.stage);
      ELSIF v_trans.requires_gate IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM v_current_inspections ci
               WHERE ci.product_id = v_prod.id AND ci.gate = v_trans.requires_gate
                 AND ci.decision IN ('approved','ready_for_shipment')) THEN
        v_res := 'rejected_gate_not_approved';
        v_detail := format('%s approval required before %s', v_trans.requires_gate, v_reader.stage);
      ELSE
        INSERT INTO stage_transitions(product_id, from_stage, to_stage, kind, reader_id, actor_user_id)
        VALUES (v_prod.id, v_prod.current_stage, v_reader.stage, 'forward', v_reader.id, p_actor);
        UPDATE products
           SET current_stage = v_reader.stage,
               last_scan_at  = now(),
               status = CASE WHEN v_reader.stage = 'shipping' THEN 'shipped'::product_status ELSE status END
         WHERE id = v_prod.id;
        v_res := 'accepted'; v_detail := 'OK';
      END IF;
    END IF;
  END IF;

  INSERT INTO scan_logs(rfid_uid, reader_code, product_id, reader_id, result, detail, device_ts)
  VALUES (v_uid, p_reader_code, v_prod.id, v_reader.id, v_res, v_detail, p_device_ts);

  RETURN QUERY SELECT v_res, v_prod.id, v_prod.current_stage, v_reader.stage, v_detail;
END $$;

-- ---------------------------------------------------------------------
-- record_decision : FR-2/3/4/7/18 (gate decisions, rework loop, anchor queue)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_decision(
  p_product     uuid,
  p_gate        gate_code,
  p_decision    decision_code,
  p_actor       uuid,
  p_reason_code text DEFAULT NULL,
  p_notes       text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_needed   role_code;
  v_stage    stage_code;
  v_prod     products%ROWTYPE;
  v_prev     inspections%ROWTYPE;
  v_reason   integer;
  v_insp     bigint;
  v_at       timestamptz;
  v_meta     jsonb;
BEGIN
  v_needed := (CASE p_gate WHEN 'gate1_intake' THEN 'warehouse_manager'
                           WHEN 'gate2_qc'     THEN 'qc_officer'
                           ELSE 'department_officer' END)::role_code;
  v_stage  := (CASE p_gate WHEN 'gate1_intake' THEN 'intake'
                           WHEN 'gate2_qc'     THEN 'production'
                           ELSE 'packaging' END)::stage_code;

  -- Role check (NFR-1)
  IF NOT EXISTS (SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
                  WHERE u.id = p_actor AND u.is_active AND ur.role = v_needed) THEN
    RAISE EXCEPTION 'User lacks required role % for %', v_needed, p_gate
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (p_gate = 'gate3_shipment') <> (p_decision = 'ready_for_shipment') THEN
    RAISE EXCEPTION 'Decision % is not valid for %', p_decision, p_gate USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_prod FROM products WHERE id = p_product FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product % not found', p_product; END IF;
  IF v_prod.status IN ('rejected','shipped') THEN
    RAISE EXCEPTION 'Product is % and cannot be decided on', v_prod.status;
  END IF;
  IF v_prod.current_stage <> v_stage THEN
    RAISE EXCEPTION '% requires the product to be at %, but it is at %', p_gate, v_stage, v_prod.current_stage;
  END IF;

  IF p_decision = 'rejected' THEN
    SELECT id INTO v_reason FROM reason_codes
     WHERE code = p_reason_code AND gate = p_gate AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A valid reason code for % is required on rejection', p_gate USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- FR-18: only a previous REJECTION may be superseded; never edit old rows.
  SELECT * INTO v_prev FROM v_current_inspections WHERE product_id = p_product AND gate = p_gate;
  IF FOUND AND v_prev.decision <> 'rejected' THEN
    RAISE EXCEPTION 'Gate % already decided (%) for this product', p_gate, v_prev.decision;
  END IF;

  INSERT INTO inspections(product_id, gate, decision, reason_code_id, notes, decided_by, supersedes_id)
  VALUES (p_product, p_gate, p_decision, v_reason, p_notes, p_actor, v_prev.id)
  RETURNING id, decided_at INTO v_insp, v_at;

  -- Effects on the product
  IF p_gate = 'gate1_intake' AND p_decision = 'rejected' THEN
    UPDATE products SET status = 'rejected' WHERE id = p_product;
    INSERT INTO notifications(target_role, department_id, product_id, type, message)
    SELECT 'department_officer', d.id, p_product, 'gate1_rejected',
           format('Raw material %s rejected (%s) - return/replacement needed', v_prod.rfid_uid, p_reason_code)
      FROM departments d WHERE d.code = 'procurement';

  ELSIF p_gate = 'gate2_qc' AND p_decision = 'rejected' THEN
    UPDATE products SET status = 'rework', rework_flag = true,
           rework_count = rework_count + 1, last_scan_at = now()
     WHERE id = p_product;
    INSERT INTO stage_transitions(product_id, from_stage, to_stage, kind, actor_user_id, inspection_id)
    VALUES (p_product, 'production', 'production', 'rework', p_actor, v_insp);
    INSERT INTO notifications(target_role, department_id, product_id, type, message)
    SELECT 'department_officer', d.id, p_product, 'gate2_rework',
           format('Item %s failed QC (%s) - rework required', v_prod.rfid_uid, p_reason_code)
      FROM departments d WHERE d.code = 'production';

  ELSIF p_gate = 'gate2_qc' THEN            -- approved (first time or after rework)
    UPDATE products SET status = 'active', rework_flag = false WHERE id = p_product;

  ELSIF p_gate = 'gate3_shipment' THEN
    UPDATE products SET status = 'ready_for_shipment' WHERE id = p_product;
    INSERT INTO notifications(target_role, department_id, product_id, type, message)
    SELECT 'department_officer', d.id, p_product, 'ready_for_shipment',
           format('Item %s is ready for shipment', v_prod.rfid_uid)
      FROM departments d WHERE d.code = 'shipping';
  END IF;

  -- Queue blockchain anchors (outbox): same transaction, one row per active chain (FR-5, FR-7)
  v_meta := jsonb_build_object(
    'schema', 'texchain.event.v1',
    'product_id', v_prod.id, 'product_uid', v_prod.rfid_uid,
    'gate', p_gate, 'decision', p_decision,
    'reason_code', p_reason_code, 'notes', p_notes,
    'decided_by', p_actor, 'decided_at', v_at,
    'supersedes_inspection_id', v_prev.id,
    'inspection_id', v_insp);
  INSERT INTO chain_anchors(inspection_id, chain_code, metadata, metadata_hash)
  SELECT v_insp, c.code, v_meta, digest(v_meta::text, 'sha256')
    FROM chains c WHERE c.is_active;

  PERFORM pg_notify('texchain_events', json_build_object(
    'type','decision','product_id',p_product,'gate',p_gate,
    'decision',p_decision,'inspection_id',v_insp)::text);

  RETURN v_insp;
END $$;

-- ---------------------------------------------------------------------
-- Outbox helpers for the blockchain worker (Python)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_anchor_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF chain_anchors LANGUAGE sql AS $$
  WITH c AS (
    SELECT id FROM chain_anchors
     WHERE status = 'pending' AND next_attempt_at <= now()
     ORDER BY id LIMIT p_limit
     FOR UPDATE SKIP LOCKED)
  UPDATE chain_anchors a
     SET status = 'submitted', attempts = a.attempts + 1, submitted_at = now()
    FROM c WHERE a.id = c.id
  RETURNING a.*;
$$;

CREATE OR REPLACE FUNCTION fail_anchor_job(p_id bigint, p_error text, p_max_attempts integer DEFAULT 8)
RETURNS void LANGUAGE sql AS $$
  UPDATE chain_anchors
     SET last_error = p_error,
         status = CASE WHEN attempts >= p_max_attempts THEN 'failed'::anchor_status ELSE 'pending'::anchor_status END,
         next_attempt_at = now() + make_interval(secs => LEAST(3600, 30 * power(2, attempts)::int))
   WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION confirm_anchor_job(p_id bigint, p_cid text, p_tx text, p_block bigint, p_conf integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE chain_anchors
     SET ipfs_cid = p_cid, tx_hash = p_tx, block_number = p_block, confirmations = p_conf,
         status = 'confirmed', confirmed_at = now(), last_error = NULL
   WHERE id = p_id;
$$;

COMMIT;
