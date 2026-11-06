-- =====================================================================
-- 07_demo_officers.sql : OPTIONAL, DEV ONLY. Creates one Department Officer per department so you can watch
-- hardware scans at EVERY reader in the frontend (an officer only sees readers of their own department).
-- Password for all of them: ChangeMe!123   -> change before real use.
-- Safe to run more than once (existing accounts are left alone). Run in the Supabase SQL editor.
-- =====================================================================
BEGIN;
INSERT INTO users(email, full_name, password_hash, department_id)
SELECT v.email, v.name, crypt('ChangeMe!123', gen_salt('bf', 12)), d.id
  FROM (VALUES
    ('procurement@texchain.local',   'Procurement Officer',   'procurement'),
    ('design@texchain.local',        'Design Officer',        'design'),
    ('manufacturing@texchain.local', 'Manufacturing Officer', 'manufacturing'),
    ('stitching@texchain.local',     'Stitching Officer',     'stitching_qc'),
    ('packaging@texchain.local',     'Packaging Officer',     'packaging'),
    ('shipping@texchain.local',      'Shipping Officer',      'shipping')
  ) AS v(email, name, dept)
  JOIN departments d ON d.code = v.dept
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = v.email::citext);

INSERT INTO user_roles(user_id, role)
SELECT u.id, 'department_officer'::role_code FROM users u
 WHERE u.email::text IN ('procurement@texchain.local','design@texchain.local','manufacturing@texchain.local',
                         'stitching@texchain.local','packaging@texchain.local','shipping@texchain.local')
   AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id);
COMMIT;
