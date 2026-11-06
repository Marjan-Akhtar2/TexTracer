
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest(), crypt(), gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive emails

-- ---------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------
CREATE TYPE stage_code     AS ENUM ('intake','raw_material_1','raw_material_2','design',
                                    'manufacturing_1','manufacturing_2','production',
                                    'stitching','packaging','shipping');
CREATE TYPE role_code      AS ENUM ('system_admin','department_officer','warehouse_manager',
                                    'qc_officer','auditor','senior_management');
CREATE TYPE gate_code      AS ENUM ('gate1_intake','gate2_qc','gate3_shipment');
CREATE TYPE decision_code  AS ENUM ('approved','rejected','ready_for_shipment');
CREATE TYPE product_status AS ENUM ('active','rework','rejected','ready_for_shipment','shipped');
CREATE TYPE transition_kind AS ENUM ('initial','forward','rework');
CREATE TYPE scan_result    AS ENUM ('accepted','duplicate','rejected_unknown_tag',
                                    'rejected_unknown_reader','rejected_out_of_sequence',
                                    'rejected_gate_not_approved','rejected_product_blocked');
CREATE TYPE anchor_status  AS ENUM ('pending','submitted','confirmed','failed');

-- ---------------------------------------------------------------------
-- 2. GENERIC HELPERS
-- ---------------------------------------------------------------------
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only (NFR-2/NFR-3)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------------
-- 3. USERS, ROLES, DEPARTMENTS (FR-1)
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  code        role_code PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE departments (
  id   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  full_name     text   NOT NULL,
  password_hash text   NOT NULL,
  department_id smallint REFERENCES departments(id),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE user_roles (
  user_id    uuid      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       role_code NOT NULL REFERENCES roles(code),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- ---------------------------------------------------------------------
-- 4. STAGES, READERS, ALLOWED TRANSITIONS (FR-14, FR-15)
-- ---------------------------------------------------------------------
CREATE TABLE stages (
  code          stage_code PRIMARY KEY,
  department_id smallint NOT NULL REFERENCES departments(id),
  seq           smallint NOT NULL UNIQUE,
  sla_minutes   integer  NOT NULL CHECK (sla_minutes > 0)   -- stalled-item window (FR-9)
);

CREATE TABLE readers (
  id           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_code  text NOT NULL UNIQUE,                        -- what the ESP32 sends
  stage        stage_code NOT NULL REFERENCES stages(code),
  api_key_hash text,                                        -- device auth (hash only)
  is_active    boolean NOT NULL DEFAULT true,
  description  text
);

-- The single source of truth for the process sequence AND the rework path.
CREATE TABLE allowed_transitions (
  from_stage    stage_code NOT NULL REFERENCES stages(code),
  to_stage      stage_code NOT NULL REFERENCES stages(code),
  kind          transition_kind NOT NULL,
  requires_gate gate_code,          -- an approving decision must exist before this move
  PRIMARY KEY (from_stage, to_stage)
);

-- ---------------------------------------------------------------------
-- 5. PURCHASE ORDERS, PRODUCTS, RECEIPTS
-- ---------------------------------------------------------------------
CREATE TABLE purchase_orders (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_number            text NOT NULL UNIQUE,
  supplier_name        text NOT NULL,
  material_description text NOT NULL,
  quantity             numeric(12,2) NOT NULL CHECK (quantity > 0),
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfid_uid      text NOT NULL UNIQUE CHECK (rfid_uid ~ '^[0-9A-F]{8,20}$'),  -- uppercase hex
  po_id         bigint REFERENCES purchase_orders(id),
  batch_code    text,
  description   text,
  current_stage stage_code NOT NULL DEFAULT 'intake' REFERENCES stages(code),
  status        product_status NOT NULL DEFAULT 'active',
  rework_flag   boolean NOT NULL DEFAULT false,
  rework_count  integer NOT NULL DEFAULT 0,
  last_scan_at  timestamptz NOT NULL DEFAULT now(),     -- last movement, drives stall alerts
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_products_stage  ON products(current_stage);
CREATE INDEX ix_products_status ON products(status);
CREATE TRIGGER trg_products_touch BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE material_receipts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id        bigint NOT NULL REFERENCES purchase_orders(id),
  product_id   uuid   NOT NULL UNIQUE REFERENCES products(id),
  received_qty numeric(12,2) NOT NULL CHECK (received_qty > 0),
  notes        text,
  received_by  uuid REFERENCES users(id),
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. REASON CODES + INSPECTIONS (gate decisions, FR-2/3/4/18)
-- ---------------------------------------------------------------------
CREATE TABLE reason_codes (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  gate        gate_code NOT NULL,
  description text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE inspections (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id     uuid          NOT NULL REFERENCES products(id),
  gate           gate_code     NOT NULL,
  decision       decision_code NOT NULL,
  reason_code_id integer REFERENCES reason_codes(id),
  notes          text,
  decided_by     uuid NOT NULL REFERENCES users(id),
  decided_at     timestamptz NOT NULL DEFAULT now(),
  supersedes_id  bigint UNIQUE REFERENCES inspections(id),   -- FR-18: link, never overwrite
  CONSTRAINT ck_reason_on_reject CHECK (decision <> 'rejected' OR reason_code_id IS NOT NULL),
  CONSTRAINT ck_gate_decision    CHECK ((gate = 'gate3_shipment') = (decision = 'ready_for_shipment'))
);
CREATE INDEX ix_inspections_product ON inspections(product_id, gate);

-- "Current" decision = one that no later decision supersedes.
CREATE VIEW v_current_inspections AS
SELECT i.* FROM inspections i
WHERE NOT EXISTS (SELECT 1 FROM inspections s WHERE s.supersedes_id = i.id);

-- ---------------------------------------------------------------------
-- 7. STAGE TRANSITIONS: append-only, per-product hash chain (NFR-2/3)
-- ---------------------------------------------------------------------
CREATE TABLE stage_transitions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    uuid NOT NULL REFERENCES products(id),
  from_stage    stage_code,                       -- NULL only for the 'initial' row
  to_stage      stage_code NOT NULL,
  kind          transition_kind NOT NULL,
  reader_id     smallint REFERENCES readers(id),
  actor_user_id uuid REFERENCES users(id),
  inspection_id bigint REFERENCES inspections(id),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  prev_hash     bytea,
  row_hash      bytea NOT NULL
);
CREATE INDEX ix_transitions_product ON stage_transitions(product_id, id);
CREATE INDEX ix_transitions_stage   ON stage_transitions(to_stage, occurred_at);

CREATE FUNCTION transition_digest(prev bytea, p uuid, f stage_code, t stage_code, k transition_kind,
                                  rd smallint, act uuid, insp bigint, ts timestamptz)
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT digest(
    coalesce(prev, '\x'::bytea) ||
    convert_to(concat_ws('|', p, coalesce(f::text,''), t, k, coalesce(rd::text,''),
               coalesce(act::text,''), coalesce(insp::text,''),
               to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8'),
    'sha256')
$$;

CREATE FUNCTION stage_transitions_hash() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.product_id::text, 0));
  SELECT row_hash INTO v_prev FROM stage_transitions
   WHERE product_id = NEW.product_id ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := v_prev;
  NEW.row_hash  := transition_digest(v_prev, NEW.product_id, NEW.from_stage, NEW.to_stage, NEW.kind,
                                     NEW.reader_id, NEW.actor_user_id, NEW.inspection_id, NEW.occurred_at);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_transitions_hash BEFORE INSERT ON stage_transitions
  FOR EACH ROW EXECUTE FUNCTION stage_transitions_hash();

CREATE FUNCTION stage_transitions_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('texchain_events', json_build_object(
    'type','transition','product_id',NEW.product_id,'from',NEW.from_stage,
    'to',NEW.to_stage,'kind',NEW.kind,'at',NEW.occurred_at)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_transitions_notify AFTER INSERT ON stage_transitions
  FOR EACH ROW EXECUTE FUNCTION stage_transitions_notify();

-- Verify a product's hash chain has not been tampered with.
CREATE FUNCTION verify_transition_chain(p_product uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r record; v_prev bytea := NULL;
BEGIN
  FOR r IN SELECT * FROM stage_transitions WHERE product_id = p_product ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN RETURN false; END IF;
    IF r.row_hash <> transition_digest(v_prev, r.product_id, r.from_stage, r.to_stage, r.kind,
                                       r.reader_id, r.actor_user_id, r.inspection_id, r.occurred_at)
    THEN RETURN false; END IF;
    v_prev := r.row_hash;
  END LOOP;
  RETURN true;
END $$;

-- Every new product automatically gets its 'initial' transition (chain start, cycle-time start).
CREATE FUNCTION products_initial_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO stage_transitions(product_id, from_stage, to_stage, kind, occurred_at)
  VALUES (NEW.id, NULL, NEW.current_stage, 'initial', NEW.created_at);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_products_initial AFTER INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION products_initial_transition();

-- ---------------------------------------------------------------------
-- 8. SCAN LOG (every scan attempt, accepted or rejected)
-- ---------------------------------------------------------------------
CREATE TABLE scan_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rfid_uid    text NOT NULL,
  reader_code text NOT NULL,
  product_id  uuid REFERENCES products(id),
  reader_id   smallint REFERENCES readers(id),
  result      scan_result NOT NULL,
  detail      text,
  device_ts   timestamptz,
  scanned_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_scan_logs_time ON scan_logs(scanned_at DESC);
CREATE INDEX ix_scan_logs_uid  ON scan_logs(rfid_uid);

-- Append-only enforcement
CREATE TRIGGER trg_transitions_immutable BEFORE UPDATE OR DELETE ON stage_transitions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_transitions_no_truncate BEFORE TRUNCATE ON stage_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_inspections_immutable BEFORE UPDATE OR DELETE ON inspections
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_inspections_no_truncate BEFORE TRUNCATE ON inspections
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_scanlogs_immutable BEFORE UPDATE OR DELETE ON scan_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_scanlogs_no_truncate BEFORE TRUNCATE ON scan_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------
-- 9. BLOCKCHAIN / IPFS ANCHORS  (also the transactional outbox, NFR-5)
-- ---------------------------------------------------------------------
CREATE TABLE chains (
  code      text PRIMARY KEY,           -- e.g. 'polygon_amoy'
  name      text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE chain_anchors (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inspection_id   bigint NOT NULL REFERENCES inspections(id),
  chain_code      text   NOT NULL REFERENCES chains(code),
  metadata        jsonb  NOT NULL,       -- exact JSON the worker pins to IPFS
  metadata_hash   bytea  NOT NULL,       -- sha256(metadata::text) for FR-17 verification
  ipfs_cid        text,
  tx_hash         text,
  block_number    bigint,
  confirmations   integer NOT NULL DEFAULT 0,
  status          anchor_status NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  confirmed_at    timestamptz,
  UNIQUE (inspection_id, chain_code)
);
CREATE INDEX ix_anchors_queue ON chain_anchors(next_attempt_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- 10. NOTIFICATIONS (NFR-4)
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid REFERENCES users(id),
  target_role   role_code,
  department_id smallint REFERENCES departments(id),
  product_id    uuid REFERENCES products(id),
  type          text NOT NULL,
  message       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  CONSTRAINT ck_notif_target CHECK (user_id IS NOT NULL OR target_role IS NOT NULL)
);
CREATE INDEX ix_notif_unread ON notifications(target_role, created_at DESC) WHERE read_at IS NULL;

COMMIT;
