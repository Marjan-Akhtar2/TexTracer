// No database needed: connection-string helpers and plain-language error explanations.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_LOCAL_DATABASE_URL, parseConfig } from "../src/config/env";
import { describeDbTarget, explainDbError, isLocalDbUrl } from "../src/db/pool";

const SECRET = "x".repeat(32);
const env = (o: Record<string, string>) => parseConfig({ JWT_SECRET: SECRET, ...o } as NodeJS.ProcessEnv);

describe("database mode selection", () => {
  test("default is LOCAL and ignores a cloud DATABASE_URL", () => {
    const c = env({ DATABASE_URL: "postgresql://u:secret@db.example.supabase.co:5432/postgres" });
    assert.equal(c.dbMode, "local");
    assert.equal(c.databaseUrl, DEFAULT_LOCAL_DATABASE_URL);
  });
  test("DATABASE_URL_LOCAL overrides the default", () => {
    assert.equal(env({ DATABASE_URL_LOCAL: "postgresql://a:b@localhost:5433/x" }).databaseUrl, "postgresql://a:b@localhost:5433/x");
  });
  test("DB_MODE=cloud uses DATABASE_URL (and nothing when it is unset)", () => {
    assert.equal(env({ DB_MODE: "cloud", DATABASE_URL: "postgresql://c@cloud.example/p" }).databaseUrl, "postgresql://c@cloud.example/p");
    assert.equal(env({ DB_MODE: "cloud" }).databaseUrl, undefined);
  });
  test("rejects an unknown DB_MODE", () => assert.throws(() => env({ DB_MODE: "sqlite" }), /DB_MODE/));
});

describe("connection string helpers", () => {
  test("describeDbTarget never contains the password", () => {
    const t = describeDbTarget("postgresql://textracer:S3cr3t%40pw@localhost:5432/textracer");
    assert.equal(t, "textracer@localhost:5432/textracer");
    assert.ok(!t.includes("S3cr3t"));
    assert.match(describeDbTarget("not a url"), /not a valid/);
  });
  test("isLocalDbUrl", () => {
    assert.ok(isLocalDbUrl("postgresql://a:b@localhost:5432/x"));
    assert.ok(isLocalDbUrl("postgresql://a:b@127.0.0.1/x"));
    assert.ok(!isLocalDbUrl("postgresql://a:b@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"));
  });
});

describe("explainDbError", () => {
  test("maps common failures to a fix", () => {
    assert.match(explainDbError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:5432" }).hint, /Start PostgreSQL/);
    assert.match(explainDbError({ code: "28P01", message: "password authentication failed" }).hint, /password/i);
    assert.match(explainDbError({ code: "3D000", message: "database does not exist" }).hint, /db:init/);
    assert.match(explainDbError(new Error("Connection terminated due to connection timeout")).hint, /timed out/i);
    assert.equal(explainDbError("weird").code, "UNKNOWN");
  });
});
