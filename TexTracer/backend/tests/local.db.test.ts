// LOCAL database test: proves an RFID scan sent to the real HTTP endpoint (the one the ESP32 uses) is saved in the
// local PostgreSQL database and can be read back, and that it is still there after the backend "restarts"
// (new connection pool). Uses a SEPARATE throw-away database (name must end in "_test") because it creates a
// purchase order, a product and rotates the key of reader RDR-RM1. Your real local data is never touched.
//
//   one-time:  node ../database/local/init-local-db.mjs --db textracer_test
//   run:       npm run test:local        (also part of `npm test`; SKIPPED, not failed, if the test database is missing)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test, type TestContext } from "node:test";
import { DEFAULT_LOCAL_DATABASE_URL } from "../src/config/env";
import { createDb, describeDbTarget, type Db } from "../src/db/pool";
import { startServer, type TestServer } from "./helpers/offline";

// eslint-disable-next-line @typescript-eslint/no-require-imports
try { require("dotenv").config(); } catch { /* dotenv not installed yet: fine */ }

const url = process.env.LOCAL_TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL.replace(/\/textracer$/, "/textracer_test");
let db: Db | undefined;
let srv: TestServer | undefined;
let reason = "";
const uid = randomBytes(5).toString("hex").toUpperCase() + "A1"; // unique per run: 12 hex chars
let readerKey = "";
let productId = "";

