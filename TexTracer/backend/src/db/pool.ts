import type { Pool, PoolClient } from "pg";

/**
 * Minimal database interface used by every module (never import "pg" elsewhere),
 * so tests can pass a fake or another driver.
 */
export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
};
export interface Db extends Queryable {
  /** Runs fn inside BEGIN/COMMIT (ROLLBACK on error). Use for multi-statement writes. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
  /** Like ping() but explains a failure (cause + fix). Optional so test fakes need not implement it. */
  diagnose?(): Promise<{ ok: true } | { ok: false; code: string; message: string; hint: string }>;
  close(): Promise<void>;
}

/** Host/port/database/user of a connection string, WITHOUT the password: safe to print. */
export function describeDbTarget(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    return `${decodeURIComponent(u.username) || "?"}@${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "") || "?"}`;
  } catch {
    return "(DATABASE_URL is not a valid connection string)";
  }
}

/** True when the connection string points at this computer (no TLS needed, no internet needed). */
export function isLocalDbUrl(databaseUrl: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

/** Turns a driver error into a plain-language cause + fix. Never includes the password or the full URL. */
export function explainDbError(err: unknown): { code: string; message: string; hint: string } {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "UNKNOWN";
  const message = (e?.message ?? String(err)).split("\n")[0]!;
  const hints: Record<string, string> = {
    ECONNREFUSED: "Nothing is listening on that host/port. Start PostgreSQL (Windows: Services -> postgresql-x64-16 -> Start) and check the port (default 5432).",
    ENOTFOUND: "The host name cannot be resolved. For the local database use localhost; for a cloud database you need internet access.",
    ETIMEDOUT: "The connection timed out. Local database: is the PostgreSQL service running? Cloud database: your network (hotspot/eduroam) is blocking or slow, use DB_MODE=local.",
    "28P01": "Wrong database password for this user. Fix DATABASE_URL_LOCAL in backend/.env, or re-run: npm run db:init",
    "28000": "This database user does not exist or is not allowed to connect. Re-run: npm run db:init",
    "3D000": "The database does not exist yet. Create it with: npm run db:init",
    "42P01": "A table/view is missing: the schema was not loaded. Run: npm run db:init",
    "42883": "A database function is missing: the schema was not loaded. Run: npm run db:init",
    NO_DB: "No database is configured. Check DB_MODE and DATABASE_URL_LOCAL in backend/.env.",
  };
  const hint = hints[code] ?? (/timeout/i.test(message) ? hints.ETIMEDOUT! : "See the message above. Run `npm run db:check` for a full diagnosis.");
  return { code, message, hint };
}

export function createDb(databaseUrl: string): Db {
  // Loaded here (not at the top) so tests and tools that never touch a database do not need the driver.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg") as typeof import("pg");
  const local = isLocalDbUrl(databaseUrl);
  const pool = new PgPool({
    connectionString: databaseUrl,
    ssl: local ? false : { rejectUnauthorized: false }, // a cloud database requires TLS; a local one does not
    max: 10,
    connectionTimeoutMillis: local ? 3000 : 8000, // local answers in milliseconds: fail fast and say why
    idleTimeoutMillis: 30000,
  });
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));

  const wrap = (c: Pick<Pool | PoolClient, "query">): Queryable["query"] => async (text, params) => {
    const r = await c.query(text, params as unknown[]);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };

  return {
    query: wrap(pool) as Queryable["query"],
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: wrap(client) as Queryable["query"] });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async ping() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    async diagnose() {
      try {
        await pool.query("SELECT 1");
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, ...explainDbError(err) };
      }
    },
    close: () => pool.end(),
  };
}

/** Used when DATABASE_URL is not set: the server still starts, every DB call fails cleanly. */
export const unavailableDb: Db = {
  query: () => Promise.reject(Object.assign(new Error("Database not configured (check DB_MODE / DATABASE_URL_LOCAL in backend/.env)"), { code: "NO_DB" })),
  transaction: () => Promise.reject(Object.assign(new Error("Database not configured"), { code: "NO_DB" })),
  ping: async () => false,
  close: async () => undefined,
};
