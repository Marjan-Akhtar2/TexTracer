import type { IncomingHttpHeaders } from "node:http";
import type { AuthUser } from "../modules/auth/auth.types";

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: IncomingHttpHeaders;
  ip: string;
  /** Set by the `authenticate` guard. */
  user?: AuthUser;
}
export interface Reply {
  status: number;
  body: unknown;
}
export type Handler = (req: Req) => Promise<Reply> | Reply;
/** A guard runs before the handler and throws an AppError to stop the request. */
export type Guard = (req: Req) => Promise<void> | void;
