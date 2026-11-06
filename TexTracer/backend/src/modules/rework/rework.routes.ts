import { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../../core/errors";
import { created, ok } from "../../core/response";
import { offsetOf, pageMeta, pageQuery } from "../../core/pagination";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createProductsRepo, type ProductsRepo } from "../products/products.repo";
import { createReworkRepo, type ReworkRepo } from "./rework.repo";

const productParam = z.object({ productId: z.string().uuid("productId must be a valid UUID") });
const completeBody = z.object({ notes: z.string().trim().min(1).max(500).optional() }).default({});

/**
 * Rework loop (FR-4, FR-18). A Gate 2 rejection (approvals module) puts the item in status 'rework' at Production.
 * Production officers mark the rework done here; QC can then decide on it again. Nothing is ever deleted or edited.
 */
export function createReworkRouter(
  ctx: ModuleContext,
  repo: ReworkRepo = createReworkRepo(ctx.db),
  products: ProductsRepo = createProductsRepo(ctx.db),
): Router {
  const router = new Router().use(ctx.authenticate, requireRole(Roles.OFFICER, Roles.QC, Roles.AUDITOR, Roles.MANAGEMENT));

  // GET /api/rework : all items currently in rework with the QC rejection reason
  router.get("/", async (req) => {
    const { page, limit } = parse(pageQuery, req.query);
    const u = req.user!;
    if (u.role === Roles.OFFICER && u.department !== "Production") throw forbidden("Rework is handled by the Production department");
    const { rows, total } = await repo.list(limit, offsetOf(page, limit));
    return ok(rows, pageMeta(page, limit, total));
  });

  // GET /api/rework/:productId : complete rework history (QC decisions, rework loops, completions)
  router.get("/:productId", async (req) => {
    const { productId } = parse(productParam, req.params);
    if (!(await products.findById(productId))) throw notFound("Product not found");
    return ok({ productId, ...(await repo.history(productId)) });
  });

  // POST /api/rework/:productId/complete : Production officer reports the rework as done
  router.post("/:productId/complete", requireRole(Roles.OFFICER), async (req) => {
    const { productId } = parse(productParam, req.params);
    const { notes } = parse(completeBody, req.body);
    const u = req.user!;
    if (u.department !== "Production") throw forbidden("Only Production officers can complete rework");
    const p = await products.findById(productId);
    if (!p) throw notFound("Product not found");
    if (p.status !== "rework" || p.stage !== "production") {
      throw unprocessable("This item is not in rework at Production", "NOT_IN_REWORK");
    }
    if (p.reworkCompleted) throw conflict("Rework has already been marked complete; waiting for QC re-inspection", "ALREADY_COMPLETED");
    const id = await repo.markCompleted(productId, u.id, u.name, p.rfidUid, notes ?? null);
    return created({ notificationId: id, product: await products.findById(productId) });
  });

  return router;
}
