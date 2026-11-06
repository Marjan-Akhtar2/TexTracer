import { z } from "zod";
import { notFound } from "../../core/errors";
import { ok } from "../../core/response";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import type { ModuleContext } from "../../routes/context";
import { createDepartmentsRepo, type DepartmentsRepo } from "./departments.repo";

const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Departments are reference data (the application's database role is SELECT-only on them),
 * so the API is read-only. Any logged-in role may read.
 */
export function createDepartmentsRouter(ctx: ModuleContext, repo: DepartmentsRepo = createDepartmentsRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate);
  router.get("/", async () => {
    const rows = await repo.list();
    return ok(rows, { count: rows.length });
  });
  router.get("/:id", async (req) => {
    const dep = await repo.findById(parse(idParam, req.params).id);
    if (!dep) throw notFound("Department not found");
    return ok(dep);
  });
  return router;
}
