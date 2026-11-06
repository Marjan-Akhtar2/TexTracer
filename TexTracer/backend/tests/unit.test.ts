// Pure unit tests: no database, no network, no HTTP server.
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_LOCAL_DATABASE_URL, parseConfig, parseDuration } from "../src/config/env";
import { AppError } from "../src/core/errors";
import { signJwt, verifyJwt } from "../src/core/jwt";
import { ROLE_CODES, ROLE_LABELS, ROLE_PERMISSIONS, isRoleCode } from "../src/core/roles";
import { parse } from "../src/core/validate";
import { toErrorReply } from "../src/http/listener";
import { RateLimiter } from "../src/http/rateLimit";
import { Router } from "../src/http/router";
import { requireRole } from "../src/middleware/requireRole";
import { canDecide } from "../src/modules/approvals/approvals.routes";
import { buildStageReport, findBottleneckStage } from "../src/modules/dashboard/dashboard.service";
import type { StageKpi } from "../src/modules/dashboard/dashboard.repo";
import { scanReply } from "../src/modules/scans/scans.routes";
import { createUserBody, setRoleBody, updateUserBody } from "../src/modules/users/users.schemas";

const SECRET = "x".repeat(32);
const stage = (o: Partial<StageKpi> & { stage: string }): StageKpi => ({ seq: 0, department: "X", wip: 0, arrivalsTotal: 0, arrivals24h: 0, avgDwellSeconds: null, ...o });

describe("config", () => {
  test("defaults and parsing", () => {
    const c = parseConfig({ JWT_SECRET: SECRET } as NodeJS.ProcessEnv);
    assert.equal(c.port, 5000); assert.equal(c.jwtExpiresInSeconds, 8 * 3600); assert.equal(c.dbMode, "local"); assert.equal(c.databaseUrl, DEFAULT_LOCAL_DATABASE_URL);
  });
  test("rejects missing/short secret and bad port", () => {
    assert.throws(() => parseConfig({} as NodeJS.ProcessEnv), /JWT_SECRET/);
    assert.throws(() => parseConfig({ JWT_SECRET: SECRET, PORT: "abc" } as NodeJS.ProcessEnv), /PORT/);
  });
  test("durations", () => {
    assert.equal(parseDuration("30m"), 1800); assert.equal(parseDuration("2d"), 172800); assert.equal(parseDuration("90"), 90);
    assert.throws(() => parseDuration("soon"));
  });
});

describe("jwt", () => {
  test("round trip", () => assert.equal(verifyJwt(signJwt("user-1", SECRET, 60), SECRET)?.sub, "user-1"));
  test("rejects tampering, wrong secret, expiry, alg=none, garbage", () => {
    const t = signJwt("u", SECRET, 60);
    assert.equal(verifyJwt(t.slice(0, -2) + "xx", SECRET), null);
    assert.equal(verifyJwt(t, "y".repeat(32)), null);
    assert.equal(verifyJwt(signJwt("u", SECRET, 60, Date.now() - 120_000), SECRET), null);
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"u","exp":9999999999}').toString("base64url")}.`;
    assert.equal(verifyJwt(none, SECRET), null);
    assert.equal(verifyJwt("nope", SECRET), null);
  });
});

describe("roles and permissions", () => {
  test("six roles with the exact SRS labels", () => {
    assert.equal(ROLE_CODES.length, 6);
    assert.deepEqual(Object.values(ROLE_LABELS).sort(), ["Auditor", "Department Officer", "QC Officer", "Senior Management", "System Administrator", "Warehouse Manager"]);
    for (const r of ROLE_CODES) assert.ok(ROLE_PERMISSIONS[r].length > 0);
    assert.equal(isRoleCode("qc_officer"), true); assert.equal(isRoleCode("QC Officer"), false);
  });
  test("requireRole", () => {
    const run = (user: unknown) => { try { requireRole("qc_officer")({ user } as never); return null; } catch (e) { return e as AppError; } };
    assert.equal(run({ role: "qc_officer" }), null);
    assert.equal(run({ role: "auditor" })?.status, 403);
    assert.equal(run(undefined)?.status, 401);
  });
  test("who may decide at each gate", () => {
    assert.equal(canDecide({ role: "warehouse_manager", department: "Warehouse" }, "gate1_intake"), true);
    assert.equal(canDecide({ role: "qc_officer", department: null }, "gate1_intake"), false);
    assert.equal(canDecide({ role: "qc_officer", department: null }, "gate2_qc"), true);
    assert.equal(canDecide({ role: "department_officer", department: "Packaging" }, "gate3_shipment"), true);
    assert.equal(canDecide({ role: "department_officer", department: "Production" }, "gate3_shipment"), false);
    assert.equal(canDecide({ role: "auditor", department: null }, "gate3_shipment"), false);
    assert.equal(canDecide({ role: "system_admin", department: null }, "gate2_qc"), false);
  });
});

