import { z } from "zod";
import { AppError, forbidden, unauthorized } from "../../core/errors";
import { created, ok } from "../../core/response";
import { offsetOf, pageMeta, pageQuery } from "../../core/pagination";
import { Roles } from "../../core/roles";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { rateLimit } from "../../http/rateLimit";
import type { Reply } from "../../http/types";
import { requireRole } from "../../middleware/requireRole";
import type { ModuleContext } from "../../routes/context";
import { createProductsRepo, type ProductsRepo } from "../products/products.repo";
import { DeviceActivity } from "./deviceActivity";
import { createScansRepo, type ScanOutcome, type ScansRepo } from "./scans.repo";

const uid = z.string().trim().toUpperCase().regex(/^[0-9A-F]{8,20}$/, "RFID UID must be 8-20 hex characters (0-9, A-F)");
const readerCode = z.string().trim().min(1).max(40);
const scanBody = z.object({ rfidUid: uid, readerCode });
const deviceBody = scanBody.extend({ deviceTimestamp: z.string().datetime({ offset: true }).optional() });
const listQuery = pageQuery.extend({
  result: z.enum(["accepted", "duplicate", "rejected_unknown_tag", "rejected_unknown_reader", "rejected_out_of_sequence", "rejected_gate_not_approved", "rejected_product_blocked"]).optional(),
  uid: uid.optional(),
  productId: z.string().uuid().optional(),
  readerCode: readerCode.optional(),
});

/**
 * Turns the database verdict into an HTTP reply.
 *  accepted -> 201, duplicate -> 200 (harmless repeat), unknown tag/reader -> 404, other rejections -> 422.
 * Every attempt (accepted or not) is already written to scan_logs by record_scan().
 */
export function scanReply(o: ScanOutcome, product: unknown): Reply {
  const info = { result: o.result, productId: o.productId, fromStage: o.fromStage, toStage: o.toStage, detail: o.detail };
  if (o.result === "accepted") return created({ ...info, product });
  if (o.result === "duplicate") return ok({ ...info, product });
  const status = o.result === "rejected_unknown_tag" || o.result === "rejected_unknown_reader" ? 404 : 422;
  throw new AppError(status, "SCAN_REJECTED", o.detail ?? "Scan rejected", info);
}

export function createScansRouter(
  ctx: ModuleContext,
  repo: ScansRepo = createScansRepo(ctx.db),
  products: ProductsRepo = createProductsRepo(ctx.db),
): Router {
  const router = new Router();

  // POST /api/scans : a Department Officer scans an item at a reader of THEIR OWN department
  router.post("/", ctx.authenticate, requireRole(Roles.OFFICER), async (req) => {
    const b = parse(scanBody, req.body);
    const user = req.user!;
    const reader = await repo.findReader(b.readerCode);
    if (reader && reader.departmentId !== user.departmentId) {
      throw forbidden(`Reader ${reader.code} belongs to ${reader.department}, not your department`);
    }
    // Unknown readers fall through to record_scan(), which logs them as rejected_unknown_reader.
    const outcome = await repo.record(b.rfidUid, b.readerCode, user.id, null);
    const product = outcome.productId && (outcome.result === "accepted" || outcome.result === "duplicate")
      ? await products.findById(outcome.productId) : null;
    return scanReply(outcome, product);
  });

  // POST /api/scans/device : the ESP32 posts here, authenticated by the reader's own key (header X-Reader-Key)
  const activity = new DeviceActivity();
  router.post("/device", rateLimit(ctx.limiters.device), async (req) => {
    const rawBody = (req.body ?? {}) as { rfidUid?: unknown; readerCode?: unknown };
    const seenReader = typeof rawBody.readerCode === "string" ? rawBody.readerCode.slice(0, 40) : null;
    const seenUid = typeof rawBody.rfidUid === "string" ? rawBody.rfidUid.slice(0, 20).toUpperCase() : null;
    const note = (httpStatus: number, outcome: string, message: string | null) =>
      activity.record({ ip: req.ip, readerCode: seenReader, rfidUid: seenUid, httpStatus, outcome, message });
    try {
      const key = String(req.headers["x-reader-key"] ?? "");
      const b = parse(deviceBody, req.body);
      if (!key) throw unauthorized("Missing X-Reader-Key header", "INVALID_DEVICE_KEY");
      const reader = await repo.authenticateDevice(b.readerCode, key);
      if (!reader) throw unauthorized("Unknown reader or wrong device key (or the reader has no key yet / is inactive)", "INVALID_DEVICE_KEY");
      const outcome = await repo.record(b.rfidUid, reader.code, null, b.deviceTimestamp ?? null);
      const product = outcome.productId && (outcome.result === "accepted" || outcome.result === "duplicate")
        ? await products.findById(outcome.productId) : null;
      const reply = scanReply(outcome, product);
      note(reply.status, outcome.result, outcome.detail);
      return reply;
    } catch (err) {
      if (err instanceof AppError) {
        const d = err.details as { result?: string } | undefined;
        note(err.status, d?.result ?? err.code, err.message);
      } else note(500, "INTERNAL_ERROR", (err as Error).message);
      throw err;
    }
  });

  // GET /api/scans/device-activity : what the readers are doing RIGHT NOW (incl. failed/unauthorised attempts)
  router.get("/device-activity", ctx.authenticate, requireRole(Roles.ADMIN, Roles.WAREHOUSE, Roles.AUDITOR, Roles.MANAGEMENT), async () => ok(activity.snapshot()));

  // GET /api/scans/unregistered : tags tapped on a reader that are not registered to any product yet
  router.get("/unregistered", ctx.authenticate, requireRole(Roles.WAREHOUSE, Roles.ADMIN), async (req) => {
    const q = parse(z.object({ minutes: z.coerce.number().int().min(1).max(10080).default(1440), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
    return ok(await repo.unregistered(q.minutes, q.limit));
  });

  // GET /api/scans : scan log. Officers see only their department's readers.
  router.get("/", ctx.authenticate, requireRole(Roles.OFFICER, Roles.AUDITOR, Roles.MANAGEMENT, Roles.WAREHOUSE, Roles.ADMIN), async (req) => {
    const q = parse(listQuery, req.query);
    const u = req.user!;
    const filter = {
      ...(q.result && { result: q.result }),
      ...(q.uid && { uid: q.uid }),
      ...(q.productId && { productId: q.productId }),
      ...(q.readerCode && { readerCode: q.readerCode }),
      ...(u.role === Roles.OFFICER && { departmentId: u.departmentId ?? -1 }),
    };
    const { rows, total } = await repo.list(filter, q.limit, offsetOf(q.page, q.limit));
    return ok(rows, pageMeta(q.page, q.limit, total));
  });

  return router;
}
