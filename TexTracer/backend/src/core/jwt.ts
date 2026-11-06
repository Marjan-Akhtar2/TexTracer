import { createHmac, timingSafeEqual } from "node:crypto";

/** Minimal HS256 JWT (no dependency). Only the algorithm we issue is ever accepted. */
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sig = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export function signJwt(sub: string, secret: string, expiresInSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ sub, iat, exp: iat + expiresInSeconds }));
  return `${head}.${body}.${b64(sig(`${head}.${body}`, secret))}`;
}

/** Returns the payload for a valid, unexpired token signed with `secret`; otherwise null. */
export function verifyJwt(token: string, secret: string, now = Date.now()): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, signature] = parts as [string, string, string];
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as { alg?: string };
    if (header.alg !== "HS256") return null;
    const expected = sig(`${head}.${body}`, secret);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
