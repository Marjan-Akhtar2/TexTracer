import { ok } from "../../core/response";
import { ROLE_CODES, ROLE_LABELS, ROLE_PERMISSIONS, Roles } from "../../core/roles";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";

/** GET /api/roles : the six SRS roles and their permissions (System Administrator only). */
export function createRolesRouter(ctx: ModuleContext): Router {
  return new Router().get("/", ctx.authenticate, requireRole(Roles.ADMIN), () =>
    ok(ROLE_CODES.map((code) => ({ code, label: ROLE_LABELS[code], permissions: ROLE_PERMISSIONS[code] }))),
  );
}
