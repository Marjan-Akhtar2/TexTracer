import { unauthorized } from "../core/errors";
import type { Guard } from "../http/types";
import type { AuthService } from "../modules/auth/auth.service";

/** Requires `Authorization: Bearer <token>`; sets `req.user` from the CURRENT database row. */
export function createAuthenticate(auth: Pick<AuthService, "userFromToken">): Guard {
  return async (req) => {
    const header = String(req.headers.authorization ?? "");
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw unauthorized("Missing or malformed Authorization header (expected: Bearer <token>)");
    }
    const user = await auth.userFromToken(token);
    if (!user) throw unauthorized("Invalid or expired token", "INVALID_TOKEN");
    req.user = user;
  };
}
