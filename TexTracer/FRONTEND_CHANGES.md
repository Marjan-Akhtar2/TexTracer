# TexTracer frontend refactor — change notes

Only files under `frontend/src` changed. `backend/` and `database/` are untouched (verified by diffing against the supplied ZIP).
No dependency was added or removed (`package.json` unchanged).

## Run
```powershell
cd frontend
npm install
npm run dev      # http://localhost:8080 (backend as before on :5000)
```
Run `npm run build` once to confirm the production build on your machine.

## Navigation: duplicates removed
| Role | Removed | Why |
|---|---|---|
| Senior Management | Analytics | Rendered the same component as Overview. |
| Senior Management | Production Flow | The stage-flow panel is already part of the Management Dashboard. |
| Department Officer | Production Flow | Same stage counts and product journey as Overview and Product Tracking. |
Menus are grouped (Workspace / Operations / Traceability / Administration). The removed views are no longer reachable from any menu; no page code that other screens use was deleted.
Added: Warehouse Manager "RFID Scan".

## Testing issues
| Issue | Status |
|---|---|
| A1 No System Administrator in create-user role list | Done (also hidden in the per-row role dropdown for non-admin accounts) |
| A2 Department enabled/required only for Department Officer; disabled style; payload unchanged | Done (department sent as null for other roles) |
| B1 New PO separate from picking an existing PO; PO list kept | Done (own dialog + Purchase orders table; Register dialog only selects existing POs) |
| B2 Already-assigned UID blocked; tag linked to an item | Done (checks `GET /products/by-uid/:uid` and blocks an already-assigned tag; no extra required fields) |
| B3 Scanner detection | Partly — see limitations |
| B4 Custom rejection reason | UI done; needs one DB row — see limitations |
| B5 Reason shown without internal code (the "(QTY_MISMATCH)" suffix) | Done in Gate 1, Product Tracking, Audit, Rework |
| B6 Database-connectivity text under Rejected at Gate 1 | Removed (also "Live · connected to API" and "Loading from the TexTracer API") |
| B7 Rejected item shows a rejection record, not tracking | Done: reason, timestamp, rejected by, blockchain record, decision history; Overview no longer draws a journey for a rejected item |
| C1 RFID scan page for Warehouse Manager | Done with the shared `RfidField` component — see limitations |

## Limitations that need a backend or database decision (nothing was changed)
1. **Direct ESP32 detection in the browser is not possible.** Readers post to `POST /scans/device` with a device key; the API has no endpoint that pushes or exposes "last UID seen" to a browser. The new `RfidField` focuses itself and recognises a keyboard-style reader typing a UID burst + Enter, and labels input as "Tag detected by scanner" or "Entered manually". It never generates a UID. For Department Officers the recent-scans list refreshes every 10 s so device scans appear. A true live feed for the Warehouse Manager would need a backend endpoint.
2. **Warehouse Manager cannot post scans.** `POST /scans` and `GET /scans` are Department Officer / audit roles only, and Gate 1 has no reader in the seed data. The Warehouse "RFID Scan" screen therefore looks a tag up (`GET /products/by-uid`) and routes unregistered tags to registration.
3. **Custom rejection reason** needs a generic reason code because the database function rejects unknown codes. Run `docs/optional_reason_code_other.sql` once; the free text is stored in the decision notes and displayed as the reason. Until then the UI shows a clear message instead of failing silently.
4. The SRS file was not in the ZIP; role responsibilities were taken from your brief and the backend role definitions.

## Verification performed
- All source files parse (esbuild) and the app bundles with every local import resolving.
- NOT done: `npm install`, `vite build`, type-check, and browser/role testing — the package registry was unreachable from my environment. Please run `npm install && npm run build` and click through each role; I did not test against the live API.
