import { created, ok } from "../../core/response";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createUsersRepo, type UsersRepo } from "./users.repo";
import { createUserBody, listUsersQuery, setRoleBody, updateUserBody, uuidParam } from "./users.schemas";
import { createUsersService } from "./users.service";

/** User management: System Administrator only. */
export function createUsersRouter(ctx: ModuleContext, repo: UsersRepo = createUsersRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate, requireRole(Roles.ADMIN));
  const service = createUsersService(repo);

  router.get("/", async (req) => {
    const users = await service.list(parse(listUsersQuery, req.query));
    return ok(users, { count: users.length });
  });
  router.get("/:id", async (req) => ok(await service.get(parse(uuidParam, req.params).id)));
  router.post("/", async (req) => created(await service.create(req.user!.id, parse(createUserBody, req.body))));
  router.patch("/:id", async (req) =>
    ok(await service.update(req.user!.id, parse(uuidParam, req.params).id, parse(updateUserBody, req.body))),
  );
  router.put("/:id/role", async (req) =>
    ok(await service.setRole(req.user!.id, parse(uuidParam, req.params).id, parse(setRoleBody, req.body).role)),
  );
  return router;
}