const skip = (t: TestContext) => { if (!db || !srv) { t.skip(reason); return true; } return false; };
const login = async (email: string) => {
  const r = await srv!.call("POST", "/api/auth/login", { body: { email, password: "ChangeMe!123" } });
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`);
  return r.body.data.token as string;
};

before(async () => {
  if (!/\/[A-Za-z0-9_]*_test(\?|$)/.test(url)) { reason = `refusing to run: ${describeDbTarget(url)} is not a *_test database`; return; }
  try {
    const candidate = createDb(url);
    const diag = await candidate.diagnose!();
    if (!diag.ok) { reason = `local test database not reachable [${diag.code}] ${diag.hint}`; await candidate.close().catch(() => undefined); return; }
    const hasSchema = await candidate.query(`SELECT to_regclass('public.scan_logs') IS NOT NULL AS ok`);
    if (!(hasSchema.rows[0] as { ok: boolean }).ok) { reason = "test database has no schema: run  node ../database/local/init-local-db.mjs --db textracer_test"; await candidate.close(); return; }
    db = candidate;
    srv = await startServer({ db, config: { loginRateLimitMax: 1000, dbMode: "local", databaseUrl: url } });
  } catch (e) { reason = `setup failed: ${(e as Error).message}`; }
});
after(async () => { await srv?.close(); await db?.close(); });

describe("local PostgreSQL: scans are saved and read back", () => {
  test("health shows a connected LOCAL database", async (t) => {
    if (skip(t)) return;
    const r = await srv!.call("GET", "/api/health");
    assert.equal(r.body.data.database, "connected");
    assert.equal(r.body.data.databaseMode, "local");
  });

  test("set up: provision reader key, register a tag, approve Gate 1", async (t) => {
    if (skip(t)) return;
    const admin = await login("admin@texchain.local");
    const readers = (await srv!.call("GET", "/api/readers", { token: admin })).body.data as Array<{ id: number; code: string }>;
    const rm1 = readers.find((r) => r.code === "RDR-RM1");
    assert.ok(rm1, "reader RDR-RM1 missing from seed data");
    const key = await srv!.call("PUT", `/api/readers/${rm1.id}/key`, { token: admin });
    assert.equal(key.status, 200);
    readerKey = key.body.data.deviceKey as string;
    assert.ok(readerKey, `no key in response: ${JSON.stringify(Object.keys(key.body.data))}`);

    const wh = await login("warehouse@texchain.local");
    const po = await srv!.call("POST", "/api/purchase-orders", { token: wh, body: { poNumber: `LT-${uid}`, supplierName: "Local Test Supplier", materialDescription: "local db test", quantity: 10 } });
    assert.equal(po.status, 201, JSON.stringify(po.body));
    const prod = await srv!.call("POST", "/api/products", { token: wh, body: { rfidUid: uid, poId: po.body.data.id, receivedQty: 5 } });
    assert.equal(prod.status, 201, JSON.stringify(prod.body));
    productId = prod.body.data.id;
    const gate = await srv!.call("POST", `/api/approvals/${productId}/decisions`, { token: wh, body: { gate: "gate1_intake", decision: "approved" } });
    assert.ok(gate.status === 200 || gate.status === 201, JSON.stringify(gate.body));
  });

  test("ESP32-style POST /api/scans/device is accepted and saved", async (t) => {
    if (skip(t)) return;
    const r = await srv!.call("POST", "/api/scans/device", { headers: { "x-reader-key": readerKey }, body: { rfidUid: uid, readerCode: "RDR-RM1" } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.result, "accepted");
    assert.equal(r.body.data.toStage, "raw_material_1");
    const row = await db!.query<{ result: string; reader_code: string }>(`SELECT result::text AS result, reader_code FROM scan_logs WHERE rfid_uid = $1 ORDER BY id DESC LIMIT 1`, [uid]);
    assert.equal(row.rows[0]?.result, "accepted");
    assert.equal(row.rows[0]?.reader_code, "RDR-RM1");
  });

  test("repeat tap is a harmless duplicate and is logged too", async (t) => {
    if (skip(t)) return;
    const r = await srv!.call("POST", "/api/scans/device", { headers: { "x-reader-key": readerKey }, body: { rfidUid: uid, readerCode: "RDR-RM1" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.result, "duplicate");
  });

  test("unknown tag is rejected (404) but still saved in the scan log", async (t) => {
    if (skip(t)) return;
    const unknown = randomBytes(5).toString("hex").toUpperCase() + "B2";
    const r = await srv!.call("POST", "/api/scans/device", { headers: { "x-reader-key": readerKey }, body: { rfidUid: unknown, readerCode: "RDR-RM1" } });
    assert.equal(r.status, 404);
    const n = await db!.query<{ n: number }>(`SELECT count(*)::int AS n FROM scan_logs WHERE rfid_uid = $1 AND result = 'rejected_unknown_tag'`, [unknown]);
    assert.equal(n.rows[0]!.n, 1);
  });

  test("wrong or missing reader key is refused (401) and nothing is saved", async (t) => {
    if (skip(t)) return;
    const before = (await db!.query<{ n: number }>(`SELECT count(*)::int AS n FROM scan_logs`)).rows[0]!.n;
    assert.equal((await srv!.call("POST", "/api/scans/device", { headers: { "x-reader-key": "wrong" }, body: { rfidUid: uid, readerCode: "RDR-RM1" } })).status, 401);
    assert.equal((await srv!.call("POST", "/api/scans/device", { body: { rfidUid: uid, readerCode: "RDR-RM1" } })).status, 401);
    assert.equal((await db!.query<{ n: number }>(`SELECT count(*)::int AS n FROM scan_logs`)).rows[0]!.n, before);
  });

  test("scan history API (what the dashboard 'Live RFID Scans' uses) returns the saved scan", async (t) => {
    if (skip(t)) return;
    const admin = await login("admin@texchain.local");
    const r = await srv!.call("GET", `/api/scans?uid=${uid}`, { token: admin });
    assert.equal(r.status, 200);
    const results = (r.body.data as Array<{ result: string }>).map((x) => x.result).sort();
    assert.deepEqual(results, ["accepted", "duplicate"]);
    // The product timeline is read by the auditor role (the admin role only manages users).
    const hist = await srv!.call("GET", `/api/products/${productId}/history`, { token: await login("auditor@texchain.local") });
    assert.equal(hist.status, 200, JSON.stringify(hist.body));
    assert.ok(JSON.stringify(hist.body).includes("RDR-RM1"), "timeline should mention the reader that scanned the tag");
  });

  test("data is persistent: still there through a brand-new connection pool (= backend restart)", async (t) => {
    if (skip(t)) return;
    const fresh = createDb(url);
    try {
      const r = await fresh.query<{ n: number }>(`SELECT count(*)::int AS n FROM scan_logs WHERE rfid_uid = $1`, [uid]);
      assert.equal(r.rows[0]!.n, 2);
      const stage = await fresh.query<{ s: string }>(`SELECT current_stage::text AS s FROM products WHERE id = $1`, [productId]);
      assert.equal(stage.rows[0]?.s, "raw_material_1");
    } finally { await fresh.close(); }
  });
});
