-- =====================================================================
-- 04_security.sql : least-privilege DB roles (NFR-1, NFR-2, NFR-6)
--   texchain_app      : used by FastAPI  (no UPDATE/DELETE on audit tables)
--   texchain_readonly : reporting / auditor / dashboard queries (SELECT only)
-- CHANGE THE PASSWORDS before any non-local use.
-- =====================================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'texchain_app') THEN
    CREATE ROLE texchain_app LOGIN PASSWORD 'change_me_app';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'texchain_readonly') THEN
    CREATE ROLE texchain_readonly LOGIN PASSWORD 'change_me_ro';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO texchain_app, texchain_readonly;

-- App: full DML on mutable tables
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, user_roles, purchase_orders, products, material_receipts,
  reason_codes, readers, chain_anchors, notifications, chains
TO texchain_app;

-- App: reference data is read-only at runtime (changed only via migrations)
GRANT SELECT ON roles, departments, stages, allowed_transitions TO texchain_app;

-- App: audit tables are INSERT-only (belt) + triggers block changes (braces)
GRANT SELECT, INSERT ON stage_transitions, inspections, scan_logs TO texchain_app;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO texchain_app;   -- views
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO texchain_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO texchain_app;

-- Read-only role: everything except password hashes and device keys
GRANT SELECT ON ALL TABLES IN SCHEMA public TO texchain_readonly;
REVOKE SELECT ON users, readers FROM texchain_readonly;
GRANT SELECT (id, email, full_name, department_id, is_active, created_at) ON users TO texchain_readonly;
GRANT SELECT (id, reader_code, stage, is_active, description) ON readers TO texchain_readonly;

COMMIT;
