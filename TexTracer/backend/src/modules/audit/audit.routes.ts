import { z } from "zod";
import { ok } from "../../core/response";
import { offsetOf, pageMeta, pageQuery } from "../../core/pagination";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createAuditRepo, type AuditRepo } from "./audit.repo";

const dt = z.string().datetime({ offset: true });
const decisionsQuery = pageQuery.extend({
  gate: z.enum(["gate1_intake", "gate2_qc", "gate3_shipment"]).optional(),
  decision: z.enum(["approved", "rejected", "ready_for_shipment"]).optional(),
  productId: z.string().uuid().optional(),
  uid: z.string().trim().toUpperCase().regex(/^[0-9A-F]{8,20}$/).optional(),
  reasonCode: z.string().trim().min(1).max(40).optional(),
  from: dt.optional(),
  to: dt.optional(),
});
const transitionsQuery = pageQuery.extend({
  productId: z.string().uuid().optional(),
  kind: z.enum(["initial", "forward", "rework"]).optional(),
  from: dt.optional(),
  to: dt.optional(),
});

const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * Auditor's read-only global view (FR-6, NFR-6). Only GET routes exist here, so there is
 * no endpoint through which history can be edited or deleted (and the database triggers forbid it too).
 */
export function createAuditRouter(ctx: ModuleContext, repo: AuditRepo = createAuditRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate, requireRole(Roles.AUDITOR));

  // GET /api/audit/decisions : every approval / rejection / ready-for-shipment decision with anchor status
  router.get("/decisions", async (req) => {
    const { page, limit, ...f } = parse(decisionsQuery, req.query);
    const { rows, total } = await repo.decisions(strip(f), limit, offsetOf(page, limit));
    return ok(rows, pageMeta(page, limit, total));
  });

  // GET /api/audit/transitions : the append-only stage-transition log (with hash-chain values)
  router.get("/transitions", async (req) => {
    const { page, limit, ...f } = parse(transitionsQuery, req.query);
    const { rows, total } = await repo.transitions(strip(f), limit, offsetOf(page, limit));
    return ok(rows, pageMeta(page, limit, total));
  });

  return router;
}
