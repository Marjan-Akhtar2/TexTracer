import { z } from "zod";
import { notFound } from "../../core/errors";
import { ok } from "../../core/response";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createStagesRepo, type StagesRepo } from "./stages.repo";

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** GET /api/stages : process stages, their SLA window, readers and allowed next stages. */
export function createStagesRouter(ctx: ModuleContext, repo: StagesRepo = createStagesRepo(ctx.db)): Router {
  return new Router().use(ctx.authenticate).get("/", async () => {
    const rows = await repo.listStages();
    return ok(rows, { count: rows.length });
  });
}

/** GET /api/readers (any user) and PUT /api/readers/:id/key (System Administrator: provision device key). */
export function createReadersRouter(ctx: ModuleContext, repo: StagesRepo = createStagesRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate);
  router.get("/", async () => {
    const rows = await repo.listReaders();
    return ok(rows, { count: rows.length });
  });
  router.put("/:id/key", requireRole(Roles.ADMIN), async (req) => {
    const out = await repo.provisionReaderKey(parse(idParam, req.params).id);
    if (!out) throw notFound("Reader not found");
    return ok({ ...out, note: "Store this key on the ESP32 now. It is shown only once and cannot be retrieved later." });
  });
  return router;
}
