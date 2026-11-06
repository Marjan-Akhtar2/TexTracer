import { z } from "zod";
import { notFound } from "../../core/errors";
import { created, ok } from "../../core/response";
import { Roles } from "../../core/roles";
import { offsetOf, pageMeta, pageQuery } from "../../core/pagination";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createPurchaseOrdersRepo, type PurchaseOrdersRepo } from "./purchase-orders.repo";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const createBody = z.object({
  poNumber: z.string().trim().min(1).max(50),
  supplierName: z.string().trim().min(1).max(120),
  materialDescription: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(9_999_999_999),
});

/** Purchase orders (Gate 1 reviews raw material against them). Read: any user. Create: Warehouse Manager. */
export function createPurchaseOrdersRouter(ctx: ModuleContext, repo: PurchaseOrdersRepo = createPurchaseOrdersRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate);
  router.get("/", async (req) => {
    const { page, limit } = parse(pageQuery, req.query);
    const { rows, total } = await repo.list(limit, offsetOf(page, limit));
    return ok(rows, pageMeta(page, limit, total));
  });
  router.get("/:id", async (req) => {
    const po = await repo.findById(parse(idParam, req.params).id);
    if (!po) throw notFound("Purchase order not found");
    return ok(po);
  });
  router.post("/", requireRole(Roles.WAREHOUSE), async (req) =>
    created(await repo.create({ ...parse(createBody, req.body), createdBy: req.user!.id })),
  );
  return router;
}
