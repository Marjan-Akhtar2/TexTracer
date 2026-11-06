import { z } from "zod";
import { forbidden, notFound } from "../../core/errors";
import { created, ok } from "../../core/response";
import { offsetOf, pageMeta, pageQuery } from "../../core/pagination";
import { Roles, type RoleCode } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import type { Req } from "../../http/types";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createProductsRepo, type ProductsRepo, type TimelineEvent } from "./products.repo";

/** Roles that may read product data. (System Administrator manages accounts only.) */
export const PRODUCT_READERS: RoleCode[] = [Roles.OFFICER, Roles.WAREHOUSE, Roles.QC, Roles.AUDITOR, Roles.MANAGEMENT];

const STATUSES = ["active", "rework", "rejected", "ready_for_shipment", "shipped"] as const;
const STAGES = ["intake", "raw_material_1", "raw_material_2", "design", "manufacturing_1", "manufacturing_2", "production", "stitching", "packaging", "shipping"] as const;
const GATES = ["gate1_intake", "gate2_qc", "gate3_shipment"] as const;

const listQuery = pageQuery.extend({
  status: z.enum(STATUSES).optional(),
  stage: z.enum(STAGES).optional(),
  awaitingGate: z.enum(GATES).optional(),
  poId: z.coerce.number().int().positive().optional(),
  stalled: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  search: z.string().trim().min(1).max(60).optional(),
});
const idParam = z.object({ id: z.string().uuid("id must be a valid UUID") });
const uidParam = z.object({ uid: z.string().trim().toUpperCase().regex(/^[0-9A-F]{8,20}$/, "RFID UID must be 8-20 hex characters") });
const registerBody = z.object({
  rfidUid: z.string().trim().toUpperCase().regex(/^[0-9A-F]{8,20}$/, "RFID UID must be 8-20 hex characters (0-9, A-F)"),
  poId: z.number().int().positive(),
  receivedQty: z.number().positive().max(9_999_999_999),
  batchCode: z.string().trim().min(1).max(60).nullable().optional(),
  description: z.string().trim().min(1).max(300).nullable().optional(),
  notes: z.string().trim().min(1).max(500).nullable().optional(),
});

/** Department Officers only see products in / through their own department. */
export async function assertCanSee(req: Req, repo: Pick<ProductsRepo, "visitedDepartment">, productId: string) {
  const u = req.user!;
  if (u.role !== Roles.OFFICER) return;
  if (u.departmentId === null || !(await repo.visitedDepartment(productId, u.departmentId))) {
    throw forbidden("This product has not been in your department");
  }
}

export function createProductsRouter(ctx: ModuleContext, repo: ProductsRepo = createProductsRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate);
  const read = requireRole(...PRODUCT_READERS);

  // GET /api/products?status=&stage=&search=&awaitingGate=&stalled=&poId=&page=&limit=
  router.get("/", read, async (req) => {
    const q = parse(listQuery, req.query);
    const u = req.user!;
    const filter = {
      ...(q.status && { status: q.status }),
      ...(q.stage && { stage: q.stage }),
      ...(q.search && { search: q.search }),
      ...(q.poId !== undefined && { poId: q.poId }),
      ...(q.stalled !== undefined && { stalled: q.stalled }),
      ...(q.awaitingGate && { awaitingGate: q.awaitingGate }),
      ...(u.role === Roles.OFFICER && { departmentId: u.departmentId ?? -1 }),
    };
    const { rows, total } = await repo.list(filter, q.limit, offsetOf(q.page, q.limit));
    return ok(rows, pageMeta(q.page, q.limit, total));
  });

  // POST /api/products  (Warehouse Manager registers received raw material + its RFID tag)
  router.post("/", requireRole(Roles.WAREHOUSE), async (req) => {
    const b = parse(registerBody, req.body);
    const id = await repo.register({
      rfidUid: b.rfidUid, poId: b.poId, batchCode: b.batchCode ?? null, description: b.description ?? null,
      receivedQty: b.receivedQty, notes: b.notes ?? null, receivedBy: req.user!.id,
    });
    return created(await detail(id));
  });

  async function detail(id: string) {
    const product = await repo.findById(id);
    if (!product) throw notFound("Product not found");
    const [receipt, decisions, nextStages] = await Promise.all([
      repo.receipt(id), repo.currentDecisions(id), repo.nextStages(product.stage),
    ]);
    const idleSeconds = Math.max(0, Math.round((Date.now() - new Date(product.lastScanAt).getTime()) / 1000));
    return { ...product, idleSeconds, receipt, currentDecisions: decisions, nextStages };
  }

  // GET /api/products/by-uid/:uid
  router.get("/by-uid/:uid", read, async (req) => {
    const p = await repo.findByUid(parse(uidParam, req.params).uid);
    if (!p) throw notFound("No product is registered for this RFID UID");
    await assertCanSee(req, repo, p.id);
    return ok(await detail(p.id));
  });

  // GET /api/products/:id
  router.get("/:id", read, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await repo.findById(id))) throw notFound("Product not found");
    await assertCanSee(req, repo, id);
    return ok(await detail(id));
  });

  // GET /api/products/:id/history : transitions + gate decisions + scans, oldest first
  router.get("/:id/history", read, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await repo.findById(id))) throw notFound("Product not found");
    await assertCanSee(req, repo, id);
    const h = await repo.history(id);
    const timeline: TimelineEvent[] = [...h.transitions, ...h.decisions, ...h.scans].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    return ok({ productId: id, ...h, timeline }, { count: timeline.length });
  });

  // GET /api/products/:id/verification : hash-chain check + anchor status (FR-17)
  router.get("/:id/verification", read, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!(await repo.findById(id))) throw notFound("Product not found");
    await assertCanSee(req, repo, id);
    const v = await repo.verification(id);
    return ok({
      productId: id,
      ...v,
      onChainVerification: ctx.blockchain?.enabled ? "available" : "not_available",
      note: ctx.blockchain?.enabled
        ? "chainValid checks the database hash chain. Anchor rows show MultiChain publish/confirmation status; GET /api/blockchain/products/:id/verify re-reads each anchor from the blockchain."
        : "chainValid checks the database hash chain. Anchor rows show queue status; the blockchain layer is not enabled (set MULTICHAIN_RPC_PASSWORD in backend/.env).",
    });
  });

  return router;
}
