#!/usr/bin/env node
// Shows what the existing frontend shows: the scan log from GET /api/scans (and optionally a product's stage).
// Read-only. Works with any role that may read scans (department_officer sees only its own department).
//
// Usage:  node verify_scans.mjs [--api http://localhost:5000/api] [--limit 15] [--uid A1B2C3D4] [--watch]
//         LOGIN_EMAIL / LOGIN_PASSWORD env vars skip the prompts (auditor@texchain.local works well: sees all readers).
import { createInterface } from "node:readline/promises";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg("--api", "http://localhost:5000/api").replace(/\/$/, "");
const LIMIT = arg("--limit", "15"), UID = arg("--uid", "");
const WATCH = process.argv.includes("--watch");

async function call(method, path, body, token) {
  const r = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(`${method} ${path} -> HTTP ${r.status} ${j?.error?.message ?? ""}`);
  return j;
}
let email = process.env.LOGIN_EMAIL, password = process.env.LOGIN_PASSWORD;
if (!email || !password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  email ||= await rl.question("Email: "); password ||= await rl.question("Password: "); rl.close();
}
const { data: { token, user } } = await call("POST", "/auth/login", { email, password });
console.log(`Logged in as ${user.email} (${user.role})\n`);

let lastId = 0;
async function show() {
  const q = new URLSearchParams({ limit: LIMIT, ...(UID ? { uid: UID.toUpperCase() } : {}) });
  const j = await call("GET", `/scans?${q}`, undefined, token);
  const rows = [...j.data].reverse().filter((r) => r.id > lastId);
  for (const r of rows) {
    console.log(`#${r.id}  ${r.scannedAt}  ${r.readerCode.padEnd(11)} ${r.rfidUid.padEnd(20)} ${r.result.padEnd(26)} stage=${r.stage ?? "-"}  device_ts=${r.deviceTs ?? "-"}  ${r.detail ?? ""}`);
    lastId = Math.max(lastId, r.id);
  }
  if (!rows.length && !WATCH) console.log("(no scans recorded yet)");
}
await show();
if (WATCH) { console.log("\nWatching for new scans (Ctrl+C to stop)..."); setInterval(() => show().catch((e) => console.error(e.message)), 2000); }
