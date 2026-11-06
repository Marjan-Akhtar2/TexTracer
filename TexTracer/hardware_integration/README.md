# TexTracer – ESP32 RFID hardware integration

Everything for the hardware lives in this folder. **No existing TexTracer file was modified** (backend, frontend,
database, blockchain, `.env`, packages – all byte-identical to the ZIP you sent; verified by SHA-256, see §9).

```
ESP32 + 9 × MFRC522  ──Wi-Fi/HTTP──►  existing backend  ──►  existing database  ◄──  existing frontend
  (this folder)       POST /api/scans/device   record_scan()      scan_logs,           GET /api/scans
                      X-Reader-Key             (SQL function)     products             (polls every 10 s)
```

## 1. Architecture and data flow

1. A tag enters a reader's field. The sketch reads the UID (uppercase hex, e.g. `A1B2C3D4`).
2. The scan goes into a small RAM queue and is sent immediately to
   `POST http://<laptop-ip>:5000/api/scans/device` with header `X-Reader-Key: <that reader's key>` and body
   `{"rfidUid":"A1B2C3D4","readerCode":"RDR-PROD","deviceTimestamp":"2026-11-05T09:40:00Z"}`.
   This endpoint **already exists** in `backend/src/modules/scans/scans.routes.ts`; nothing was invented.
3. The backend authenticates the reader key (SHA-256 compare against `readers.api_key_hash`) and calls the database
   function `record_scan()`, which in one transaction validates the tag, reader, sequence and gates, **always writes a
   `scan_logs` row**, and – only for a valid forward move – inserts a `stage_transitions` row and updates `products`.
4. The backend answers 201 / 200 / 404 / 422 / 401 / 400 / 429 / 5xx. The sketch turns that into four separate,
   honest statuses on the serial monitor (§5).
5. The frontend already polls `GET /api/scans` (Scan page, "Recent scans", every 10 s) and shows product stage/history, so
   saved scans appear there with **no frontend change**.

If the backend or Wi-Fi is down the scan stays in the queue (30 scans, backoff 2 s → 30 s, order preserved, original
scan time sent as `deviceTimestamp`) and is delivered when the link returns.

## 2. Compatibility issues found (original sketch vs. existing backend) – all fixed on the hardware side

| # | Issue | Resolution |
|---|---|---|
| 1 | Original sketch only printed to Serial: no Wi-Fi, no HTTP. Nothing could reach the backend. | Added Wi-Fi, NTP time, HTTP client. |
| 2 | Backend identifies readers by **`readerCode`** (`RDR-RM1` … `RDR-SHIP`); sketch only knew numbers 1–10. | `reader_keys.h` maps physical reader #1–9 → reader code. |
| 3 | Sketch printed "Department ID = reader number". Real department IDs differ (RM1 and RM2 are both Procurement = 1, MFG1/2 both Manufacturing = 3, …). | Department ID/name now come from the live database (written by the provisioning script). |
| 4 | Sketch drives **10** readers; the database has **9** (intake is an approval gate with no hardware). A 10th reader would only ever be answered `rejected_unknown_reader`. | Firmware uses the first 9 chip-select pins; the 10th pin (GPIO 22) is left unused. |
| 5 | Backend requires a per-reader secret header `X-Reader-Key`; sketch had none. | Keys issued through the existing admin endpoint `PUT /api/readers/:id/key` by `tools/provision_reader_keys.mjs`. |
| 6 | UID rule is `^[0-9A-F]{8,20}$`. Sketch's formatting already matched, but unusable tags (e.g. 3 bytes) were not filtered. | UID validated before sending; unusable tags are reported and not sent. |
| 7 | `deviceTimestamp` must be ISO-8601 with offset; ESP32 has no clock. | NTP over Wi-Fi; if unsynced the field is omitted (optional in the backend). |
| 8 | `localhost` on the ESP32 means the ESP32 itself. Backend serves plain HTTP only. | `config.h` takes the laptop's LAN IP; plain HTTP is used. |
| 9 | Sketch printed "ALL READERS READY" without checking chips. | Reads each chip's `VersionReg`; reports per-reader OK/FAILED, retries failed chips every 30 s. |
| 10 | "Scan Successful" was printed for any read. | Replaced by DETECTED / TRANSMITTED / ACCEPTED / DB SAVED statuses. |

Backend business rules you will see in practice (not bugs): the tag must already be registered (Warehouse Manager,
Gate 1 approved) or the scan is logged as `rejected_unknown_tag`; stage order and gates are enforced (`MFG1` and `MFG2`
are alternative branches, not a chain; stitching needs Gate 2 QC approval; shipping needs Gate 3); a repeat at the same
stage is `duplicate`.

## 3. Files created (all new, nothing overwritten)

