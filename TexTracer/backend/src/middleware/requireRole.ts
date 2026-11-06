import { forbidden, unauthorized } from "../core/errors";
import type { RoleCode } from "../core/roles";
import type { Guard } from "../http/types";

/**
 * Server-side authorization. Always placed AFTER `authenticate`:
 *   router.post("/x", ctx.authenticate, requireRole(Roles.QC), handler)
 * Hiding a button in the UI is never enough - this is what actually protects the data.
 */
export function requireRole(...allowed: RoleCode[]): Guard {
  return (req) => {
    if (!req.user) throw unauthorized();
    if (!allowed.includes(req.user.role)) {
      throw forbidden(`This action requires one of these roles: ${allowed.join(", ")}`);
    }
  };
}
