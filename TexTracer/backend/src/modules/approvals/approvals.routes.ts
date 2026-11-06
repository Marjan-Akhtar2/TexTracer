import { z } from "zod";
import { forbidden, notFound, unprocessable } from "../../core/errors";
import { created, ok } from "../../core/response";
import { offsetOf, pageMeta, pageQuery } from "../../core/pagination";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import type { AuthUser } from "../auth/auth.types";
import { createProductsRepo, type ProductRow, type ProductsRepo } from "../products/products.repo";
import { assertCanSee, PRODUCT_READERS } from "../products/products.routes";
import { createApprovalsRepo, type ApprovalsRepo } from "./approvals.repo";

const GATES = ["gate1_intake", "gate2_qc", "gate3_shipment"] as const;
type Gate = (typeof GATES)[number];
const gateQuery = z.object({ gate: z.enum(GATES).optional() });
const productParam = z.object({ productId: z.string().uuid("productId must be a valid UUID") });

const decisionBody = z
  .object({
    gate: z.enum(GATES),
    decision: z.enum(["approved", "rejected", "ready_for_shipment"]),
    reasonCode: z.string().trim().min(1).max(40).optional(),
    notes: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.gate === "gate3_shipment") !== (v.decision === "ready_for_shipment")) {
      ctx.addIssue({ code: "custom", path: ["decision"], message: v.gate === "gate3_shipment" ? "Gate 3 only accepts 'ready_for_shipment'" : "Gates 1 and 2 accept 'approved' or 'rejected'" });
    }
    if (v.decision === "rejected" && !v.reasonCode) {
      ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "A reason code is required when rejecting" });
    }
    if (v.decision !== "rejected" && v.reasonCode) {
      ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "reasonCode is only allowed when rejecting" });
    }
  });

/** Who may decide at each gate (also enforced again inside the database function). */
export function canDecide(user: Pick<AuthUser, "role" | "department">, gate: Gate): boolean {
  if (gate === "gate1_intake") return user.role === Roles.WAREHOUSE;
  if (gate === "gate2_qc") return user.role === Roles.QC;
  return user.role === Roles.OFFICER && user.department === "Packaging"; // Gate 3: Packaging department officer
}

/** Which single gate a role works on (null = may look at all gates, read-only). */
const gateOfRole = (u: AuthUser): Gate | null =>
  u.role === Roles.WAREHOUSE ? "gate1_intake" : u.role === Roles.QC ? "gate2_qc" : u.role === Roles.OFFICER ? "gate3_shipment" : null;

function whyNotDecidable(p: ProductRow, gate: Gate): string {
  if (p.status === "rejected" || p.status === "shipped") return `Product is ${p.status} and can no longer be decided on`;
  const need = { gate1_intake: "intake", gate2_qc: "production", gate3_shipment: "packaging" }[gate];
  if (p.stage !== need) return `${gate} requires the product to be at '${need}', but it is at '${p.stage}'`;
  return `${gate} has already been decided for this product`;
}

export function createApprovalsRouter(
  ctx: ModuleContext,
  repo: ApprovalsRepo = createApprovalsRepo(ctx.db),
  products: ProductsRepo = createProductsRepo(ctx.db),
): Router {
  const router = new Router().use(ctx.authenticate);

  // GET /api/approvals/pending?gate=  : items waiting for a decision (each role sees its own gate)
  router.get("/pending", requireRole(Roles.WAREHOUSE, Roles.QC, Roles.OFFICER, Roles.AUDITOR, Roles.MANAGEMENT), async (req) => {
    const q = parse(gateQuery.merge(pageQuery), req.query);
    const u = req.user!;
    const own = gateOfRole(u);
    if (u.role === Roles.OFFICER && u.department !== "Packaging") {
      throw forbidden("Only Packaging officers have an approval gate (Gate 3)");
    }
    if (own && q.gate && q.gate !== own) throw forbidden("You can only view the approval queue of your own gate");
    const gate = own ?? q.gate; // read-only roles may pick a gate or see them all
    const { rows, total } = await products.list({ awaitingGate: gate ?? "any" }, q.limit, offsetOf(q.page, q.limit));
    return ok(rows, { ...pageMeta(q.page, q.limit, total), gate: gate ?? "all" });
  });

  // GET /api/approvals/reason-codes?gate=
  router.get("/reason-codes", async (req) => {
    const { gate } = parse(gateQuery, req.query);
    return ok(await repo.reasonCodes(gate));
  });

  // GET /api/approvals/:productId/decisions : full decision history (originals are never overwritten)
  router.get("/:productId/decisions", requireRole(...PRODUCT_READERS), async (req) => {
    const { productId } = parse(productParam, req.params);
    if (!(await products.findById(productId))) throw notFound("Product not found");
    await assertCanSee(req, products, productId);
    const rows = await repo.decisions(productId);
    return ok(rows, { count: rows.length });
  });

  // POST /api/approvals/:productId/decisions : approve / reject / ready-for-shipment
  router.post("/:productId/decisions", requireRole(Roles.WAREHOUSE, Roles.QC, Roles.OFFICER), async (req) => {
    const { productId } = parse(productParam, req.params);
    const b = parse(decisionBody, req.body);
    const user = req.user!;
    if (!canDecide(user, b.gate)) throw forbidden(`Your role is not allowed to decide at ${b.gate}`);

    const product = await products.findById(productId);
    if (!product) throw notFound("Product not found");
    if (product.awaitingGate !== b.gate) throw unprocessable(whyNotDecidable(product, b.gate), "GATE_NOT_AVAILABLE");
    if (b.gate === "gate2_qc" && product.status === "rework" && !product.reworkCompleted) {
      throw unprocessable("Rework must be completed by Production before this item can pass QC again", "REWORK_NOT_COMPLETED");
    }

    const inspectionId = await repo.record({
      productId, gate: b.gate, decision: b.decision, actorId: user.id, reasonCode: b.reasonCode ?? null, notes: b.notes ?? null,
    });
    return created({ decision: await repo.decision(inspectionId), product: await products.findById(productId) });
  });

  return router;
}
