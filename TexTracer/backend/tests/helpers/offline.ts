import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app";
import type { Config } from "../../src/config/env";
import type { Db } from "../../src/db/pool";
import type { RoleCode } from "../../src/core/roles";
import type { UserRecord, UsersRepo } from "../../src/modules/users/users.repo";

export const PASSWORD = "Passw0rd!test";
export const testConfig: Config = {
  nodeEnv: "test", port: 0, corsOrigins: ["http://localhost:5173"], dbMode: "local", databaseUrl: undefined,
  jwtSecret: "unit-test-secret-not-used-anywhere-else", jwtExpiresInSeconds: 3600, trustProxy: false,
  logRequests: false, loginRateLimitMax: 5, deviceRateLimitMax: 1000, globalRateLimitMax: 100000,
};

/** A database that fails loudly if anything touches it: proves guards/validation run BEFORE any SQL. */
export const explodingDb: Db = {
  query: () => Promise.reject(Object.assign(new Error("DB touched"), { code: "NO_DB" })),
  transaction: () => Promise.reject(Object.assign(new Error("DB touched"), { code: "NO_DB" })),
  ping: async () => false,
  close: async () => undefined,
};

/** In-memory users (plain-text password compare stands in for the database's bcrypt check). */
export function fakeUsers() {
  const rows = new Map<string, UserRecord & { password: string }>();
  const add = (key: string, role: RoleCode | null, dept: [number, string] | null = null, isActive = true) => {
    const u = { id: randomUUID(), email: `${key}@test.local`, fullName: `Test ${key}`, isActive, departmentId: dept?.[0] ?? null,
      department: dept?.[1] ?? null, role, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), password: PASSWORD };
    rows.set(u.id, u);
    return u;
  };
  const seeded = {
    admin: add("admin", "system_admin"),
    officer: add("officer", "department_officer", [4, "Production"]),
    warehouse: add("warehouse", "warehouse_manager", [8, "Warehouse"]),
    qc: add("qc", "qc_officer", [5, "Stitching + QC Gate"]),
    auditor: add("auditor", "auditor"),
    management: add("management", "senior_management"),
    inactive: add("inactive", "auditor", null, false),
    noRole: add("norole", null),
  };
  const strip = ({ password: _p, ...rest }: UserRecord & { password: string }): UserRecord => rest;
  const repo: UsersRepo = {
    list: async () => [...rows.values()].map(strip),
    findById: async (id) => (rows.has(id) ? strip(rows.get(id)!) : null),
    emailExists: async (e) => [...rows.values()].some((r) => r.email === e),
    verifyLogin: async (email, password) => {
      const r = [...rows.values()].find((x) => x.email === email);
      return r ? { user: strip(r), passwordOk: r.password === password } : null;
    },
    create: async (i) => {
      const u = add(i.email.split("@")[0]!, i.role, i.departmentId ? [i.departmentId, "Dept"] : null);
      u.email = i.email; u.fullName = i.fullName; u.password = i.password;
      return strip(u);
    },
    update: async (id, patch) => {
      const r = rows.get(id); if (!r) return null;
      if (patch.fullName !== undefined) r.fullName = patch.fullName;
      if (patch.isActive !== undefined) r.isActive = patch.isActive;
      if (patch.password !== undefined) r.password = patch.password;
      return strip(r);
    },
    setRole: async (id, role) => { const r = rows.get(id); if (!r) return null; r.role = role; return strip(r); },
  };
  return { repo, seeded };
}

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
  call(method: string, path: string, o?: { token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers }>;
}

export async function startServer(opts: { repos?: Parameters<typeof createApp>[0]["repos"]; db?: Db; config?: Partial<Config> } = {}): Promise<TestServer> {
  const server: Server = createApp({ config: { ...testConfig, ...opts.config }, db: opts.db, repos: opts.repos ?? {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    close: () => new Promise((r) => server.close(() => r())),
    async call(method, path, o = {}) {
      const headers: Record<string, string> = { ...(o.headers ?? {}) };
      if (o.token) headers.authorization = `Bearer ${o.token}`;
      let body: string | undefined;
      if (o.rawBody !== undefined) { body = o.rawBody; headers["content-type"] = "application/json"; }
      else if (o.body !== undefined) { body = JSON.stringify(o.body); headers["content-type"] = "application/json"; }
      const res = await fetch(baseUrl + path, { method, headers, ...(body !== undefined ? { body } : {}) });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
    },
  };
}