| File | Purpose |
|---|---|
| `firmware/TexTracerRFID/TexTracerRFID.ino` | Complete updated sketch (your Facade + Singleton structure kept). |
| `firmware/TexTracerRFID/config.h` | **You edit:** Wi-Fi name/password, laptop IP, port, tuning. |
| `firmware/TexTracerRFID/reader_keys.h` | Reader table + device keys. Ships as a placeholder; overwritten by the provisioning script. **Contains secrets once generated – do not commit/share.** |
| `tools/provision_reader_keys.mjs` | Logs in as System Administrator, reads readers + departments from the backend, issues one key per reader via the existing API, writes `reader_keys.h`. Node built-ins only. |
| `tools/verify_scans.mjs` | Read-only: prints the scan log from `GET /api/scans` (same data the frontend shows). `--watch` for live. |
| `test/host/`, `test/shims/`, `test/local_env/` | How I verified (§7): PC build of the real sketch with hardware stubs, scripted scenarios, a stand-in DB driver, throwaway-DB scripts. Reference only. |
| `.gitignore` | Ignores the throwaway test keys. |

## 4. Changes made to your hardware code

- Added `#include`s for WiFi, HTTPClient, time; added `config.h` / `reader_keys.h`.
- `readers` is now derived from the reader table (9) instead of the constant 10; pin list is unchanged.
- Reader init now verifies each chip (VersionReg), reports failures, periodically health-checks and re-initialises.
- `getUID()` unchanged. Added UID validation, 2 s same-tag repeat filter (hand jitter), per-reader scan counter kept.
- Replaced `printReaderInfo()` with the scan block + `[TX]/[BACKEND]/[DB]` lines; added Wi-Fi/NTP/health check at boot.
- Added retry queue, response interpretation, reconnect logic. No artificial two-scan limit (as before).
- The chip is `PICC_HaltA()`-ed after a read, so a resting tag is read once; re-present it for another scan.

## 5. What the serial monitor shows

```
========== RFID SCAN DETECTED ==========          <- 1. tag read
Reader Number : 6 of 9
Reader Code   : RDR-PROD
Department ID : 4 (Production)
Tag UID       : A1B2C3D4
Scan Time     : 2026-11-05T09:43:30Z (UTC, device clock)
----------------------------------------
[TX]      Sending RDR-PROD / A1B2C3D4 (attempt 1)
[TX]      TRANSMITTED - HTTP 201                  <- 2. got an HTTP answer
[BACKEND] ACCEPTED - result=accepted  manufacturing_1 -> production   <- 3. backend processed it
[DB]      SAVED - scan logged in scan_logs AND product moved to the new stage.   <- 4. DB confirmed
```
`[DB] SAVED` is printed **only** for HTTP 201/200 with `"success":true` and the matching `result`. Other cases:
`Attempt LOGGED … Product NOT moved` (business-rule rejection – the row *is* saved, with its result), `NOT SAVED`
(no answer, 401, 400, 429), `NOT CONFIRMED` (5xx, e.g. database down – retried).

## 6. Exact steps to run the complete system

**A. Backend + database** (unchanged project, Node 22):
```powershell
cd TexTracer\backend
npm install
npm run dev            # http://localhost:5000  - check /api/health shows "database": "connected"
```
Allow inbound TCP 5000 in Windows Firewall (first start usually prompts for Node.js). Check from a phone on the same
Wi-Fi: `http://<laptop-ip>:5000/api/health`.

