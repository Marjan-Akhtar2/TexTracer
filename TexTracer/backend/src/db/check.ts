// `npm run db:check` : explains, step by step, whether the backend can use its database and whether scans can be saved.
// Prints the target WITHOUT the password. Exit code 0 = everything fine, 1 = a problem was found.
import { loadConfig } from "../config/env";
import { createDb, describeDbTarget, isLocalDbUrl } from "./pool";

async function main(): Promise<number> {
  const config = loadConfig();
  const line = (ok: boolean, msg: string) => console.log(`${ok ? "[ OK ]" : "[FAIL]"} ${msg}`);
  if (!config.databaseUrl) { line(false, `DB_MODE=${config.dbMode} but no database URL is configured (set DATABASE_URL for cloud mode).`); return 1; }
  const isLocal = isLocalDbUrl(config.databaseUrl);
  console.log(`Mode: ${config.dbMode}   Target: ${describeDbTarget(config.databaseUrl)}   (${isLocal ? "this laptop, no internet needed" : "CLOUD, needs internet"})`);
  const db = createDb(config.databaseUrl);
  try {
    const started = Date.now();
    const d = await db.diagnose!();
    if (!d.ok) { line(false, `cannot connect [${d.code}] ${d.message}`); console.log(`       Fix: ${d.hint}`); return 1; }
    line(true, `connected in ${Date.now() - started} ms`);

    const q = async <T>(sql: string) => (await db.query<T>(sql)).rows;
    const missing = (await q<{ rel: string }>(`SELECT rel FROM unnest(ARRAY['users','readers','stages','products','scan_logs','stage_transitions','chain_anchors']) rel WHERE to_regclass('public.' || rel) IS NULL`)).map((r) => r.rel);
    if (missing.length) { line(false, `missing tables: ${missing.join(", ")}`); console.log("       Fix: npm run db:init"); return 1; }
    line(true, "all core tables exist");
    const fn = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('record_scan','record_decision')`))[0]!.n;
    line(fn === 2, fn === 2 ? "database functions record_scan() / record_decision() exist" : "record_scan()/record_decision() missing");
    if (fn !== 2) { console.log("       Fix: npm run db:init"); return 1; }

    const c = (await q<{ users: number; readers: number; keyed: number; scans: number; last: string | null }>(
      `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM readers)::int AS readers,
              (SELECT count(*) FROM readers WHERE api_key_hash IS NOT NULL)::int AS keyed,
              (SELECT count(*) FROM scan_logs)::int AS scans, (SELECT max(scanned_at)::text FROM scan_logs) AS last`))[0]!;
    line(c.users > 0, `${c.users} users`);
    line(c.readers > 0, `${c.readers} readers, ${c.keyed} with a device key${c.keyed === 0 ? "  -> run: node ..\\hardware_integration\\tools\\provision_reader_keys.mjs" : ""}`);
    console.log(`[INFO] ${c.scans} scans saved so far${c.last ? `, latest at ${c.last}` : ""}`);
    return c.users > 0 && c.readers > 0 ? 0 : 1;
  } finally { await db.close().catch(() => undefined); }
}
main().then((c) => process.exit(c), (e) => { console.error((e as Error).message); process.exit(1); });
