# Blockchain layer (MultiChain)

Gate decisions (Gate 1, Gate 2, Gate 3) are anchored to a **MultiChain stream** so that anyone can later prove a
decision was not altered. Nothing in the existing workflow changed: the blockchain is an add-on that can be switched off.

## How it works

```
POST /api/approvals/:id/decisions
        |   (one database transaction)
        v
record_decision()  ->  inspections row  +  chain_anchors row (status 'pending', metadata + SHA-256 hash)
        |
        |   later, in the background (src/modules/blockchain/anchor.worker.ts)
        v
worker: claim 'pending' -> publish to MultiChain stream (key = product RFID UID) -> 'submitted' (+ tx_hash)
        -> after >= MULTICHAIN_MIN_CONFIRMATIONS block(s): confirm_anchor_job() -> 'confirmed' (+ block, confirmations)
```

* **A blockchain outage never blocks a decision.** The anchor is queued in the same DB transaction as the decision;
  the worker publishes it whenever the node is reachable. While the node is down the worker does not claim jobs, so no
  retry attempts are wasted. A failed publish is retried with exponential back-off (database function
  `fail_anchor_job`), and becomes `failed` only after `MULTICHAIN_MAX_ATTEMPTS`.
* **Tamper evidence.** What goes on-chain is the exact metadata text + its SHA-256 (`chain_anchors.metadata_hash`).
  The worker refuses to publish if the database row no longer matches its own hash.
* **The existing UI works unchanged.** The Blockchain and Tracking pages already read `chain_anchors`
  (`txHash`, `status`, `confirmations`); the worker simply fills those columns.

## What was added (and where)

| File | Purpose |
|---|---|
| `src/modules/blockchain/multichain.client.ts` | JSON-RPC client (Node built-in `fetch`, no new dependency) + `MultichainConfig` |
| `src/modules/blockchain/multichain.service.ts` | publish / read / compare / stream creation / status |
| `src/modules/blockchain/anchors.repo.ts` | SQL on the **existing** `chain_anchors` table (claim, confirm, fail, read) |
| `src/modules/blockchain/anchor.worker.ts` | the outbox worker |
| `src/modules/blockchain/blockchain.routes.ts` | `GET /api/blockchain/status`, `GET /api/blockchain/products/:id/verify` |
| `src/modules/blockchain/index.ts` | wiring helpers |
| `tests/blockchain.test.ts`, `tests/helpers/mockMultichain.ts` | 14 tests, no database or node required |
| `../database/06_multichain_chain.sql` | **data-only** migration (see below) |

Minimal hooks in existing files (all additive): `config/env.ts` (optional MULTICHAIN_* variables),
`routes/context.ts` (optional `blockchain`), `app.ts` (create service, `blockchain` field in `/api/health`),
`routes/index.ts` (mount `/blockchain`), `server.ts` (start/stop the worker),
`modules/products/products.routes.ts` (the `onChainVerification` text), and two text-only lines in the frontend
(`views/blockchain.tsx`, `views/tracking.tsx`).

## Setup

### 1. Run the SQL step once (Supabase SQL editor, or `psql "$DATABASE_URL" -f database/06_multichain_chain.sql`)
It changes **no tables or columns**. It adds `multichain` to the `chains` table, deactivates the unused `polygon_amoy` /
`sepolia` rows (nothing publishes to them), removes their never-published queue rows, and **backfills** an anchor for every
decision that already exists. Safe to run repeatedly.

### 2. Run a MultiChain node (once)
```bash
multichain-util create chain1            # edit ~/.multichain/chain1/params.dat first if you want default-rpc-port = 7758
multichaind chain1 -daemon               # first start prints the node address
cat ~/.multichain/chain1/multichain.conf # rpcuser / rpcpassword  -> MULTICHAIN_RPC_USER / MULTICHAIN_RPC_PASSWORD
cat ~/.multichain/chain1/params.dat | grep default-rpc-port   # -> MULTICHAIN_PORT
multichain-cli chain1 getinfo            # must answer
```
The node that runs the backend must be an **admin/creator** (or hold `send` permission) so it can publish.
The stream `gate_scans` is created automatically on first start (`MULTICHAIN_AUTO_CREATE_STREAM=true`); or create it by hand:
`multichain-cli chain1 create stream gate_scans true`.

