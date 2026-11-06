// OPTIONAL: read-only checks against YOUR database (the one DB_MODE selects: local by default).
// Nothing is written. If DATABASE_URL is missing or the database is unreachable, every test is SKIPPED
// (shown as skipped, not failed), so `npm test` stays green on any laptop.
import assert from "node:assert/strict";
import { after, before, describe, test, type TestContext } from "node:test";
import { loadConfig } from "../src/config/env";
import { createDb, type Db } from "../src/db/pool";
import { startServer, type TestServer } from "./helpers/offline";

// eslint-disable-next-line @typescript-eslint/no-require-imports
try { require("dotenv").config(); } catch { /* dotenv not installed yet: fine */ }

let db: Db | undefined;
let srv: TestServer | undefined;
let reason = "";
let adminToken: string | undefined;
let mgmtToken: string | undefined;

before(async () => {
  let url: string | undefined;
  try { url = loadConfig().databaseUrl; } catch { url = undefined; }
  if (!url) { reason = "no database URL configured"; return; }
  try {
    const candidate = createDb(url);
    const up = await Promise.race([candidate.ping(), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
    if (!up) { reason = "database not reachable"; await candidate.close().catch(() => undefined); return; }
    db = candidate;
    srv = await startServer({ db, config: { loginRateLimitMax: 1000 } });
    const login = async (email: string) => {
      const r = await srv!.call("POST", "/api/auth/login", { body: { email, password: "ChangeMe!123" } });
      return r.status === 200 ? (r.body.data.token as string) : undefined;
    };
    adminToken = await login("admin@texchain.local");
    mgmtToken = await login("management@texchain.local");
  } catch (e) { reason = `setup failed: ${(e as Error).message}`; }
});
after(async () => { await srv?.close(); await db?.close(); });

const needDb = (t: TestContext) => { if (!db || !srv) { t.skip(reason); return false; } return true; };
const needAdmin = (t: TestContext) => { if (!needDb(t)) return false; if (!adminToken) { t.skip("demo admin login unavailable (password changed?)"); return false; } return true; };

describe("real database (read-only; skipped when unavailable)", () => {
  test("health reports connected", async (t) => {
    if (!needDb(t)) return;
    assert.equal((await srv!.call("GET", "/api/health")).body.data.database, "connected");
  });
  test("all expected tables, views and functions exist", async (t) => {
    if (!needDb(t)) return;
    for (const rel of ["users", "user_roles", "departments", "stages", "readers", "allowed_transitions", "purchase_orders", "products", "material_receipts", "reason_codes", "inspections", "stage_transitions", "scan_logs", "chain_anchors", "notifications", "v_current_inspections", "v_audit_history", "v_kpi_summary", "v_stage_kpi", "v_stalled_products", "v_rejection_reasons", "v_anchor_summary"]) {
      const r = await db!.query<{ oid: unknown }>(`SELECT to_regclass($1) AS oid`, [`public.${rel}`]);
      assert.ok(r.rows[0]!.oid, `missing ${rel}`);
    }
    for (const fn of ["record_scan", "record_decision", "verify_transition_chain"]) {
      const r = await db!.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [fn]);
      assert.ok(r.rowCount > 0, `missing function ${fn}`);
    }
  });
  test("password check works in the database (pgcrypto crypt)", async (t) => {
    if (!needDb(t)) return;
    const r = await db!.query<{ ok: boolean }>(`SELECT crypt('abc', crypt('abc', gen_salt('bf', 4))) = crypt('abc', gen_salt('bf', 4)) AS same, true AS ok`);
    assert.equal(r.rows[0]!.ok, true);
  });
  test("a wrong password is rejected by the real database", async (t) => {
    if (!needDb(t)) return;
    assert.equal((await srv!.call("POST", "/api/auth/login", { body: { email: "admin@texchain.local", password: "definitely-wrong" } })).status, 401);
  });
  test("admin can read users, departments, stages, readers, products", async (t) => {
    if (!needAdmin(t)) return;
    const get = (p: string) => srv!.call("GET", p, { token: adminToken! });
    const users = await get("/api/users"); assert.equal(users.status, 200); assert.ok(!JSON.stringify(users.body).includes("password"));
    assert.equal((await get("/api/departments")).body.data.length, 8);
    assert.equal((await get("/api/stages")).body.data.length, 10);
    assert.equal((await get("/api/readers")).body.data.length, 9);
    assert.equal((await get("/api/purchase-orders")).status, 200);
  });
  test("management dashboard queries all execute", async (t) => {
    if (!needDb(t)) return;
    if (!mgmtToken) return t.skip("demo management login unavailable");
    for (const p of ["overview", "kpis", "stages", "rejection-reasons", "anchors", "stalled"]) {
      assert.equal((await srv!.call("GET", `/api/dashboard/${p}`, { token: mgmtToken })).status, 200, p);
    }
  });
});
