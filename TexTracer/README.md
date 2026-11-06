# TexTracer — integrated project (frontend + backend + local PostgreSQL database)

> **Database: LOCAL by default.** Setup guide: **[LOCAL_DATABASE_SETUP.md](LOCAL_DATABASE_SETUP.md)** (no cloud, works on a phone hotspot). Anything below that mentions Supabase applies only to `DB_MODE=cloud`.

```
TexTracer/
├── backend/    Node.js + TypeScript REST API  -> http://localhost:5000   (talks to a PostgreSQL on this laptop; Supabase only with `DB_MODE=cloud`)
├── frontend/   React + Vite (TanStack Start)  -> http://localhost:8080   (talks only to the backend API)
├── database/   The SQL files; `database/local/init-local-db.mjs` loads them into the local database (`npm run db:init`)
└── README.md   this file
```

| What | Port / URL |
|---|---|
| Backend API | `http://localhost:5000/api` |
| Health check | `http://localhost:5000/api/health` (must show `"database": "connected"`) |
| Frontend | `http://localhost:8080` |
| Database | Local PostgreSQL `textracer` on `localhost:5432` (created by `npm run db:init`) |

**No secrets are included in this ZIP.** You supply your own `JWT_SECRET` (and `DATABASE_URL` only for `DB_MODE=cloud`) in `backend/.env`. That file is git-ignored.

---

> **Hardware (ESP32 RFID readers):** follow **[RUN_GUIDE.md](RUN_GUIDE.md)** for the complete step-by-step run order.

## 1. Prerequisites (once)

* **Node.js 22 LTS or newer** — check in PowerShell: `node --version`
* **VS Code** (optional but assumed below)
* Your Supabase database already contains the five SQL files from `database/` (you said it does).

If PowerShell refuses to run `npm` with a message about *running scripts is disabled*, run this once and retry:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## 2. Extract and open in VS Code

```powershell
cd $HOME\Downloads
Expand-Archive -Path .\TexTracer.zip -DestinationPath $HOME\Documents -Force
cd $HOME\Documents\TexTracer
code .
```

In VS Code open two terminals (**Terminal → New Terminal**, then the `+` button): one for the backend, one for the frontend.

## 3. Backend: configure, install, start (Terminal 1)

```powershell
cd backend
Copy-Item .env.example .env
notepad .env
```

In `.env` set **your existing values**:

* `DATABASE_URL` — the same Supabase connection string your backend already uses (pooler user is `postgres.<project-ref>`).
* `JWT_SECRET` — your existing secret (at least 16 characters). To make a new one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
* `CORS_ORIGIN` — leave the default; it already allows `http://localhost:8080`.
* `MULTICHAIN_*` — the blockchain layer (optional). Fill `MULTICHAIN_RPC_PASSWORD` to switch it on; see **section 3b**.

```powershell
npm install
npm run dev
```

You should see the server listening on port 5000.

## 3b. Blockchain (MultiChain) — optional but wired in

1. Run `database/06_multichain_chain.sql` once in the Supabase SQL editor (data-only: no tables/columns change).
2. Start a MultiChain node for `chain1` and put its RPC user/password/port in `backend/.env` (`MULTICHAIN_*`).
3. Start the backend. You should see `Blockchain: MultiChain ... (worker running)`; each Gate decision is then published
   to the `gate_scans` stream and its status moves pending → submitted → confirmed on the Blockchain and Tracking pages.

Full guide, endpoints and troubleshooting: `backend/docs/BLOCKCHAIN.md`. Without `MULTICHAIN_RPC_PASSWORD` the app runs exactly as before.

## 4. Verify the database connection

In a third terminal (or the same one after the server is running):

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

Expected: `status: ok` and `database: connected`. If it says `unreachable`, run `npm run db:check` in `backend/` (it names the cause and the fix; see LOCAL_DATABASE_SETUP.md). Cloud mode only: re-check `DATABASE_URL`.

## 5. Frontend: configure, install, start (Terminal 2)

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open **http://localhost:8080**. `frontend/.env` only contains `VITE_API_URL=http://localhost:5000/api`. If you change the backend port, change it here and in `CORS_ORIGIN`.

## 6. Test login and every module

Seed accounts (from `database/05_seed.sql`, password `ChangeMe!123` — change these before real use):

