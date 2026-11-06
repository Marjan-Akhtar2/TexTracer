import { z } from "zod";
import type { MultichainConfig } from "../modules/blockchain/multichain.client";

export type DbMode = "local" | "cloud";
/** Used when DB_MODE=local and DATABASE_URL_LOCAL is not set. Matches what `npm run db:init` creates. */
export const DEFAULT_LOCAL_DATABASE_URL = "postgresql://textracer:textracer_local@localhost:5432/textracer";

export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  corsOrigins: string[];
  /** "local" = PostgreSQL on this laptop (default). "cloud" = the hosted DATABASE_URL (Supabase/Neon). */
  dbMode: DbMode;
  /** The connection string actually used for the chosen dbMode (never log it: it contains a password). */
  databaseUrl: string | undefined;
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  trustProxy: boolean;
  logRequests: boolean;
  loginRateLimitMax: number; // login attempts per 15 minutes per IP
  deviceRateLimitMax: number; // reader scans per minute per IP
  globalRateLimitMax: number; // all requests per minute per IP
  /** Blockchain layer (MultiChain). Optional: absent/disabled => the app behaves exactly as before. */
  multichain?: MultichainConfig;
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  CORS_ORIGIN: z.string().default("http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"),
  // DB_MODE picks which database is used. DATABASE_URL (cloud) is ONLY read when DB_MODE=cloud.
  DB_MODE: z.enum(["local", "cloud"]).default("local"),
  DATABASE_URL_LOCAL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOG_REQUESTS: z.enum(["true", "false"]).optional(),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  DEVICE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),

  // --- MultiChain blockchain layer (all optional) ---
  MULTICHAIN_ENABLED: z.enum(["true", "false"]).default("true"),
  MULTICHAIN_HOST: z.string().trim().min(1).default("127.0.0.1"),
  MULTICHAIN_PORT: z.coerce.number().int().min(1).max(65535).default(7758),
  MULTICHAIN_RPC_USER: z.string().trim().min(1).default("multichainrpc"),
  MULTICHAIN_RPC_PASSWORD: z.string().optional(),
  MULTICHAIN_CHAIN_NAME: z.string().trim().min(1).default("chain1"),
  MULTICHAIN_STREAM_NAME: z.string().trim().min(1).default("gate_scans"),
  MULTICHAIN_ANCHOR_CHAIN_CODE: z.string().trim().min(1).default("multichain"),
  MULTICHAIN_AUTO_CREATE_STREAM: z.enum(["true", "false"]).default("true"),
  MULTICHAIN_WORKER_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  MULTICHAIN_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MULTICHAIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  MULTICHAIN_MIN_CONFIRMATIONS: z.coerce.number().int().min(0).default(1),
  MULTICHAIN_RPC_TIMEOUT_MS: z.coerce.number().int().min(500).default(10000),
});

/** "8h", "30m", "45s", "2d" or plain seconds -> seconds. */
export function parseDuration(v: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(v.trim());
  if (!m) throw new Error(`Invalid JWT_EXPIRES_IN "${v}" (examples: 8h, 30m, 3600)`);
  const n = Number(m[1]);
  const mult = { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "" | "s" | "m" | "h" | "d"];
  return n * mult;
}

/** Pure function (easy to unit test): validates a raw env object into a Config. */
export function parseConfig(raw: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration (check backend/.env):\n${problems}`);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    corsOrigins: e.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
    dbMode: e.DB_MODE,
    databaseUrl: e.DB_MODE === "cloud" ? e.DATABASE_URL?.trim() || undefined : e.DATABASE_URL_LOCAL?.trim() || DEFAULT_LOCAL_DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    jwtExpiresInSeconds: parseDuration(e.JWT_EXPIRES_IN),
    trustProxy: e.TRUST_PROXY === "true",
    logRequests: e.LOG_REQUESTS ? e.LOG_REQUESTS === "true" : e.NODE_ENV !== "test",
    loginRateLimitMax: e.LOGIN_RATE_LIMIT_MAX,
    deviceRateLimitMax: e.DEVICE_RATE_LIMIT_MAX,
    globalRateLimitMax: e.GLOBAL_RATE_LIMIT_MAX,
    multichain: {
      // Enabled only when switched on AND a password is configured (so a fresh checkout without a node just runs).
      enabled: e.MULTICHAIN_ENABLED === "true" && !!e.MULTICHAIN_RPC_PASSWORD?.trim(),
      host: e.MULTICHAIN_HOST,
      port: e.MULTICHAIN_PORT,
      rpcUser: e.MULTICHAIN_RPC_USER,
      rpcPassword: e.MULTICHAIN_RPC_PASSWORD?.trim() ?? "",
      chainName: e.MULTICHAIN_CHAIN_NAME,
      streamName: e.MULTICHAIN_STREAM_NAME,
      anchorChainCode: e.MULTICHAIN_ANCHOR_CHAIN_CODE,
      autoCreateStream: e.MULTICHAIN_AUTO_CREATE_STREAM === "true",
      workerIntervalMs: e.MULTICHAIN_WORKER_INTERVAL_MS,
      batchSize: e.MULTICHAIN_BATCH_SIZE,
      maxAttempts: e.MULTICHAIN_MAX_ATTEMPTS,
      minConfirmations: e.MULTICHAIN_MIN_CONFIRMATIONS,
      rpcTimeoutMs: e.MULTICHAIN_RPC_TIMEOUT_MS,
    },
  };
}

/** Loads backend/.env (if present) and returns the validated config. */
export function loadConfig(): Config {
  // Loaded lazily so unit tests can import this file without side effects.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config();
  return parseConfig(process.env);
}
