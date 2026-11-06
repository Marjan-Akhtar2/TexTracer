import type { ZodTypeAny, z } from "zod";
import { AppError } from "./errors";

/** Parse + validate untrusted input. Throws 400 VALIDATION_ERROR with per-field details. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", details);
  }
  return result.data;
}