**B. Issue reader keys** (once; changes only `readers.api_key_hash`, exactly what the Admin page's "provision key" button does):
```powershell
cd TexTracer
node hardware_integration\tools\provision_reader_keys.mjs
#   asks for System Administrator email/password (seed: admin@texchain.local / ChangeMe!123 – change it!)
```
It refuses to run again once real keys exist (re-keying invalidates the old key).

**C. Configure and flash**
1. Edit `hardware_integration/firmware/TexTracerRFID/config.h` (Wi-Fi 2.4 GHz, laptop LAN IP).
2. Arduino IDE → install **esp32** board package and library **MFRC522** (Miguel Balboa). Open
   `TexTracerRFID.ino`, board *ESP32 Dev Module*, upload, Serial Monitor **115200** baud.

**D. Prepare tags** (frontend, as Warehouse Manager): create/choose a Purchase Order, register the tag UID, approve Gate 1.

**E. Scan and watch**
- Serial monitor: scan blocks as in §5.
- Frontend: `cd frontend; npm install; npm run dev`, log in as a Department Officer → **Scan → Recent scans**
  (refreshes every 10 s; an officer sees only readers of their own department – the backend's rule). Tracking/product
  history shows the stage change.
- Terminal: `node hardware_integration\tools\verify_scans.mjs --watch` (auditor@texchain.local sees all readers).

## 7. Testing performed – and what was NOT tested

**Method.** I compiled the *real* sketch on a PC (`g++ -Wall -Wextra`, no warnings) against stubs for only the ESP32
hardware (MFRC522, Wi-Fi, SPI, Arduino core). Its HTTP calls were **real HTTP** to your **real backend source**
(`backend/src/server.ts` run unmodified) on a **real PostgreSQL 16 loaded with your own `database/01…06.sql`**.
Test tags/POs were created through your real API. This is a throwaway local DB – not your Supabase.
(The sandbox could not `npm install`, so the backend's `pg` driver was replaced by a tiny test-only shim that forwards
queries to `psql`; all SQL, including `record_scan()`, ran unchanged. The shim has no real transactions.)

| Stage | Result |
|---|---|
| Provisioning of 9 reader keys through the real admin API; second run refuses to overwrite | ✅ |
| Initialization of 9 readers, per-chip status; chip failure detected and recovered | ✅ (simulated chip) |
| Detection on each of the 9 reader codes, 4-byte and 7-byte UIDs, correct UID text | ✅ (simulated tags) |
| Reader code + department ID/name correct (e.g. RDR-PROD → 4 Production) | ✅ |
| Backend communication, HTTP 201 accepted → row in `scan_logs` + product moved | ✅ (scan_logs ids 1–4, 6, 9, 12–14 …) |
| Duplicate (200), out-of-sequence, gate-not-approved, unknown tag (404), product-blocked (422) – each logged in `scan_logs`, serial says "Product NOT moved" | ✅ |
| Full lifecycle RM1→RM2→Design→MFG1→Production→(QC gate)→Stitching→Packaging→(Gate 3)→Shipping; product ends `shipped` | ✅ |
| Multiple consecutive scans, no two-scan limit; same-tag repeat within 2 s ignored | ✅ |
| Backend down → queued, retried (2/4/8 s), delivered later with **original** `device_ts` (14:44:57 vs delivered 14:45:11) | ✅ |
| Database down (backend returns 500) → "NOT CONFIRMED", retried, saved when DB returned | ✅ |
| Wi-Fi drop → queued in order, delivered after reconnect | ✅ |
| Wrong device key → 401, "NOT SAVED", not retried | ✅ |
| Rate limit 429 → "NOT SAVED yet", waits `Retry-After`, then saved in order | ✅ |
| Saved records visible through the frontend's own endpoint `GET /api/scans` (officer: own department; auditor: all) | ✅ via API |

**Not verified (cannot be from here) – please test on your bench:**
- Real SPI/RFID reads, wiring, 9 readers on one ESP32, and ESP32 `WiFi`/`HTTPClient`/NTP behaviour (code-level only).
- The frontend UI itself was not launched; I verified the data it reads (`GET /api/scans`, the same call as `scan.tsx`).
- Your Supabase database and MultiChain (scans don't touch the chain; it was disabled in the test).

**Manual hardware test procedure**
1. Serial monitor must say `9 of 9 RFID READERS ARE READY`, Wi-Fi connected, `GET /api/health -> HTTP 200, database=connected`.
   A reader that reports FAILED: check 3.3 V, GND, SS wire (pin table in the `.ino`), shared RST on GPIO 26.
2. Register a test tag and approve Gate 1 (step D). Tap it on reader 1 (`RDR-RM1`): expect `[DB] SAVED … intake -> raw_material_1`
   and the row in the frontend within 10 s.
3. Tap the same tag again after >2 s: expect `duplicate`. Tap an unregistered tag: expect `rejected_unknown_tag`.
4. Walk the tag through the readers in the backend's order; test each reader number once and confirm the printed Reader Code.
5. Switch the laptop Wi-Fi/backend off, scan, switch on: expect queued → delivered with original time.
6. Unplug one reader's wire: expect `stopped answering`, then `back online` after re-plugging.

> ⚠ `scan_logs` is append-only (database triggers) – test scans cannot be deleted. Use test tags, and do not run the
> `test/` simulator against your production database.

## 8. Hardware notes (observed, not changed)

- GPIO 12, 2 and 15 are ESP32 **strapping pins**. If an RC522 module pulls GPIO 12 high at power-up the ESP32 may fail to
  boot (bootloop); disconnect that SS wire while flashing/resetting if so. I kept your wiring as you gave it.
- Nine RC522 modules can exceed what the dev board's 3.3 V regulator supplies reliably; use a solid external 3.3 V supply
  (common ground) if readers drop out (the firmware will report and recover them).
- Plain HTTP on the LAN only (the backend has no TLS). Device keys are secrets: don't commit `reader_keys.h`.

## 9. Existing files unchanged

Before adding anything I took SHA-256 of all 173 files in the ZIP; after all work every one still matches (0 differences).
Only the new `hardware_integration/` folder was added. The only change made to the (local test) database was the
standard `PUT /api/readers/:id/key` provisioning – and in **your** database that happens only when you run step B.
