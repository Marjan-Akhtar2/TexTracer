# TexTracer – run everything on your laptop (Windows PowerShell)

> **The database is now LOCAL PostgreSQL.** Do steps 2–3 of this guide via **[LOCAL_DATABASE_SETUP.md](LOCAL_DATABASE_SETUP.md)** (`npm run db:init`); the Supabase wording in steps 2–3 below is only for `DB_MODE=cloud`.

Flow: **RFID tag → MFRC522 reader → ESP32 → Wi-Fi → backend (laptop, port 5000) → local PostgreSQL database → frontend (browser)**

## What was wrong (why scans never appeared)
1. **Database password** – `backend/.env` had `...TexTracer1***@...`. `***` is a placeholder; with it the backend cannot reach Supabase, so no scan can be saved.
2. **Readers had no device key** – the backend answers `401` to the ESP32 until each reader has a key (`provision_reader_keys.mjs`) and that key is flashed into `reader_keys.h`.
3. **ESP32 pointed at the wrong address** – `BACKEND_HOST` must be the laptop's Wi-Fi IP (not `localhost`), the laptop firewall must allow port 5000, and both must be on the same 2.4 GHz Wi-Fi.
4. **Tags were not registered** – a tag is only moved if a Warehouse Manager registered its UID and approved Gate 1. Unregistered taps are saved as `rejected_unknown_tag`, but nothing in the UI showed them.
5. **The UI could not see hardware scans** – officers only see their own department's readers, and Warehouse/Admin/Auditor/Management had no scan screen.

Added to fix this: **Live RFID Scans** screen (all roles except QC), **Reader connection status** (shows even refused/401 requests), **"Tags just tapped on the readers"** list in Gate 1 / RFID Scan (click a tapped tag to register it – no typing), backend start-up banner that prints the IP for the ESP32 and warns about a placeholder DB password, firmware messages for wrong Wi-Fi/host, `provision_reader_keys.mjs --force`, and optional `database/07_demo_officers.sql`.

## Steps

**1. Install** Node.js 22+ (`node --version`), Arduino IDE 2.x. If PowerShell blocks npm: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

**2. Database (Supabase)** – the five SQL files are already run; do **not** re-run them. In the Supabase *SQL Editor* run once:
- `database/06_multichain_chain.sql` (only if you use blockchain – safe to skip otherwise)
- `database/07_demo_officers.sql` (optional: one officer per department so you can watch every reader)

**3. Backend `.env`** – open `backend\.env`, set `DATABASE_URL` with your **real** password (Supabase → Project Settings → Database → Connection string → *Session pooler*). URL-encode special characters (`@`→`%40`, `#`→`%23`). Blockchain: set `MULTICHAIN_ENABLED=false` if you have no MultiChain node.
> Your ZIP contained real Supabase keys and a JWT secret. Rotate them in Supabase and never share/commit `.env`.

**4. Start the backend (Terminal 1)**
```powershell
cd TexTracer\backend
npm install
npm run dev
```
It must print `Database: connected` and a line like `BACKEND_HOST "192.168.1.23"` – **write that IP down**. Check: open `http://localhost:5000/api/health` → `"database":"connected"`.

**5. Start the frontend (Terminal 2)**
```powershell
cd TexTracer\frontend
copy .env.example .env
npm install
npm run dev
```
Open `http://localhost:8080`.

**6. Create the reader keys (Terminal 3, once)**
```powershell
cd TexTracer
node hardware_integration\tools\provision_reader_keys.mjs
```
Enter `admin@texchain.local` / `ChangeMe!123`. It writes `hardware_integration\firmware\TexTracerRFID\reader_keys.h`. (Run again with `--force` only if you want new keys.)

**7. Configure + flash the ESP32**
Edit `hardware_integration\firmware\TexTracerRFID\config.h`: `WIFI_SSID`, `WIFI_PASSWORD` (2.4 GHz), `BACKEND_HOST` = IP from step 4, `BACKEND_PORT 5000`.
Arduino IDE: install board **esp32** (Boards Manager) and library **MFRC522** (Miguel Balboa). Open `TexTracerRFID.ino` → Board *ESP32 Dev Module* → Upload → Serial Monitor **115200**.
Expect: `9 of 9 RFID READERS ARE READY`, `[WIFI] Connected`, `GET /api/health -> HTTP 200, database=connected`.

**8. Windows Firewall (if the health check fails)** – PowerShell *as Administrator*:
```powershell
New-NetFirewallRule -DisplayName "TexTracer backend 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Any
```
Test from your phone on the same Wi-Fi: `http://<BACKEND_HOST>:5000/api/health`.

**9. Register a tag** – tap a new tag on any reader. Log in as `warehouse@texchain.local` / `ChangeMe!123` → *Raw Material Intake (Gate 1)* → *Register material*: the tag appears under "Tapped on a reader" – click it, pick PO-1001 (or create a PO), enter quantity → Register → *Review* → **Approve**.

**10. Scan through the process** – tap the tag on `RDR-RM1`, then `RDR-RM2`, `RDR-DESIGN`, `RDR-MFG1` (or MFG2), `RDR-PROD`. Serial Monitor shows `[DB] SAVED`. QC (`qc@…`) must approve Gate 2 before `RDR-STITCH`; Packaging officer must mark Gate 3 before `RDR-SHIP`.

**11. Watch it in the UI** – log in as `admin@`, `warehouse@`, `auditor@` or `management@` → **Live RFID Scans** (updates every 3 s). Admin → *RFID Readers* also shows each reader's last contact and why a request failed. Officers (`officer@`, `procurement@`, …) see their department's readers under *RFID Scan*.

## If something does not show up
| Where you look | Message | Fix |
|---|---|---|
| Backend start | `Database: UNREACHABLE` / placeholder warning | Fix `DATABASE_URL` (step 3) |
| ESP32 serial | `[WIFI] Status: SSID not found` | Wrong name or 5 GHz network |
| ESP32 serial | `GET /api/health -> FAILED (-1)` | Wrong `BACKEND_HOST`, firewall (step 8), different Wi-Fi |
| ESP32 serial / UI status | `401 wrong or missing device key` | Do step 6, re-flash |
| UI | `Rejected · unknown tag` | Register the tag (step 9) |
| UI | `Rejected · out of sequence` / `gate not approved` | Follow the process order / approve the gate |
| Nothing in UI status panel | Request never reached the backend | Network problem (step 7/8) |
| Reader "FAILED – no answer from chip" | Check 3.3 V, GND, SS wire; GPIO 12 can block boot – unplug its SS wire while flashing |
