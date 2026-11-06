// TEST-ONLY stand-in for the "pg" driver (the sandbox has no npm access to install it).
// It forwards each query to the local `psql` binary and returns rows as JSON, so the REAL backend code
// and the REAL SQL functions from ../database/*.sql run unchanged. It is NOT used in production.
const { execFile } = require("node:child_process");
const lit = (v) => v === null || v === undefined ? "NULL"
  : typeof v === "number" || typeof v === "boolean" ? String(v)
  : "'" + String(v).replace(/'/g, "''") + "'";
function bind(text, params = []) {
  let out = text;
  for (let i = params.length; i >= 1; i--) out = out.split("$" + i).join(lit(params[i - 1]));
  return out;
}
function runPsql(sql) {
  const url = process.env.TEST_PG_CONN || "host=/tmp port=5433 user=postgres dbname=textracer_test";
  return new Promise((resolve, reject) => {
    execFile("psql", [url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => err ? reject(Object.assign(new Error((stderr || err.message).trim()), { code: "PSQL" })) : resolve(stdout));
  });
}
async function query(text, params) {
  const t = text.trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(t)) { return { rows: [], rowCount: 0 }; }
  if (/^(INSERT|UPDATE|DELETE)/i.test(t) && !/RETURNING/i.test(t)) { await runPsql(bind(t, params)); return { rows: [], rowCount: 1 }; }
  const sql = `WITH t AS (${bind(t, params).replace(/;\s*$/, "")}) SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM t`;
  const out = (await runPsql(sql)).trim().split("\n").filter((l) => /^[\[]/.test(l)).pop() || "[]";
  const rows = JSON.parse(out);
  return { rows, rowCount: rows.length };
}
class Pool {
  on() { return this; }
  query(t, p) { return query(t, p); }
  async connect() { return { query, release() {} }; }
  async end() {}
}
module.exports = { Pool };
