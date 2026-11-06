/** Every expected failure is thrown as an AppError; the HTTP layer turns it into the JSON envelope. */
export class AppError extends Error {
  headers?: Record<string, string>;
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Authentication required", code = "UNAUTHORIZED") => new AppError(401, code, msg);
export const forbidden = (msg = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Resource not found") => new AppError(404, "NOT_FOUND", msg);
export const conflict = (msg: string, code = "CONFLICT") => new AppError(409, code, msg);
export const unprocessable = (msg: string, code = "UNPROCESSABLE", details?: unknown) =>
  new AppError(422, code, msg, details);
