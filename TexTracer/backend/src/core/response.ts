import type { Reply } from "../http/types";

/**
 * API envelope used by EVERY endpoint:
 *   success: { success: true,  data, meta? }
 *   failure: { success: false, error: { code, message, details? } }
 */
export const ok = <T>(data: T, meta?: Record<string, unknown>, status = 200): Reply => ({
  status,
  body: meta ? { success: true, data, meta } : { success: true, data },
});
export const created = <T>(data: T): Reply => ok(data, undefined, 201);

export function errorBody(code: string, message: string, details?: unknown) {
  return { success: false as const, error: details === undefined ? { code, message } : { code, message, details } };
}