describe("validation", () => {
  const valid = { email: " New.User@Test.com ", fullName: "New User", password: "longenough1", role: "qc_officer" };
  test("createUser normalises and rejects bad input", () => {
    assert.equal(parse(createUserBody, valid).email, "new.user@test.com");
    for (const bad of [{ ...valid, email: "x" }, { ...valid, password: "short" }, { ...valid, role: "ceo" }, { ...valid, departmentId: -1 }]) {
      assert.throws(() => parse(createUserBody, bad), (e) => e instanceof AppError && e.status === 400 && e.code === "VALIDATION_ERROR");
    }
  });
  test("updateUser forbids role escalation and empty bodies", () => {
    assert.throws(() => parse(updateUserBody, { role: "system_admin" })); assert.throws(() => parse(updateUserBody, {}));
    assert.throws(() => parse(setRoleBody, { role: "root" }));
  });
});

describe("router", () => {
  test("params, guards and mounting", async () => {
    const calls: string[] = [];
    const inner = new Router().use(() => { calls.push("inner-guard"); }).get("/:id/x", (r) => ({ status: 200, body: r.params.id }));
    const root = new Router().mount("/api/things", inner, () => { calls.push("mount-guard"); });
    const reply = await root.run("GET", "/api/things/42/x", { query: {}, body: undefined, headers: {}, ip: "1" });
    assert.deepEqual(reply, { status: 200, body: "42" });
    assert.deepEqual(calls, ["mount-guard", "inner-guard"]);
    assert.equal(await root.run("POST", "/api/things/42/x", { query: {}, body: undefined, headers: {}, ip: "1" }), null);
    assert.equal(await root.run("GET", "/api/other", { query: {}, body: undefined, headers: {}, ip: "1" }), null);
  });
});

describe("rate limiter", () => {
  test("blocks after max and resets after the window", () => {
    let now = 0; const rl = new RateLimiter(2, 1000, () => now);
    assert.equal(rl.check("a"), 0); assert.equal(rl.check("a"), 0); assert.ok(rl.check("a") > 0);
    assert.equal(rl.check("b"), 0); now = 1001; assert.equal(rl.check("a"), 0);
  });
});

describe("error mapping", () => {
  test("never leaks internals", () => {
    const r = toErrorReply(new Error("password=hunter2"));
    assert.equal(r.reply.status, 500); assert.ok(!JSON.stringify(r.reply.body).includes("hunter2"));
  });
  test("database codes map to clean HTTP errors", () => {
    assert.equal(toErrorReply({ code: "23505" }).reply.status, 409);
    assert.equal(toErrorReply({ code: "23503" }).reply.status, 422);
    assert.equal(toErrorReply({ code: "22P02" }).reply.status, 400);
    assert.equal(toErrorReply({ code: "42501" }).reply.status, 403);
    const wf = toErrorReply(Object.assign(new Error("Gate gate2_qc already decided"), { code: "P0001" }));
    assert.equal(wf.reply.status, 422);
  });
  test("scan verdicts become the right status codes", () => {
    const base = { productId: "p", fromStage: "a", toStage: "b", detail: "d" };
    assert.equal(scanReply({ ...base, result: "accepted" }, null).status, 201);
    assert.equal(scanReply({ ...base, result: "duplicate" }, null).status, 200);
    for (const [result, status] of [["rejected_out_of_sequence", 422], ["rejected_gate_not_approved", 422], ["rejected_product_blocked", 422], ["rejected_unknown_tag", 404], ["rejected_unknown_reader", 404]] as const) {
      assert.throws(() => scanReply({ ...base, result }, null), (e) => e instanceof AppError && e.status === status);
    }
  });
});

describe("dashboard bottleneck", () => {
  test("rules", () => {
    assert.equal(findBottleneckStage([stage({ stage: "a" })]), null);
    assert.equal(findBottleneckStage([stage({ stage: "a", wip: 2 }), stage({ stage: "b", wip: 5 })]), "b");
    assert.equal(findBottleneckStage([stage({ stage: "a", wip: 3, avgDwellSeconds: 10 }), stage({ stage: "b", wip: 3, avgDwellSeconds: 99 })]), "b");
  });
  test("department roll-up", () => {
    const r = buildStageReport([
      stage({ stage: "raw_material_1", department: "Procurement", wip: 1, arrivalsTotal: 2, arrivals24h: 1, avgDwellSeconds: 100 }),
      stage({ stage: "raw_material_2", department: "Procurement", wip: 4, arrivalsTotal: 6, arrivals24h: 2, avgDwellSeconds: 200 }),
      stage({ stage: "design", department: "Design", wip: 2, arrivalsTotal: 3 }),
    ]);
    const p = r.departments.find((d) => d.department === "Procurement")!;
    assert.equal(p.wip, 5); assert.equal(p.avgDwellSeconds, 175); assert.equal(p.isBottleneck, true);
    assert.equal(r.bottleneckDepartment, "Procurement");
  });
});
