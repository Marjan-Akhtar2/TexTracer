#!/usr/bin/env node
// Creates (or resets) the LOCAL PostgreSQL database for TexTracer and loads the project's own SQL files.
// Needs only Node 22 and PostgreSQL's `psql` (installed with PostgreSQL). It never touches any cloud database.
//
//   node database/local/init-local-db.mjs                 create role + database + schema + seed (safe to re-run)
//   node database/local/init-local-db.mjs --db textracer_test   a second, throw-away database for `npm run test:local`
//   node database/local/init-local-db.mjs --reset --yes   DROP the local database and rebuild it (local data is lost)
//
// Options: --host localhost --port 5432 --superuser postgres --db textracer --app-user textracer
//          --app-password textracer_local --no-demo (skip 07_demo_officers.sql)
// The PostgreSQL administrator password is read from $PGPASSWORD or asked for (it is never stored or printed).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = resolve(here, "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

const host = opt("host", "localhost");
const port = opt("port", "5432");
const superUser = opt("superuser", "postgres");
const db = opt("db", "textracer");
const appUser = opt("app-user", "textracer");
const appPass = opt("app-password", "textracer_local");
const FILES = ["01_schemas.sql", "02_views.sql", "03_functions.sql", "04_security.sql", "05_seed.sql", "06_multichain_chain.sql", ...(flag("no-demo") ? [] : ["07_demo_officers.sql"])];

const fail = (m) => { console.error(`\nERROR: ${m}`); process.exit(1); };
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) fail(`"${s}" is not a safe name (use lowercase letters, digits, underscore).`); return s; };
ident(db); ident(appUser);

function findPsql() {
  const probe = (cmd) => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0;
  if (probe("psql")) return "psql";
  if (process.platform === "win32") {
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files"].filter(Boolean)) {
      const root = join(base, "PostgreSQL");
      if (!existsSync(root)) continue;
      const versions = readdirSync(root).filter((v) => /^\d+/.test(v)).sort((a, b) => parseInt(b) - parseInt(a));
      for (const v of versions) { const p = join(root, v, "bin", "psql.exe"); if (existsSync(p)) return p; }
    }
  }
  return null;
}
const psqlBin = findPsql();
if (!psqlBin) fail("psql was not found. Install PostgreSQL first (see LOCAL_DATABASE_SETUP.md, step 1) and re-open PowerShell.");

async function askHidden(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
  return new Promise((r) => rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); r(a); }));
}

/** Runs psql; returns stdout. Throws with psql's own message on failure. */
function psql(user, password, database, extra) {
  try {
    return execFileSync(psqlBin, ["-h", host, "-p", port, "-U", user, "-d", database, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...extra],
      { env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: "5" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { throw new Error(String(e.stderr || e.message).trim()); }
}
const scalar = (user, pw, database, sql) => psql(user, pw, database, ["-A", "-t", "-c", sql]).trim();

let superPass = process.env.PGPASSWORD ?? "";
if (!superPass) superPass = await askHidden(`PostgreSQL administrator ("${superUser}") password (the one you chose during installation): `);

console.log(`Using ${psqlBin}  ->  ${host}:${port}`);
try {
  scalar(superUser, superPass, "postgres", "SELECT 1");
} catch (e) {
  const m = e.message;
  if (/password authentication failed/i.test(m)) fail(`Wrong password for PostgreSQL user "${superUser}".\n${m}`);
  if (/could not connect|connection refused|timeout|Connection to server/i.test(m)) fail(`PostgreSQL is not reachable on ${host}:${port}.\nStart it: Windows -> Services -> "postgresql-x64-NN" -> Start (or re-install; default port is 5432).\n${m}`);
  fail(m);
}

// 1) application role (CREATEROLE is needed because 04_security.sql creates two more least-privilege roles)
const roleExists = scalar(superUser, superPass, "postgres", `SELECT 1 FROM pg_roles WHERE rolname='${appUser}'`) === "1";
const pwLit = appPass.replace(/'/g, "''");
psql(superUser, superPass, "postgres", ["-c", roleExists ? `ALTER ROLE ${appUser} LOGIN CREATEROLE PASSWORD '${pwLit}'` : `CREATE ROLE ${appUser} LOGIN CREATEROLE PASSWORD '${pwLit}'`]);
console.log(`[ok] role "${appUser}" ${roleExists ? "updated" : "created"}`);

// 2) database
let dbExists = scalar(superUser, superPass, "postgres", `SELECT 1 FROM pg_database WHERE datname='${db}'`) === "1";
if (dbExists && flag("reset")) {
  if (!flag("yes")) fail(`--reset DELETES the local database "${db}" and everything in it (your cloud database is NOT affected).\nRe-run with --reset --yes to confirm.`);
  psql(superUser, superPass, "postgres", ["-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db}' AND pid <> pg_backend_pid()`]);
  psql(superUser, superPass, "postgres", ["-c", `DROP DATABASE ${db}`]);
  dbExists = false;
  console.log(`[ok] dropped local database "${db}"`);
}
if (!dbExists) { psql(superUser, superPass, "postgres", ["-c", `CREATE DATABASE ${db} OWNER ${appUser}`]); console.log(`[ok] database "${db}" created`); }
else console.log(`[ok] database "${db}" already exists`);

// 3) schema + seed (skipped when already loaded, so re-running can never duplicate or wipe data)
const loaded = scalar(appUser, appPass, db, "SELECT to_regclass('public.scan_logs') IS NOT NULL");
if (loaded === "t") {
  console.log("[ok] schema already loaded - nothing changed (use --reset --yes to rebuild from scratch)");
} else {
  for (const f of FILES) {
    const path = join(sqlDir, f);
    if (!existsSync(path)) fail(`Missing SQL file ${path}`);
    try { psql(appUser, appPass, db, ["-f", path]); console.log(`[ok] ${f}`); }
    catch (e) { fail(`${f} failed:\n${e.message}\n\nThe database is half-built. Fix the cause, then run again with --reset --yes.`); }
  }
}

// 4) summary
const n = (t) => scalar(appUser, appPass, db, `SELECT count(*) FROM ${t}`);
console.log(`\nLocal database "${db}" is ready: ${n("users")} users, ${n("readers")} readers, ${n("stages")} stages, ${n("scan_logs")} saved scans.`);
console.log(`\nPut these lines in backend\\.env (the backend already defaults to them, so this is only needed if you changed names/passwords):`);
console.log(`  DB_MODE=local`);
console.log(`  DATABASE_URL_LOCAL=postgresql://${appUser}:<your app password>@${host}:${port}/${db}`);
console.log(`\nDemo logins (password ChangeMe!123): admin@, warehouse@, qc@, officer@, auditor@, management@ + texchain.local - change before real use.`);