| Account | Role | Screens |
|---|---|---|
| `admin@texchain.local` | System Administrator | Dashboard, Users (create / edit / role / activate), Roles & Permissions, RFID Readers (device keys) |
| `warehouse@texchain.local` | Warehouse Manager | Overview, Gate 1 (register material + purchase orders, approve / reject), Product Tracking, Blockchain Verification |
| `officer@texchain.local` | Department Officer (Production) | Overview, Department Items, RFID Scan, Production Flow, Product Tracking, Rework Queue (complete rework) |
| `qc@texchain.local` | QC Officer | Overview, Gate 2 (approve / reject to rework), Rework Items, Product Tracking |
| `auditor@texchain.local` | Auditor | Audit History (decisions + stage transitions), Product Tracking, Blockchain Verification |
| `management@texchain.local` | Senior Management | Overview, Analytics, Production Flow, Alerts, Product Tracking, Blockchain Verification |

**Create the other department officers** (log in as admin → Users → *Create user*, role *Department Officer*, pick the department). They are needed because a scan is only accepted from a reader of the officer's own department:

| Department | Reader code | Suggested email |
|---|---|---|
| Procurement | `RDR-RM1`, `RDR-RM2` | `procurement@texchain.local` |
| Design | `RDR-DESIGN` | `design@texchain.local` |
| Manufacturing | `RDR-MFG1`, `RDR-MFG2` | `manufacturing@texchain.local` |
| Production | `RDR-PROD` | (seed `officer@`) |
| Stitching + QC Gate | `RDR-STITCH` | `stitching@texchain.local` |
| Packaging | `RDR-PACK` (also Gate 3) | `packaging@texchain.local` |
| Shipping | `RDR-SHIP` | `shipping@texchain.local` |

**End-to-end walk-through** (exercises every gate):

1. `warehouse@` → Gate 1 → *Register material*: pick purchase order `PO-1001` (or create one), enter a hex RFID UID such as `A1B2C3D4E5`, a quantity → it appears in the queue → *Review* → **Approve**.
2. Log in as each officer in order and scan the tag at their reader: Procurement (`RDR-RM1`, then `RDR-RM2`) → Design → Manufacturing (`RDR-MFG1` or `RDR-MFG2`) → Production (`RDR-PROD`). Try an out-of-order scan to see the server reject it.
3. `qc@` → Gate 2 → *Inspect* → **Reject** with a reason (item goes to rework) — or Approve.
4. `officer@` (Production) → Rework Queue → *Complete rework*; then `qc@` → Gate 2 → *Re-inspect* → Approve.
5. Stitching officer scans `RDR-STITCH`, Packaging officer scans `RDR-PACK`, then Packaging officer → **Gate 3** → *Mark ready for shipment*; Shipping officer scans `RDR-SHIP`.
6. `management@` → Overview/Analytics/Alerts/Flow show the KPIs, stage counts, rejection reasons and stalled items computed by the database views. `auditor@` → Audit History shows every decision and transition. Bell icon → in-app notifications.

Note: the login endpoint is rate limited (10 attempts / 15 min / IP by default). If you hit it while testing, wait or raise `LOGIN_RATE_LIMIT_MAX` in `backend/.env`.

## 7. Automated checks

```powershell
cd backend
npm run typecheck      # TypeScript compile check
npm test               # unit + HTTP tests (no database needed); read-only DB test runs if DATABASE_URL works

cd ..\frontend
npm run build          # production build of the frontend
```

---

## Completed integrations

Every item below calls the real backend; there is no mock data, fake statistics or simulated blockchain data left in the frontend (the old `textracer-data.ts` was deleted).

| Area | Frontend | Backend endpoints used |
|---|---|---|
| Login / session | Email + password form, token in `sessionStorage`, session restore on refresh, automatic sign-out on 401, protected views per role | `POST /auth/login`, `GET /auth/me` |
| Role-based access | Sidebar and screens per role (and per department for officers); server enforces the same rules | all |
| Senior Management dashboard | KPI tiles, department throughput, rejection-reason donut, stage flow with bottleneck, anchor status, dwell time, alerts (refresh every 30 s) | `/dashboard/kpis`, `/stages`, `/rejection-reasons`, `/anchors`, `/stalled`, `/overview` |
| Other role dashboards | Counts from live queries (admin: users/roles; warehouse: Gate 1 queue; QC: Gate 2 + rework; officers: department items, scans, stalled) | `/users`, `/roles`, `/approvals/pending`, `/products`, `/rework`, `/scans` |
| Products & inventory | Search, status filter, pagination, detail, journey, history timeline, **register material** (create), **create purchase order** | `/products`, `/products/:id`, `/history`, `/purchase-orders` |
| RFID scanning | Scan form with the officer's own readers, accepted / duplicate / rejected results, recent scan log | `POST /scans`, `GET /scans`, `/readers` |
| Approval workflows | Gate 1, Gate 2, Gate 3 with reason codes and notes, rework-aware re-inspection | `/approvals/pending`, `/reason-codes`, `POST /approvals/:id/decisions` |
| Rework | Queue with QC reason, Production officer completes rework | `/rework`, `POST /rework/:id/complete` |
| Audit history | Decisions and stage transitions, server filters (gate, decision, kind, dates), page filter, pagination | `/audit/decisions`, `/audit/transitions` |
| Users & roles | List, create, edit, change role, activate / deactivate, reset password; roles from the backend | `/users`, `/users/:id`, `/users/:id/role`, `/roles`, `/departments` |
| RFID reader keys | Generate / rotate ESP32 device key (shown once) | `/readers`, `PUT /readers/:id/key` |
| Notifications | Bell with unread dot, 30 s polling, mark read / mark all read | `/notifications`, `POST /notifications/:id/read` |
| Blockchain verification | Per-product hash-chain check, MultiChain anchor status (txid, confirmations); live on-chain check available via API | `/products/:id/verification`, `/blockchain/products/:id/verify`, `/blockchain/status` |
| Loading / error handling | Loading indicators, error panels with Retry, toasts for actions, API-unreachable message | – |
| CORS / config | `.env.example` for both apps, CORS allow-list includes ports 8080 and 5173 | – |

