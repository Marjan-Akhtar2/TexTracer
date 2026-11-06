// Blockchain layer tests: NO real database and NO real MultiChain node needed.
// A tiny in-process fake of MultiChain's JSON-RPC (helpers/mockMultichain.ts) and an in-memory outbox stand in for them.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { parseConfig as loadConfig } from "../src/config/env";
import type { Logger } from "../src/core/logger";
import { createAnchorWorker } from "../src/modules/blockchain/anchor.worker";
import type { AnchorsRepo, ClaimedAnchor } from "../src/modules/blockchain/anchors.repo";
import { createRpcClient, type MultichainConfig } from "../src/modules/blockchain/multichain.client";
import { createMultichainService, sha256Hex } from "../src/modules/blockchain/multichain.service";
import { explodingDb, fakeUsers, PASSWORD, startServer, type TestServer } from "./helpers/offline";
import { startMockMultichain, type MockChain } from "./helpers/mockMultichain";

const quiet: Logger = { info() {}, warn() {}, error() {} } as unknown as Logger;
let chain: MockChain;
const cfg = (over: Partial<MultichainConfig> = {}): MultichainConfig => ({
  enabled: true, host: "127.0.0.1", port: chain.port, rpcUser: "multichainrpc", rpcPassword: "secret", chainName: "chain1",
  streamName: "gate_scans", anchorChainCode: "multichain", autoCreateStream: true, workerIntervalMs: 1000, batchSize: 10,
  maxAttempts: 3, minConfirmations: 1, rpcTimeoutMs: 2000, ...over,
});

/** In-memory outbox with the same state machine as chain_anchors + its SQL functions. */
function memoryRepo(jobs: { id: number; productUid: string; text: string; hashOverride?: string }[]) {
  const rows = jobs.map((j) => ({ ...j, status: "pending" as string, attempts: 0, tx: null as string | null, err: null as string | null, confirmations: 0, ageSeconds: 0 }));
  const repo: AnchorsRepo = {
    async recoverStale() { return 0; },
    async claim(_c, limit) {
      const out: ClaimedAnchor[] = [];
      for (const r of rows.filter((x) => x.status === "pending").slice(0, limit)) {
        r.status = "submitted"; r.attempts++;
        out.push({ id: r.id, inspectionId: r.id, productUid: r.productUid, metadataText: r.text, metadataHash: r.hashOverride ?? sha256Hex(r.text), hashOk: !r.hashOverride, attempts: r.attempts });
      }
      return out;
    },
    async markSubmitted(id, tx) { rows.find((r) => r.id === id)!.tx = tx; },
    async awaitingConfirmation() { return rows.filter((r) => r.status === "submitted" && r.tx).map((r) => ({ id: r.id, txHash: r.tx!, ageSeconds: r.ageSeconds })); },
    async confirm(id, _t, _b, conf) { const r = rows.find((x) => x.id === id)!; r.status = "confirmed"; r.confirmations = conf; },
    async fail(id, error, max) { const r = rows.find((x) => x.id === id)!; r.err = error; r.status = r.attempts >= max ? "failed" : "pending"; },
    async forProduct() { return []; },
    async queue() { return []; },
  };
  return { rows, repo };
}

before(async () => { chain = await startMockMultichain(); });
after(() => chain.close());

describe("config", () => {
  const base = { JWT_SECRET: "x".repeat(32) };
  test("layer is disabled unless a password is configured", () => {
    assert.equal(loadConfig({ ...base } as any).multichain?.enabled, false);
    assert.equal(loadConfig({ ...base, MULTICHAIN_RPC_PASSWORD: "pw" } as any).multichain?.enabled, true);
    assert.equal(loadConfig({ ...base, MULTICHAIN_RPC_PASSWORD: "pw", MULTICHAIN_ENABLED: "false" } as any).multichain?.enabled, false);
  });
  test("reads the documented variables", () => {
    const m = loadConfig({ ...base, MULTICHAIN_RPC_PASSWORD: "pw", MULTICHAIN_HOST: "10.0.0.5", MULTICHAIN_PORT: "9000", MULTICHAIN_CHAIN_NAME: "c9", MULTICHAIN_STREAM_NAME: "s9" } as any).multichain!;
    assert.deepEqual([m.host, m.port, m.chainName, m.streamName, m.anchorChainCode], ["10.0.0.5", 9000, "c9", "s9", "multichain"]);
  });
});

