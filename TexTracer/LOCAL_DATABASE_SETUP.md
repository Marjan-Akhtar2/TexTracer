# TexTracer – run with a LOCAL database (no cloud, works on a mobile hotspot)

Flow: **RFID tag → ESP32 → Wi-Fi (your hotspot) → backend on your laptop (port 5000) → PostgreSQL on the same laptop → frontend (browser)**

The backend uses a **local PostgreSQL** server instead of Supabase. (SQLite was not possible: the scan logic, audit triggers and
logins are written as PostgreSQL functions/triggers in `database/*.sql`, and the backend calls them. A local PostgreSQL runs these
files unchanged, so every endpoint, role and the ESP32 protocol stay exactly as they were.)

Your Supabase database and its `DATABASE_URL` are **not touched or deleted**. They are simply not used unless you set `DB_MODE=cloud`.

---
## 1. Install PostgreSQL (once)
PowerShell:
```powershell
winget install -e --id PostgreSQL.PostgreSQL.16
```
(or download the installer from postgresql.org/download/windows). In the installer:
* choose a password for the **postgres** administrator and **remember it** (it is only used by the setup script, once),
* keep port **5432**, keep "Stack Builder" unticked.

PostgreSQL installs as a Windows service that **starts automatically with the laptop**; its data folder is on your disk, so data survives restarts.
Close and re-open PowerShell afterwards. Check: `psql --version` (if "not recognized", that is fine – the setup script finds it by itself).

## 2. Install the backend packages
```powershell
cd TexTracer\backend
npm install
```
If PowerShell blocks npm: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

## 3. Create the local database (once)
```powershell
npm run db:init
```
It asks for the **postgres administrator password** (typing is hidden), then creates the user `textracer`, the database `textracer`,
all tables/indexes/views/functions/triggers (your `database/01..07*.sql` files) and the demo data
(users `admin@ warehouse@ qc@ officer@ auditor@ management@ + texchain.local`, password `ChangeMe!123`, the 9 readers, stages, rules).
Safe to run again: if the schema is already there it changes nothing.

## 4. Configure the backend
`backend\.env` already works with the defaults. To be explicit, make sure it contains (create it with `Copy-Item .env.example .env` if you have none, and set `JWT_SECRET`):
```
DB_MODE=local
DATABASE_URL_LOCAL=postgresql://textracer:textracer_local@localhost:5432/textracer
```
A cloud `DATABASE_URL` line may stay in the file; it is ignored while `DB_MODE=local`.
For anything other than a demo, change the app password: `npm run db:init -- --app-password "YourPassword"` and put it in `DATABASE_URL_LOCAL`
(URL-encode special characters: `@`→`%40`, `#`→`%23`).

## 5. Check the database, then start the backend
```powershell
npm run db:check        # explains any problem in plain words, prints no password
npm run dev
```
The start-up output must show: `Database mode: local -> LOCAL (this laptop, no internet needed)` and `Database: connected`, plus
`BACKEND_HOST "<ip>"`. Open `http://localhost:5000/api/health` → `"database":"connected","databaseMode":"local"`.

## 6. Start the frontend (second PowerShell window)
```powershell
cd TexTracer\frontend
copy .env.example .env      # first time only
npm install
npm run dev                 # http://localhost:8080
```

## 7. Reader keys + ESP32 on the hotspot
This is unchanged from `RUN_GUIDE.md` (steps 6–8); a new database has no reader keys yet, so do it once more:
```powershell
cd TexTracer
node hardware_integration\tools\provision_reader_keys.mjs      # admin@texchain.local / ChangeMe!123
```
Hotspot checklist (no firmware *logic* changes; only the values you already edit in `config.h`):
1. Laptop **and** ESP32 join the **same phone hotspot**; set the hotspot to **2.4 GHz** (ESP32 cannot use 5 GHz).
2. `WIFI_SSID` / `WIFI_PASSWORD` = the hotspot; `BACKEND_HOST` = the IP the backend printed at start-up. **A hotspot hands out different IPs on different days – re-check it each session.** Re-flash only if it changed.
3. Windows Firewall (PowerShell as Administrator, once):
   `New-NetFirewallRule -DisplayName "TexTracer backend 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Any`
4. Test from the phone's browser: `http://<BACKEND_HOST>:5000/api/health`.

The database itself needs **no network at all**: it is on the laptop. The hotspot is only the link between ESP32 and laptop.

---
## Verify that an RFID scan is saved locally
1. Backend is running and `npm run db:check` is all `[ OK ]`.
2. Tap a tag. ESP32 serial monitor (115200) shows `[DB] SAVED` (or the backend's verdict, e.g. unknown tag – an unknown tag is also saved, as `rejected_unknown_tag`).
3. Backend window shows `POST /api/scans/device -> 201` (or 200 / 404 / 422).
4. Read it straight from the local database:
```powershell
$env:PGPASSWORD = "textracer_local"
psql -h localhost -U textracer -d textracer -c "SELECT id, rfid_uid, reader_code, result, scanned_at FROM scan_logs ORDER BY id DESC LIMIT 5;"
```
(If `psql` is not recognized: `& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost ...`)
5. Or through the API/UI: `node hardware_integration\tools\verify_scans.mjs` , or log in as `auditor@texchain.local` → **Live RFID Scans**.
6. Persistence: stop the backend (Ctrl+C), start it again (or restart the laptop) and repeat step 4 – the rows are still there. `npm run db:check` shows the saved-scan count.
7. Cloud-independence: switch the laptop to the hotspot with no internet and repeat; nothing changes.

## Tests
```powershell
cd TexTracer\backend
npm run db:init:test    # once: creates a separate throw-away database "textracer_test"
npm test                # all tests; the local-database tests need the test DB, otherwise they are reported as SKIPPED
npm run test:local      # only the "scans are saved and read back" tests
```
`tests/local.db.test.ts` sends an ESP32-style `POST /api/scans/device` to the real HTTP server, checks the row in PostgreSQL, reads it back through
`GET /api/scans` and the product history, and re-reads it through a new connection pool (= restart). It refuses to run on any database not named `*_test`.

## Troubleshooting (messages come from `npm run dev` / `npm run db:check` / `/api/health`)
| Message | Meaning / fix |
|---|---|
| `ECONNREFUSED` | PostgreSQL is not running: Windows → Services → `postgresql-x64-16` → Start (or wrong port) |
| `28P01 password authentication failed` | `DATABASE_URL_LOCAL` password ≠ the one in the database → `npm run db:init -- --app-password "…"` and use the same in `.env` |
| `3D000 database does not exist` / `42P01` / missing tables | `npm run db:init` |
| `db:init`: "Wrong password for postgres" | use the administrator password chosen in the PostgreSQL installer |
| `readers … 0 with a device key` | run `provision_reader_keys.mjs` (step 7), re-flash `reader_keys.h` |
| Backend `Blockchain: DISABLED` | normal without a MultiChain node; unrelated to the database |
| ESP32 `401` | reader key missing/old → step 7 |

## Maintenance
* Back up: `pg_dump -h localhost -U textracer -d textracer -F c -f textracer_backup.dump`
* Start over with empty demo data (**deletes local data only**): `npm run db:reset`
* Go back to the cloud database: `DB_MODE=cloud` in `backend\.env` (needs the internet and a valid `DATABASE_URL`).
