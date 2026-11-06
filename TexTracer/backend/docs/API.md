# TexTracer API

Base URL (local): `http://localhost:5000/api`. All bodies are JSON. Authenticated calls send `Authorization: Bearer <token>`.

## Response format
```json
{ "success": true,  "data": <result>, "meta": { "page": 1, "limit": 25, "total": 3, "pages": 1 } }
{ "success": false, "error": { "code": "FORBIDDEN", "message": "...", "details": [ { "field": "email", "message": "..." } ] } }
```
Status codes: 200 ok · 201 created · 400 validation (`VALIDATION_ERROR`, `BAD_JSON`) · 401 not logged in / bad token / bad device key · 403 wrong role or department · 404 not found (or unknown RFID tag/reader) · 409 duplicate / already done · 413 body too large · 422 workflow rule broken (`SCAN_REJECTED`, `GATE_NOT_AVAILABLE`, `REWORK_NOT_COMPLETED`, `WORKFLOW_RULE`, `DEPARTMENT_REQUIRED`...) · 429 rate limited · 500 server error (no internals leaked).
Lists accept `?page=1&limit=25` (limit max 100). JSON keys are camelCase. Stage/gate/status values are the database codes (`raw_material_1`, `gate2_qc`, `ready_for_shipment`, ...).

## Roles (`user.role` = code, `user.roleLabel` = SRS name)
`system_admin` System Administrator · `department_officer` Department Officer · `warehouse_manager` Warehouse Manager · `qc_officer` QC Officer · `auditor` Auditor · `senior_management` Senior Management.
Auditor and Senior Management can only call GET endpoints. System Administrator manages accounts/roles and reader keys only.

## Endpoints
| Method + path | Who | Notes |
|---|---|---|
| GET `/health` | public | `{status, database: connected\|unreachable\|not_configured, blockchain: connected\|unreachable\|disabled}` |
| POST `/auth/login` | public (rate limited) | `{email,password}` -> `{token, tokenType, expiresInSeconds, user}` |
| GET `/auth/me` · POST `/auth/logout` | any logged-in | logout is client-side (discard the token) |
| GET/POST `/users` · GET/PATCH `/users/:id` · PUT `/users/:id/role` | system_admin | create `{email,fullName,password,role,departmentId?}`; officers need `departmentId`; cannot deactivate/demote yourself |
| GET `/roles` | system_admin | roles + permissions |
| GET `/departments` · `/departments/:id` | any | read-only reference data |
| GET `/stages` · GET `/readers` | any | stages with SLA, readers, allowed next stages |
| PUT `/readers/:id/key` | system_admin | creates a device key for an ESP32 reader; returned once, only its SHA-256 is stored |
| GET `/purchase-orders` · `/:id` | any | |
| POST `/purchase-orders` | warehouse_manager | `{poNumber,supplierName,materialDescription,quantity}` |
| POST `/products` | warehouse_manager | register received material + RFID tag: `{rfidUid,poId,receivedQty,batchCode?,description?,notes?}` |
| GET `/products?status&stage&search&awaitingGate&stalled&poId` | officer*, warehouse, qc, auditor, management | *officers see items currently in their department |
| GET `/products/:id` · `/products/by-uid/:uid` | same | details, PO, receipt, current decisions, next stages, stalled flag |
| GET `/products/:id/history` | same | transitions + decisions + scans, `timeline` oldest first |
| GET `/products/:id/verification` | same | hash-chain check + anchor status (FR-17) |
| POST `/scans` | department_officer | `{rfidUid,readerCode}`; reader must belong to the officer's own department |
| POST `/scans/device` | ESP32 (header `X-Reader-Key`) | `{rfidUid,readerCode,deviceTimestamp?}` |
| GET `/scans?result&uid&productId&readerCode` | officer (own dept), auditor, management | scan log |
| GET `/approvals/pending?gate` | warehouse (gate 1), qc (gate 2), Packaging officer (gate 3), auditor, management (all) | items waiting for a decision |
| GET `/approvals/reason-codes?gate` | any | |
| POST `/approvals/:productId/decisions` | warehouse (gate1), qc (gate2), Packaging officer (gate3) | `{gate,decision,reasonCode?,notes?}`; reject needs `reasonCode`; gate3 uses `ready_for_shipment` |
| GET `/approvals/:productId/decisions` | same readers as products | full history; `isCurrent=false` rows were superseded, never edited |
| GET `/rework` · `/rework/:productId` | Production officer, qc, auditor, management | open rework cases / full rework history |
| POST `/rework/:productId/complete` | Production officer | `{notes?}`; QC may then decide again |
| GET `/notifications?unread=true` · POST `/notifications/:id/read` | any | in-app notifications (poll this) |
| GET `/audit/decisions` · `/audit/transitions` | auditor | filters: gate, decision, productId, uid, reasonCode, kind, from, to |
| GET `/dashboard/overview · kpis · stages · rejection-reasons · anchors · stalled` | senior_management | read-only |
| GET `/blockchain/status` | auditor, senior_management, system_admin | MultiChain node + queue status (see `docs/BLOCKCHAIN.md`) |
| GET `/blockchain/products/:id/verify` | same as `/products/:id` | live on-chain check of every anchor of a product |

## Scan result handling
`POST /scans` and `/scans/device` return 201 `accepted`, 200 `duplicate` (already at that stage), 404 for unknown tag/reader, 422 `SCAN_REJECTED` (`error.details.result` = `rejected_out_of_sequence`, `rejected_gate_not_approved` or `rejected_product_blocked`). Every attempt is logged in `scan_logs`; rejected scans never move the product.

## Workflow (what the server enforces)
1. Warehouse registers a product (stage `intake`). 2. Gate 1: warehouse approves (scans may start) or rejects with a reason (product `rejected`, Procurement notified, terminal). 3. Officers scan through RM1, RM2, Design, Manufacturing 1/2, Production in order, each in their own department. 4. Gate 2 (QC) at Production: approve, or reject -> status `rework`. 5. Production officer completes rework; QC decides again (the new decision links to the old one). 6. Stitching, Packaging scans. 7. Gate 3: Packaging officer marks ready for shipment. 8. Shipping scan -> `shipped`.
