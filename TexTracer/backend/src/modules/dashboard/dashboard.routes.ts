import { z } from "zod";
import { ok } from "../../core/response";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createDashboardRepo, type DashboardRepo } from "./dashboard.repo";
import { buildStageReport } from "./dashboard.service";

const stalledQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

/**
 * Management dashboard (FR-8, FR-9, NFR-6). READ-ONLY: GET endpoints only, Senior Management only.
 * There are intentionally no POST/PUT/PATCH/DELETE routes here.
 */
export function createDashboardRouter(ctx: ModuleContext, repo: DashboardRepo = createDashboardRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate, requireRole(Roles.MANAGEMENT));
  router.get("/overview", async () => ok(await repo.overview()));
  router.get("/kpis", async () => ok(await repo.kpis()));
  router.get("/stages", async () => ok(buildStageReport(await repo.stages())));
  router.get("/rejection-reasons", async () => ok(await repo.rejectionReasons()));
  router.get("/anchors", async () => ok(await repo.anchors()));
  router.get("/stalled", async (req) => {
    const { limit } = parse(stalledQuery, req.query);
    const items = await repo.stalled(limit);
    return ok(items, { count: items.length });
  });
  return router;
}
