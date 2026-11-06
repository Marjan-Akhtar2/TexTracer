import { z } from "zod";
import { AppError, notFound } from "../../core/errors";
import { ok } from "../../core/response";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createProductsRepo, type ProductsRepo } from "../products/products.repo";
import { assertCanSee, PRODUCT_READERS } from "../products/products.routes";
import { createAnchorsRepo, type AnchorsRepo } from "./anchors.repo";
import type { OnChainState } from "./multichain.service";

const idParam = z.object({ id: z.string().uuid("id must be a valid UUID") });

/**
 * Read-only blockchain endpoints (all under /api/blockchain). They add live on-chain checking on top of the
 * existing /api/products/:id/verification, which keeps returning exactly what it did before.
 */
export function createBlockchainRouter(
  ctx: ModuleContext,
  anchors: AnchorsRepo = createAnchorsRepo(ctx.db),
  products: Pick<ProductsRepo, "findById" | "visitedDepartment"> = createProductsRepo(ctx.db),
): Router {
  const router = new Router().use(ctx.authenticate);
  const chain = ctx.blockchain;

  // GET /api/blockchain/status : node connectivity + outbox queue (Auditor, Senior Management, Admin)
  router.get("/status", requireRole(Roles.AUDITOR, Roles.MANAGEMENT, Roles.ADMIN), async () => {
    if (!chain?.enabled) return ok({ enabled: false, note: "Blockchain layer is disabled (set MULTICHAIN_RPC_PASSWORD and MULTICHAIN_ENABLED=true in backend/.env)" });
    const [node, queue] = await Promise.all([chain.status(), anchors.queue(chain.config.anchorChainCode).catch(() => [])]);
    return ok({ enabled: true, anchorChainCode: chain.config.anchorChainCode, node, queue });
  });

  // GET /api/blockchain/products/:id/verify : re-reads every anchor of the product FROM the blockchain and compares
  router.get("/products/:id/verify", requireRole(...PRODUCT_READERS), async (req) => {
    const { id } = parse(idParam, req.params);
    if (!chain?.enabled) throw new AppError(503, "BLOCKCHAIN_DISABLED", "Blockchain layer is not enabled on this server");
    if (!(await products.findById(id))) throw notFound("Product not found");
    await assertCanSee(req, products, id);

    const rows = await anchors.forProduct(id, chain.config.anchorChainCode);
    const results = [];
    for (const a of rows) {
      let state: OnChainState = "not_found";
      let reasons: string[] = [];
      let confirmations = a.confirmations;
      if (!a.dbHashValid) {
        state = "mismatch";
        reasons = ["Database metadata no longer matches its recorded hash"];
      } else if (!a.txHash) {
        state = "pending_confirmation";
        reasons = ["Not yet published to the blockchain (still queued)"];
      } else {
        try {
          const item = await chain.getItem(a.txHash);
          ({ state, reasons } = chain.compare(item, { metadataHash: a.metadataHash, metadataText: a.metadataText, productUid: a.productUid }));
          if (item) confirmations = item.confirmations;
        } catch (err) {
          state = "unavailable";
          reasons = [(err as Error).message];
        }
      }
      const { metadataText: _t, ...publicRow } = a;
      results.push({ ...publicRow, confirmations, onChain: state, reasons });
    }
    return ok(
      { productId: id, chain: chain.config.anchorChainCode, stream: chain.config.streamName, allVerified: results.length > 0 && results.every((r) => r.onChain === "verified"), anchors: results },
      { count: results.length },
    );
  });

  return router;
}
