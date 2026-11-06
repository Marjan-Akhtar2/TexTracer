-- =====================================================================
-- 05_seed.sql : reference data (required) + demo users/PO (dev only)
-- =====================================================================
BEGIN;

INSERT INTO roles(code, description) VALUES
 ('system_admin',      'Manages user accounts and role assignment'),
 ('department_officer','Scans items in/out of own department'),
 ('warehouse_manager', 'Gate 1: raw material intake approval'),
 ('qc_officer',        'Gate 2: stitching quality approval'),
 ('auditor',           'Read-only approval/rejection history'),
 ('senior_management', 'Read-only KPI dashboard');

INSERT INTO departments(code, name) VALUES
 ('procurement','Procurement'), ('design','Design'), ('manufacturing','Manufacturing'),
 ('production','Production'), ('stitching_qc','Stitching + QC Gate'),
 ('packaging','Packaging'), ('shipping','Shipping'), ('warehouse','Warehouse');

-- Stages (seq order = process order). sla_minutes = stalled-item window; tune later.
INSERT INTO stages(code, department_id, seq, sla_minutes)
SELECT s.code::stage_code, d.id, s.seq, s.sla
  FROM (VALUES
    ('intake',          'warehouse',     0,  240),
    ('raw_material_1',  'procurement',   1,  480),
    ('raw_material_2',  'procurement',   2,  480),
    ('design',          'design',        3,  1440),
    ('manufacturing_1', 'manufacturing', 4,  1440),
    ('manufacturing_2', 'manufacturing', 5,  1440),
    ('production',      'production',    6,  1440),
    ('stitching',       'stitching_qc',  7,  720),
    ('packaging',       'packaging',     8,  480),
    ('shipping',        'shipping',      9,  480)
  ) AS s(code, dept, seq, sla)
  JOIN departments d ON d.code = s.dept;

-- 9 physical readers (intake has none: it is an approval gate, no hardware)
INSERT INTO readers(reader_code, stage, description) VALUES
 ('RDR-RM1','raw_material_1','Raw Material 1'),
 ('RDR-RM2','raw_material_2','Raw Material 2'),
 ('RDR-DESIGN','design','Design'),
 ('RDR-MFG1','manufacturing_1','Manufacturing 1'),
 ('RDR-MFG2','manufacturing_2','Manufacturing 2'),
 ('RDR-PROD','production','Production'),
 ('RDR-STITCH','stitching','Stitching'),
 ('RDR-PACK','packaging','Packaging'),
 ('RDR-SHIP','shipping','Shipping');

-- Process rules (FR-15) + rework path (FR-4)
INSERT INTO allowed_transitions(from_stage, to_stage, kind, requires_gate) VALUES
 ('intake',         'raw_material_1', 'forward', 'gate1_intake'),
 ('raw_material_1', 'raw_material_2', 'forward', NULL),
 ('raw_material_2', 'design',         'forward', NULL),
 ('design',         'manufacturing_1','forward', NULL),
 ('design',         'manufacturing_2','forward', NULL),
 ('manufacturing_1','production',     'forward', NULL),
 ('manufacturing_2','production',     'forward', NULL),
 ('production',     'stitching',      'forward', 'gate2_qc'),
 ('production',     'production',     'rework',  NULL),
 ('stitching',      'packaging',      'forward', NULL),
 ('packaging',      'shipping',       'forward', 'gate3_shipment');

INSERT INTO reason_codes(code, gate, description) VALUES
 ('QTY_MISMATCH',    'gate1_intake', 'Quantity differs from purchase order'),
 ('WRONG_MATERIAL',  'gate1_intake', 'Material does not match purchase order'),
 ('DAMAGED_GOODS',   'gate1_intake', 'Material damaged on arrival'),
 ('DEFECT_STITCH',   'gate2_qc',     'Stitching defect'),
 ('DEFECT_FABRIC',   'gate2_qc',     'Fabric defect'),
 ('DEFECT_DIMENSION','gate2_qc',     'Dimensions out of tolerance');

-- Multi-chain: add rows here; is_active decides which chains receive anchors
INSERT INTO chains(code, name, is_active) VALUES
 ('polygon_amoy', 'Polygon Amoy (testnet)', true),
 ('sepolia',      'Ethereum Sepolia (testnet)', false);

-- ---------------------- DEMO DATA (dev only) --------------------------
-- Password for all demo users: ChangeMe!123   (bcrypt via pgcrypto; FastAPI/passlib can verify $2a$)
INSERT INTO users(email, full_name, password_hash, department_id)
SELECT v.email, v.name, crypt('ChangeMe!123', gen_salt('bf', 12)), d.id
  FROM (VALUES
    ('admin@texchain.local',      'System Admin',      NULL),
    ('warehouse@texchain.local',  'Warehouse Manager', 'warehouse'),
    ('qc@texchain.local',         'QC Officer',        'stitching_qc'),
    ('officer@texchain.local',    'Dept Officer',      'production'),
    ('auditor@texchain.local',    'Auditor',           NULL),
    ('management@texchain.local', 'Senior Management', NULL)
  ) AS v(email, name, dept)
  LEFT JOIN departments d ON d.code = v.dept;

INSERT INTO user_roles(user_id, role)
SELECT u.id, m.role::role_code
  FROM users u
  JOIN (VALUES
    ('admin@texchain.local','system_admin'),
    ('warehouse@texchain.local','warehouse_manager'),
    ('qc@texchain.local','qc_officer'),
    ('officer@texchain.local','department_officer'),
    ('auditor@texchain.local','auditor'),
    ('management@texchain.local','senior_management')
  ) AS m(email, role) ON m.email = u.email::text;

INSERT INTO purchase_orders(po_number, supplier_name, material_description, quantity)
VALUES ('PO-1001', 'Demo Textiles Ltd', 'Cotton fabric rolls', 100);

COMMIT;
