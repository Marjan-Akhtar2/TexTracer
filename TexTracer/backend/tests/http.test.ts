// HTTP-level tests with NO database: users are in memory and the database throws if touched.
// They prove: authentication, role guards, input validation, security headers, CORS and rate limiting
// all work and run BEFORE any SQL, whether or not your real database is connected.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { explodingDb, fakeUsers, PASSWORD, startServer, type TestServer } from "./helpers/offline";

const { repo, seeded } = fakeUsers();
let srv: TestServer;
const T: Record<string, string> = {};
const ROLES = ["admin", "officer", "warehouse", "qc", "auditor", "management"] as const;
const UUID = "11111111-1111-4111-8111-111111111111";

before(async () => {
  srv = await startServer({ repos: { users: repo }, config: { loginRateLimitMax: 1000 } });
  for (const k of ROLES) {
    const r = await srv.call("POST", "/api/auth/login", { body: { email: seeded[k].email, password: PASSWORD } });
    assert.equal(r.status, 200, `login ${k}`); T[k] = r.body.data.token;
  }
});
after(() => srv.close());

describe("basics", () => {
  test("health works without a database and says so", async () => {
    const r = await srv.call("GET", "/api/health");
    assert.equal(r.status, 200); assert.equal(r.body.data.status, "ok"); assert.equal(r.body.data.database, "not_configured");
  });
  test("unknown route -> JSON 404; bad JSON -> 400; huge body -> 413", async () => {
    const a = await srv.call("GET", "/api/nope"); assert.equal(a.status, 404); assert.equal(a.body.error.code, "NOT_FOUND");
    assert.equal((await srv.call("POST", "/api/auth/login", { rawBody: "{bad" })).body.error.code, "BAD_JSON");
    assert.equal((await srv.call("POST", "/api/auth/login", { rawBody: JSON.stringify({ x: "a".repeat(200_000) }) })).status, 413);
  });
  test("security headers present, no x-powered-by", async () => {
    const r = await srv.call("GET", "/api/health");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-powered-by"), null); assert.equal(r.headers.get("cache-control"), "no-store");
  });
  test("CORS: allowed origin echoed, others not; preflight 204", async () => {
    const ok = await srv.call("GET", "/api/health", { headers: { origin: "http://localhost:5173" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const bad = await srv.call("GET", "/api/health", { headers: { origin: "http://evil.example" } });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
    assert.equal((await srv.call("OPTIONS", "/api/users", { headers: { origin: "http://localhost:5173" } })).status, 204);
  });
});

describe("authentication", () => {
  test("login returns token and SRS role label; password never echoed", async () => {
    const r = await srv.call("POST", "/api/auth/login", { body: { email: seeded.qc.email, password: PASSWORD } });
    assert.equal(r.body.data.user.roleLabel, "QC Officer"); assert.equal(r.body.data.user.department, "Stitching + QC Gate");
    assert.ok(!JSON.stringify(r.body).includes(PASSWORD));
  });
  test("wrong password == unknown email; inactive blocked; no-role 403", async () => {
    const a = await srv.call("POST", "/api/auth/login", { body: { email: seeded.qc.email, password: "wrong-password" } });
    const b = await srv.call("POST", "/api/auth/login", { body: { email: "ghost@test.local", password: "wrong-password" } });
    assert.equal(a.status, 401); assert.deepEqual(a.body, b.body);
    assert.equal((await srv.call("POST", "/api/auth/login", { body: { email: seeded.inactive.email, password: PASSWORD } })).status, 401);
    assert.equal((await srv.call("POST", "/api/auth/login", { body: { email: seeded.noRole.email, password: PASSWORD } })).body.error.code, "NO_ROLE");
  });
  test("/me needs a valid token", async () => {
    assert.equal((await srv.call("GET", "/api/auth/me", { token: T.officer! })).body.data.email, seeded.officer.email);
    assert.equal((await srv.call("GET", "/api/auth/me")).status, 401);
    assert.equal((await srv.call("GET", "/api/auth/me", { token: T.officer + "x" })).status, 401);
  });
  test("deactivating a user kills their existing token immediately", async () => {
    seeded.auditor.isActive = false;
    assert.equal((await srv.call("GET", "/api/auth/me", { token: T.auditor! })).status, 401);
    seeded.auditor.isActive = true;
  });
  test("login is rate limited (429 with Retry-After)", async () => {
    const s2 = await startServer({ repos: { users: repo }, db: explodingDb, config: { loginRateLimitMax: 3 } });
    let last = 0; let retry: string | null = null;
    for (let i = 0; i < 5; i++) { const r = await s2.call("POST", "/api/auth/login", { body: { email: "a@test.local", password: "x" } }); last = r.status; retry = r.headers.get("retry-after"); }
    await s2.close(); assert.equal(last, 429); assert.ok(retry);
  });
});

// [method, path, body, roles that are ALLOWED]. Everyone else must get 403; no token must get 401.
const R = { admin: "admin", officer: "officer", warehouse: "warehouse", qc: "qc", auditor: "auditor", management: "management" } as const;
const readers = [R.officer, R.warehouse, R.qc, R.auditor, R.management];
const everyone = [...ROLES];
const MATRIX: [string, string, unknown, string[]][] = [
  ["GET", "/api/users", undefined, [R.admin]],
  ["POST", "/api/users", {}, [R.admin]],
  ["PUT", `/api/users/${UUID}/role`, {}, [R.admin]],
  ["GET", "/api/roles", undefined, [R.admin]],
  ["PUT", "/api/readers/abc/key", undefined, [R.admin]],
  ["GET", "/api/departments/abc", undefined, everyone],
  ["POST", "/api/purchase-orders", {}, [R.warehouse]],
  ["POST", "/api/products", {}, [R.warehouse]],
  ["GET", "/api/products?page=0", undefined, readers],
  ["GET", "/api/products/not-a-uuid", undefined, readers],
  ["POST", "/api/scans", {}, [R.officer]],
  ["GET", "/api/scans?page=0", undefined, [R.officer, R.auditor, R.management, R.warehouse, R.admin]],
  ["GET", "/api/approvals/pending?gate=bogus", undefined, [R.officer, R.warehouse, R.qc, R.auditor, R.management]],
  ["POST", `/api/approvals/${UUID}/decisions`, {}, [R.officer, R.warehouse, R.qc]],
  ["GET", "/api/approvals/not-a-uuid/decisions", undefined, readers],
  ["GET", "/api/rework?page=0", undefined, [R.officer, R.qc, R.auditor, R.management]],
  ["POST", `/api/rework/${UUID}/complete`, {}, [R.officer]],
  ["GET", "/api/audit/decisions?page=0", undefined, [R.auditor]],
  ["GET", "/api/audit/transitions?page=0", undefined, [R.auditor]],
  ["GET", "/api/dashboard/stalled?limit=0", undefined, [R.management]],
  ["GET", "/api/dashboard/kpis", undefined, [R.management]],
];

describe("role matrix (server-side authorization)", () => {
  for (const [method, path, body, allowed] of MATRIX) {
    test(`${method} ${path.split("?")[0]}`, async () => {
      assert.equal((await srv.call(method, path, body === undefined ? {} : { body })).status, 401, "no token");
      for (const role of ROLES) {
        const r = await srv.call(method, path, { token: T[role]!, ...(body === undefined ? {} : { body }) });
        if (allowed.includes(role)) assert.ok(r.status !== 401 && r.status !== 403, `${role} should pass the guard, got ${r.status}`);
        else assert.equal(r.status, 403, `${role} must be forbidden`);
      }
    });
  }
  test("allowed roles with invalid input get 400 BEFORE the database is touched", async () => {
    for (const [p, role] of [["/api/products?page=0", "qc"], ["/api/products/not-a-uuid", "auditor"], ["/api/audit/decisions?page=0", "auditor"], ["/api/dashboard/stalled?limit=0", "management"]] as const) {
      const r = await srv.call("GET", p, { token: T[role]! }); assert.equal(r.status, 400, p); assert.equal(r.body.error.code, "VALIDATION_ERROR");
    }
    const bad = await srv.call("POST", `/api/approvals/${UUID}/decisions`, { token: T.qc!, body: { gate: "gate2_qc", decision: "rejected" } });
    assert.equal(bad.status, 400); assert.equal(bad.body.error.details[0].field, "reasonCode");
    assert.equal((await srv.call("POST", `/api/approvals/${UUID}/decisions`, { token: T.qc!, body: { gate: "gate3_shipment", decision: "approved" } })).status, 400);
    assert.equal((await srv.call("POST", "/api/scans", { token: T.officer!, body: { rfidUid: "xyz", readerCode: "RDR-PROD" } })).status, 400);
  });
  test("read-only roles cannot write anywhere", async () => {
    for (const role of ["auditor", "management"]) {
      for (const [m, p] of [["POST", `/api/approvals/${UUID}/decisions`], ["POST", "/api/scans"], ["POST", "/api/products"], ["POST", "/api/users"], ["POST", `/api/rework/${UUID}/complete`], ["PUT", `/api/users/${UUID}/role`]] as const) {
        assert.equal((await srv.call(m, p, { token: T[role]!, body: {} })).status, 403, `${role} ${m} ${p}`);
      }
      for (const m of ["PATCH", "DELETE", "PUT"]) assert.equal((await srv.call(m, "/api/audit/decisions", { token: T[role]!, body: {} })).status, 404);
    }
  });
});

describe("user management rules (in memory)", () => {
  test("admin creates user who can log in; duplicate -> 409; officer needs department; no self role change", async () => {
    const mk = (o: object = {}) => ({ email: "fresh@test.local", fullName: "Fresh User", password: "Sup3rSecret!", role: "warehouse_manager", departmentId: 8, ...o });
    const c = await srv.call("POST", "/api/users", { token: T.admin!, body: mk() });
    assert.equal(c.status, 201); assert.equal(c.body.data.passwordHash, undefined);
    assert.equal((await srv.call("POST", "/api/auth/login", { body: { email: "fresh@test.local", password: "Sup3rSecret!" } })).status, 200);
    assert.equal((await srv.call("POST", "/api/users", { token: T.admin!, body: mk() })).status, 409);
    assert.equal((await srv.call("POST", "/api/users", { token: T.admin!, body: mk({ email: "o@test.local", role: "department_officer", departmentId: null }) })).status, 422);
    assert.equal((await srv.call("PUT", `/api/users/${seeded.admin.id}/role`, { token: T.admin!, body: { role: "auditor" } })).status, 403);
    assert.equal((await srv.call("PATCH", `/api/users/${seeded.admin.id}`, { token: T.admin!, body: { isActive: false } })).status, 403);
    assert.equal((await srv.call("PATCH", `/api/users/${seeded.qc.id}`, { token: T.admin!, body: { role: "system_admin" } })).status, 400);
  });
});