describe("rpc client + service", () => {
  test("wrong credentials are reported clearly", async () => {
    const bad = createRpcClient({ ...cfg(), rpcPassword: "nope" });
    await assert.rejects(() => bad.call("getinfo"), /rejected the credentials/);
  });
  test("ensureStream creates + subscribes once; publish/getItem round-trip", async () => {
    const svc = createMultichainService(cfg());
    await svc.ensureStream();
    assert.ok(chain.state.streams.has("gate_scans"));
    const text = JSON.stringify({ a: 1 });
    const tx = await svc.publish({ schema: "texchain.anchor.v1", anchorId: 1, inspectionId: 1, productUid: "AA11", chain: "multichain", metadataHash: sha256Hex(text), metadataText: text, metadata: { a: 1 }, publishedAt: "now" });
    let item = await svc.getItem(tx);
    assert.equal(svc.compare(item, { metadataHash: sha256Hex(text), metadataText: text, productUid: "AA11" }).state, "pending_confirmation");
    chain.mine();
    item = await svc.getItem(tx);
    assert.equal(svc.compare(item, { metadataHash: sha256Hex(text), metadataText: text, productUid: "AA11" }).state, "verified");
    assert.equal(await svc.blockHeight(tx), chain.state.height);
  });
  test("unknown tx -> not_found; changed database hash -> mismatch", async () => {
    const svc = createMultichainService(cfg());
    assert.equal(await svc.getItem("f".repeat(64)), null);
    assert.equal(svc.compare(null, { metadataHash: "", metadataText: "", productUid: "" }).state, "not_found");
    const text = "{}";
    const tx = await svc.publish({ schema: "texchain.anchor.v1", anchorId: 2, inspectionId: 2, productUid: "AA22", chain: "multichain", metadataHash: sha256Hex(text), metadataText: text, metadata: {}, publishedAt: "now" });
    chain.mine();
    const r = svc.compare(await svc.getItem(tx), { metadataHash: sha256Hex("different"), metadataText: text, productUid: "AA22" });
    assert.equal(r.state, "mismatch");
  });
  test("an unreachable node is an error (never a false 'not found')", async () => {
    const svc = createMultichainService(cfg());
    chain.state.down = true;
    await assert.rejects(() => svc.getItem("a".repeat(64)));
    assert.equal(await svc.ping(), false);
    chain.state.down = false;
  });
});

describe("anchor worker", () => {
  test("publishes pending anchors, then confirms them after a block is mined", async () => {
    const { rows, repo } = memoryRepo([{ id: 1, productUid: "AA33", text: '{"x":1}' }, { id: 2, productUid: "AA34", text: '{"x":2}' }]);
    const w = createAnchorWorker(repo, createMultichainService(cfg()), quiet);
    const a = await w.runOnce();
    assert.equal(a.published, 2); assert.equal(a.confirmed, 0);
    assert.ok(rows.every((r) => r.status === "submitted" && r.tx));
    chain.mine();
    const b = await w.runOnce();
    assert.equal(b.confirmed, 2); assert.ok(rows.every((r) => r.status === "confirmed"));
    const item = chain.state.items.get(rows[0].tx!)!;
    assert.equal(item.key, "AA33"); // stream key = product UID
  });
  test("while the node is down it does NOT claim jobs (no retry attempts burned)", async () => {
    const { rows, repo } = memoryRepo([{ id: 1, productUid: "AA35", text: "{}" }]);
    const w = createAnchorWorker(repo, createMultichainService(cfg()), quiet);
    chain.state.down = true;
    const r = await w.runOnce();
    chain.state.down = false;
    assert.equal(r.skipped, "node unreachable"); assert.equal(rows[0].attempts, 0); assert.equal(rows[0].status, "pending");
    assert.equal((await w.runOnce()).published, 1); // recovers by itself
  });
  test("data that no longer matches its stored hash is never published", async () => {
    const before = chain.state.items.size;
    const { rows, repo } = memoryRepo([{ id: 1, productUid: "AA36", text: '{"x":1}', hashOverride: "00".repeat(32) }]);
    const w = createAnchorWorker(repo, createMultichainService(cfg()), quiet);
    const r = await w.runOnce();
    assert.equal(r.failed, 1); assert.equal(chain.state.items.size, before); assert.match(rows[0].err!, /no longer matches/);
  });
  test("a publish error re-queues with an error, then gives up as 'failed' after maxAttempts", async () => {
    const { rows, repo } = memoryRepo([{ id: 1, productUid: "AA37", text: "{}" }]);
    const svc = createMultichainService(cfg({ maxAttempts: 2 }));
    const w = createAnchorWorker(repo, { ...svc, publish: async () => { throw new Error("boom"); } }, quiet);
    await w.runOnce(); assert.equal(rows[0].status, "pending");
    await w.runOnce(); assert.equal(rows[0].status, "failed"); assert.equal(rows[0].err, "boom");
  });
});

describe("http: /api/blockchain", () => {
  const { repo, seeded } = fakeUsers();
  let srv: TestServer; const T: Record<string, string> = {};
  const UUID = "11111111-1111-4111-8111-111111111111";
  before(async () => {
    srv = await startServer({ repos: { users: repo }, config: { loginRateLimitMax: 1000 } });
    for (const k of ["officer", "auditor"] as const) T[k] = (await srv.call("POST", "/api/auth/login", { body: { email: seeded[k].email, password: PASSWORD } })).body.data.token;
  });
  after(() => srv.close());
  test("requires login", async () => { assert.equal((await srv.call("GET", "/api/blockchain/status")).status, 401); });
  test("status: role guard first; then reports the layer as disabled when not configured", async () => {
    assert.equal((await srv.call("GET", "/api/blockchain/status", { token: T.officer })).status, 403);
    const r = await srv.call("GET", "/api/blockchain/status", { token: T.auditor });
    assert.equal(r.status, 200); assert.equal(r.body.data.enabled, false);
  });
  test("verify: bad id -> 400, layer disabled -> 503 (never touches the database)", async () => {
    assert.equal((await srv.call("GET", "/api/blockchain/products/not-a-uuid/verify", { token: T.auditor })).status, 400);
    const r = await srv.call("GET", `/api/blockchain/products/${UUID}/verify`, { token: T.auditor });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, "BLOCKCHAIN_DISABLED");
  });
  test("health reports blockchain: disabled", async () => { assert.equal((await srv.call("GET", "/api/health")).body.data.blockchain, "disabled"); });
});
void explodingDb;
