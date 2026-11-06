# Database usage and gaps

The backend uses ONLY the tables, views and functions from `database/01_schemas.sql` ... `05_seed.sql`. No table or column was added or changed.

## Tables / views / functions used by each module
| Module | Uses |
|---|---|
| auth, users, roles | `users` (password_hash checked with pgcrypto `crypt`), `user_roles`, `roles`, `departments` |
| departments, stages, readers | `departments`, `stages`, `readers`, `allowed_transitions` |
| purchase-orders | `purchase_orders` |
| products | `products`, `material_receipts`, `purchase_orders`, `stages`, `stage_transitions`, `inspections`, `v_current_inspections`, `v_stalled_products`, `chain_anchors`, `scan_logs`, function `verify_transition_chain()` |
| scans | `readers`, `scan_logs`, function `record_scan()` (does sequence + gate validation, locking and the state change in one transaction) |
| approvals | `inspections`, `reason_codes`, `chain_anchors`, function `record_decision()` (role check, rework loop, supersede link, anchor queue, notifications) |
| rework | `products`, `inspections`, `stage_transitions`, `notifications` |
| notifications | `notifications` |
| audit | `v_audit_history`, `stage_transitions`, `readers`, `users` |
| dashboard | `v_kpi_summary`, `v_stage_kpi`, `v_rejection_reasons`, `v_anchor_summary`, `v_stalled_products`, `products`, `stages` |

## Genuine gaps in the supplied database (nothing was silently invented)
1. **No "rework completed" field.** The schema has `products.status='rework'` but nothing records that Production finished the rework. The backend records it as a `notifications` row (`type='rework_completed'`, addressed to QC) and requires it before QC may decide again. A dedicated column or table would be cleaner.
2. **No rework assignee.** There is no column for a responsible person. Rework is assigned to the Production department (the database already notifies Production officers on Gate 2 rejection).
3. **No general audit log.** Audit evidence = `stage_transitions`, `inspections`, `scan_logs` (all append-only). Account actions (create user, change role) are not recorded because no table exists for them.
4. **Blockchain.** `record_decision()` queues one `chain_anchors` row per active chain (status `pending`). The MultiChain worker in `src/modules/blockchain/` publishes them and moves them to `submitted` / `confirmed` (see `docs/BLOCKCHAIN.md`). `metadataHashValid` checks the stored hash; `GET /api/blockchain/products/:id/verify` checks the chain itself. The `ipfs_cid` column stays empty for MultiChain.
5. **Gate 3 owner.** The database lets any `department_officer` record Gate 3. The API narrows this to the Packaging department.
6. **Gate 1 rejection is terminal** for that tag (database rule); replacement material needs a new tag.
7. **Live updates.** The database emits `pg_notify` events, but this backend exposes polling endpoints (`/notifications`, `/dashboard/*`) rather than a push channel.
8. **Reader device keys.** `readers.api_key_hash` has no defined format. This backend stores the SHA-256 (hex) of a random key created via `PUT /readers/:id/key`.
9. **Passwords** in the seed (`ChangeMe!123`) are demo values: change them before real use.
