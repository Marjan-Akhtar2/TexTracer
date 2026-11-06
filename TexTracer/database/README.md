# Database (PostgreSQL: local by default, Supabase optional)

**Local (default):** `cd backend; npm run db:init` creates the database and loads files 01–07 for you (see `../LOCAL_DATABASE_SETUP.md`, script: `local/init-local-db.mjs`).

Manual / Supabase route:

Supplied schema (not modified). Run in the Supabase SQL Editor in this order:
`01_schemas.sql`, `02_views.sql`, `03_functions.sql`, `04_security.sql`, `05_seed.sql`.
Do NOT re-run on a database that already has these tables.
`05_seed.sql` creates demo users (password `ChangeMe!123`): change them before real use.