Small UI additions needed because the backend supports them: Register-material dialog (Gate 1), Gate 3 screen and Rework Queue for the matching officer departments, RFID Readers screen for admins. Layout, styling and the rest of the navigation are unchanged. The role dropdown on the login page was replaced with real email / password fields.

## Remaining limitations (documented, not faked)

* **Blockchain:** requires a running MultiChain node you operate (not bundled). Delivery is at-least-once; the live on-chain check (`/blockchain/products/:id/verify`) is an API endpoint and has no dedicated button in the UI yet.
* **Dashboard figures that the API cannot supply were removed rather than invented:** week-over-week trends, "approved today", QC pass rate, per-day completions. Officer / warehouse / QC tiles show counts the API does provide.
* **No delete or edit for products, purchase orders or history** — by design (append-only audit tables; the API has no such endpoints). Users support create / edit / role / deactivate; there is no delete endpoint.
* **Gate 1 rejection is final** for that tag (database rule); register replacement material with a new tag.
* **Rework completion** is stored as a notification marker (no column exists); no rework assignee field.
* **Gate 3** is limited to Packaging-department officers (API rule); the Gate 3 screen only appears for them.
* **Logout** discards the token on the client; tokens stay valid until they expire (default 8 h).
* **Notifications** are polled every 30 s (no push channel). Rate limits are per process.
* **Navigation state is not in the URL** (single-page app): refreshing keeps you signed in and returns you to your home screen.
* **Production Flow for officers** counts only the (up to 100) items their department can see.
* The ESP32 endpoint `POST /scans/device` exists in the backend but has no screen (hardware-only).

## Verification status — please read

Blockchain integration, checked in the build environment:

* Backend `npm run typecheck` and `npm run build`: clean. Frontend `tsc -b`: clean.
* `npm test`: **70 / 70 pass** against a real PostgreSQL 16 loaded with `database/01–05` (50 original + 14 new blockchain tests; without a database the 6 DB tests skip).
* End-to-end against that PostgreSQL with the real server: decision made with the layer off → `06_multichain_chain.sql` (run twice) backfilled it → worker published and confirmed it → a new live decision flowed through → `/blockchain/products/:id/verify` returned `verified` → a tampered on-chain payload returned `mismatch` → a node outage left anchors queued (no attempts burned) and they published after recovery.
* **Not tested:** a real MultiChain daemon (a faithful in-process JSON-RPC stand-in was used: `publish`, `getstreamitem`, `liststreams`, `create`, `subscribe`, `getrawtransaction`, `getblock`, `getinfo`), the Supabase pooler, and a browser. The first run against your real node is the real acceptance test; `backend/docs/BLOCKCHAIN.md` lists what each error message means.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login page says *Cannot reach the TexTracer API* | Backend not running, wrong `VITE_API_URL`, or the page's address is not in `CORS_ORIGIN` (restart the backend after editing `.env`) |
| `/api/health` → `database: unreachable` | Run `npm run db:check` (local PostgreSQL stopped? wrong `DATABASE_URL_LOCAL` password? not initialised: `npm run db:init`) |
| `EADDRINUSE` port 5000 / 8080 | Another program uses it. Stop it, or change `PORT` (backend) / `server.port` in `frontend/vite.config.ts`, and update `VITE_API_URL` and `CORS_ORIGIN` |
| 429 on login | Login rate limit; wait 15 min or raise `LOGIN_RATE_LIMIT_MAX` |
| A scan returns 403 *Reader … belongs to …* | Sign in as the officer of that reader's department |
| Gate 2 shows *Awaiting rework* | Production officer must complete the rework first |