### 3. Configure `backend/.env` and start
```bash
cd backend && npm install && npm run dev
```
Expected log lines:
```
Blockchain:    MultiChain 127.0.0.1:7758 chain "chain1" stream "gate_scans" (worker running)
[blockchain] stream "gate_scans" ready on chain "chain1"
[blockchain] anchor 12 (inspection 7) published: <txid>
[blockchain] anchor 12 confirmed (1 confirmation(s))
```
`GET /api/health` now includes `"blockchain": "connected" | "unreachable" | "disabled"`.

Without `MULTICHAIN_RPC_PASSWORD` (or with `MULTICHAIN_ENABLED=false`) the layer is off and the app behaves exactly as before.

## Endpoints

| Method + path | Who | Notes |
|---|---|---|
| GET `/api/blockchain/status` | auditor, senior_management, system_admin | node reachability, block height, stream, queue counts per status |
| GET `/api/blockchain/products/:id/verify` | same readers/visibility as `/products/:id` | re-reads every anchor **from the chain** and compares: `onChain` = `verified` \| `pending_confirmation` \| `mismatch` \| `not_found` \| `unavailable`; `allVerified` summary. 503 `BLOCKCHAIN_DISABLED` if the layer is off |

`GET /api/products/:id/verification` is unchanged except that `onChainVerification` is `"available"` when the layer is on.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Blockchain: DISABLED` at start | `MULTICHAIN_RPC_PASSWORD` empty or `MULTICHAIN_ENABLED=false` |
| `MultiChain node unreachable` | node not running, wrong `MULTICHAIN_HOST/PORT`, or RPC bound to another interface (`rpcallowip`) |
| `rejected the credentials` | `MULTICHAIN_RPC_USER/PASSWORD` differ from `multichain.conf` |
| `stream ... is not usable` | node lacks permission to create/write the stream, or `MULTICHAIN_STREAM_NAME` differs from the existing stream |
| anchors stay `pending`, nothing in the log | the `multichain` row is missing/inactive in `chains` -> run `06_multichain_chain.sql`; or the worker is off |
| anchor `failed` | see `chain_anchors.last_error`; after fixing the cause: `UPDATE chain_anchors SET status='pending', attempts=0, next_attempt_at=now() WHERE status='failed' AND chain_code='multichain';` |

## Known limits
* Delivery is **at-least-once**: if the backend crashes in the instant between publishing and saving the txid, that
  anchor is published again after 5 minutes (a harmless duplicate stream item; verification uses the saved txid).
* `confirmations` in the database is the value at confirmation time; `/blockchain/products/:id/verify` shows the live value.
* One MultiChain node/stream is trusted as the ledger; for stronger guarantees add more nodes to the chain.

## What happened to the standalone blockchain module

Its MultiChain logic was ported to TypeScript inside `src/modules/blockchain/`; the module itself is not shipped because it could not run
against this database as written.

| Standalone module | Decision |
|---|---|
| `config/multichain.js` (axios RPC wrapper) | ported -> `multichain.client.ts` (built-in `fetch`, no new dependency) |
| `multichain.services.js` (publish to stream, key = product UID, hex payload, SHA-256) | ported -> `multichain.service.ts`, same call shape (`publish <stream> <productUid> <hex>`) |
| `gateAnchor.services.js` + `blockchain..controller.js` (Express + `@supabase/supabase-js`) | replaced by the outbox worker + routes; this backend has no Express and talks to Postgres directly |
| table `blockchain_gate_anchors` / `blockchain_sync_state` | **not created**: the existing `chain_anchors` outbox already holds this data (adding tables would break "no schema changes") |
| `blockchainSyncWorker.js` (polls the chain and upserts) | replaced by the worker's confirm phase (reads confirmations of known txids) |
| root `server.js`, `auditController.js`, `inventory_audits` | **dropped**: an older prototype flow for a table that does not exist in this database; its `services/blockchain.js` is an empty file |
| `require('./multichain.service')` vs file `multichain.services.js` | the original would crash on start (name mismatch) |
