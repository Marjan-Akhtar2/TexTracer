import { AppError } from "../core/errors";
import type { Guard } from "./types";

/** Fixed-window in-memory limiter (per process). Fine for one backend instance. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    const timer = setInterval(() => this.sweep(), Math.max(1000, windowMs));
    timer.unref();
  }
  private sweep() {
    const t = this.now();
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
  /** Returns seconds to wait if the key is over the limit, otherwise 0. */
  check(key: string): number {
    const t = this.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return 0;
    }
    cur.count += 1;
    return cur.count > this.max ? Math.ceil((cur.resetAt - t) / 1000) : 0;
  }
}

export function tooManyRequests(retryAfter: number): AppError {
  const e = new AppError(429, "RATE_LIMITED", "Too many requests. Please wait and try again.");
  e.headers = { "Retry-After": String(retryAfter) };
  return e;
}

export const rateLimit = (limiter: RateLimiter, keyOf: (ip: string) => string = (ip) => ip): Guard => (req) => {
  const wait = limiter.check(keyOf(req.ip));
  if (wait > 0) throw tooManyRequests(wait);
};
