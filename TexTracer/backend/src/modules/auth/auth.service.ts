import { AppError, unauthorized } from "../../core/errors";
import { signJwt, verifyJwt } from "../../core/jwt";
import { ROLE_LABELS } from "../../core/roles";
import type { Config } from "../../config/env";
import type { UserRecord, UsersRepo } from "../users/users.repo";
import type { AuthUser } from "./auth.types";

export function toAuthUser(u: UserRecord): AuthUser {
  if (!u.role) throw new AppError(403, "NO_ROLE", "This account has no role assigned. Contact the administrator.");
  return {
    id: u.id,
    name: u.fullName,
    email: u.email,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role],
    departmentId: u.departmentId,
    department: u.department,
  };
}

export function createAuthService(users: UsersRepo, config: Pick<Config, "jwtSecret" | "jwtExpiresInSeconds">) {
  return {
    async login(email: string, password: string) {
      const found = await users.verifyLogin(email, password);
      if (!found || !found.passwordOk || !found.user.isActive) {
        throw unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
      }
      const user = toAuthUser(found.user);
      return {
        token: signJwt(user.id, config.jwtSecret, config.jwtExpiresInSeconds),
        tokenType: "Bearer",
        expiresInSeconds: config.jwtExpiresInSeconds,
        user,
      };
    },

    /**
     * Verifies a bearer token and loads the CURRENT user from the database, so deactivation
     * and role changes take effect immediately. Returns null for any invalid case.
     */
    async userFromToken(token: string): Promise<AuthUser | null> {
      const payload = verifyJwt(token, config.jwtSecret);
      if (!payload) return null;
      const record = await users.findById(payload.sub).catch(() => null);
      if (!record || !record.isActive || !record.role) return null;
      return toAuthUser(record);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
