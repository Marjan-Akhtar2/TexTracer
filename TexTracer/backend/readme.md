# TexTracer backend

Node.js + TypeScript REST API on a **local PostgreSQL** database (schema in `../database/`; setup: `../LOCAL_DATABASE_SETUP.md`). Supabase/any hosted PostgreSQL still works with `DB_MODE=cloud`. Only two runtime packages are used (`pg`, `zod`, plus `dotenv`); the HTTP server is Node's built-in `http` module.
Full endpoint list: `docs/API.md` · database usage and gaps: `docs/DATABASE_NOTES.md` · frontend: `docs/FRONTEND_INTEGRATION.md`.

## What you must install (once)
1. **Node.js 22 LTS or newer** (nodejs.org). Check: `node --version`.
2. **Git** (git-scm.com), only to clone/push the repo.
3. **PostgreSQL 16** on this laptop (`winget install -e --id PostgreSQL.PostgreSQL.16`), then `npm run db:init` loads the SQL files from `../database/`.
Nothing else (no Docker, no Python).

## Run it
```powershell
cd backend
npm install
npm run db:init                    # once: creates the local database (asks for the postgres admin password)
Copy-Item .env.example .env        # macOS/Linux: cp .env.example .env
```
Edit `.env`: set `JWT_SECRET` (`DB_MODE=local` is the default; set `DATABASE_URL` only for `DB_MODE=cloud`) (generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
```powershell
npm run dev                         # http://localhost:5000
```
Open http://localhost:5000/api/health -> `"database": "connected"`.

| Script | Purpose |
|---|---|
| `npm run dev` | run with auto-reload |
| `npm run build` then `npm start` | compile to `dist/` and run |
| `npm run typecheck` | TypeScript check |
| `npm test` | all tests |
| `npm run db:init` / `db:init:test` / `db:reset` | create / create test DB / rebuild local database |
| `npm run db:check` | diagnose the database connection and schema |
| `npm run test:local` | scans saved + read back in the local test database |

## Tests (`npm test`)
- `tests/unit.test.ts`: logic (config, JWT, roles, validation, router, rate limit, error mapping, bottleneck maths).
- `tests/http.test.ts`: the real HTTP server with an in-memory user list and a database that fails if touched. Checks login, tokens, **every endpoint against every role (401/403)**, validation, CORS, headers, rate limiting. **Needs no database.**
- `tests/readonly.db.test.ts`: read-only checks on your configured database. **Skipped automatically** if it is unreachable. It writes nothing.
- `tests/local.db.test.ts`: writes real scans into the separate `textracer_test` database (`npm run db:init:test` once) and reads them back; skipped if that DB is absent.
- `tests/db.diagnostics.test.ts`: DB-mode selection and error explanations (no database needed).
The database `append-only` tables (`inspections`, `stage_transitions`, `scan_logs`) cannot be cleaned up, so write-tests against a real database are intentionally not included.

## Try the API by hand (PowerShell)
```powershell
$r = Invoke-RestMethod -Method Post http://localhost:5000/api/auth/login -ContentType 'application/json' `
     -Body '{"email":"warehouse@texchain.local","password":"ChangeMe!123"}'
$h = @{ Authorization = "Bearer $($r.data.token)" }
Invoke-RestMethod http://localhost:5000/api/products -Headers $h
```
Demo accounts (from `05_seed.sql`, password `ChangeMe!123`; change them before real use): `admin@`, `warehouse@`, `qc@`, `officer@` (Production), `auditor@`, `management@` + `texchain.local`.
Other departments need their own officer accounts (create them as admin: `POST /api/users` with a `departmentId`).

## Security summary
Server-side RBAC on every route (`src/middleware/requireRole.ts`) · token checked against the live database row on every request (deactivation/role change is immediate) · passwords hashed by the database (bcrypt) and never returned · login, device and global rate limits · strict CORS allow-list · security headers · all SQL parameterised · request bodies limited to 100 KB · errors never expose stack traces, SQL or secrets · audit tables are append-only (database triggers) and the API has no write endpoint for history · RFID readers authenticate with per-reader keys (only a SHA-256 is stored) · `.env` is git-ignored.
Limitations: rate limiting is per process (in memory); tokens are stateless (logout = client discards the token, valid until expiry); HTTPS must be provided by your hosting; the real-`pg` driver path is exercised only when you run it with your database.

## Folder map
```
src/server.ts, app.ts          start-up and wiring
src/config  src/db  src/core   env, database pool, errors/response/validation/JWT/roles
src/http                       tiny router, request listener (CORS, headers, body, errors), rate limiter
src/middleware                 authenticate, requireRole
src/modules/<name>             routes + repo (SQL) [+ schemas/service] for: auth users roles departments stages
                               purchase-orders products scans approvals rework notifications audit dashboard
src/routes/index.ts            route table
tests/  docs/
```
Never commit `.env`.
