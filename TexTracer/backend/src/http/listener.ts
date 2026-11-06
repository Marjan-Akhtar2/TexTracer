import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { Config } from "../config/env";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { errorBody } from "../core/response";
import type { Router } from "./router";
import type { RateLimiter } from "./rateLimit";
import { tooManyRequests } from "./rateLimit";
import type { Reply, Req } from "./types";

const MAX_BODY_BYTES = 100 * 1024;

// Postgres error codes -> HTTP. P0001 = our own RAISE EXCEPTION messages in record_decision().
const PG: Record<string, [number, string, string?]> = {
  "23505": [409, "CONFLICT", "A record with these values already exists"],
  "23503": [422, "INVALID_REFERENCE", "A referenced record does not exist"],
  "23514": [422, "CONSTRAINT_VIOLATION", "The data violates a database rule"],
  "22P02": [400, "BAD_REQUEST", "Malformed value in request"],
  "22003": [400, "BAD_REQUEST", "Numeric value out of range"],
  "42501": [403, "FORBIDDEN", "The database refused the operation (insufficient privilege)"],
  "23000": [422, "CONSTRAINT_VIOLATION", "The data violates a database rule"],
  "P0001": [422, "WORKFLOW_RULE"],
  "44000": [422, "WORKFLOW_RULE"],
  "25P02": [500, "INTERNAL_ERROR"],
};

export function toErrorReply(err: unknown, logger?: Logger): { reply: Reply; headers?: Record<string, string> } {
  if (err instanceof AppError) {
    const out: { reply: Reply; headers?: Record<string, string> } = {
      reply: { status: err.status, body: errorBody(err.code, err.message, err.details) },
    };
    if (err.headers) out.headers = err.headers;
    return out;
  }
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string" && PG[code]) {
    const [status, c, fixed] = PG[code]!;
    if (status < 500) {
      // Only our own database-function messages (P0001) are safe to show verbatim.
      const message = fixed ?? (err as Error).message;
      return { reply: { status, body: errorBody(c, message) } };
    }
  }
  logger?.error("unhandled error", err);
  return { reply: { status: 500, body: errorBody("INTERNAL_ERROR", "Something went wrong on the server") } };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      const tooLarge = new AppError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
      tooLarge.headers = { Connection: "close" }; // do not reuse a connection that still has an unread body
      throw tooLarge;
    }
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "BAD_JSON", "Request body is not valid JSON");
  }
}

export interface ListenerOptions {
  router: Router;
  config: Pick<Config, "corsOrigins" | "trustProxy">;
  logger: Logger;
  globalLimiter?: RateLimiter;
}

export function createListener({ router, config, logger, globalLimiter }: ListenerOptions): RequestListener {
  const send = (res: ServerResponse, reply: Reply, extra?: Record<string, string>) => {
    const payload = reply.status === 204 ? "" : JSON.stringify(reply.body);
    res.writeHead(reply.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      ...extra,
    });
    res.end(payload);
  };

  return async (incoming, res) => {
    const started = Date.now();
    let status = 500;
    let method = incoming.method ?? "GET";
    let path = "/";
    try {
      // Security headers on every response
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");

      // CORS: only allow-listed browser origins
      const origin = incoming.headers.origin;
      if (origin && config.corsOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Reader-Key");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
      }

      const url = new URL(incoming.url ?? "/", "http://localhost");
      path = url.pathname;
      method = incoming.method ?? "GET";

      if (method === "OPTIONS") {
        status = 204;
        return send(res, { status: 204, body: null });
      }

      const fwd = config.trustProxy ? String(incoming.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "";
      const ip = fwd || incoming.socket.remoteAddress || "unknown";

      if (globalLimiter) {
        const wait = globalLimiter.check(ip);
        if (wait > 0) throw tooManyRequests(wait);
      }

      const body = ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? await readJson(incoming) : undefined;
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (query[k] = v));

      const found = router.resolve(method, path.split("/").filter(Boolean));
      if (!found) {
        throw new AppError(404, "NOT_FOUND", `Route not found: ${method} ${path}`);
      }
      const req: Req = { method, path, params: found.params, query, body, headers: incoming.headers, ip };
      for (const guard of found.guards) await guard(req);
      const reply = await found.handler(req);
      status = reply.status;
      send(res, reply);
    } catch (err) {
      const { reply, headers } = toErrorReply(err, logger);
      status = reply.status;
      send(res, reply, headers);
    } finally {
      logger.info(`${method} ${path} -> ${status} (${Date.now() - started}ms)`);
    }
  };
}
