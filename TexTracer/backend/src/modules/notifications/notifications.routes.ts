import { z } from "zod";
import { notFound } from "../../core/errors";
import { ok } from "../../core/response";
import { offsetOf, pageMeta, pageQuery } from "../../core/pagination";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import type { ModuleContext } from "../../routes/context";
import { createNotificationsRepo, type NotificationsRepo } from "./notifications.repo";

const listQuery = pageQuery.extend({ unread: z.enum(["true", "false"]).transform((v) => v === "true").optional() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** In-app notifications (NFR-4). The frontend polls GET /api/notifications?unread=true. */
export function createNotificationsRouter(ctx: ModuleContext, repo: NotificationsRepo = createNotificationsRepo(ctx.db)): Router {
  const router = new Router().use(ctx.authenticate);
  router.get("/", async (req) => {
    const q = parse(listQuery, req.query);
    const { rows, total } = await repo.list(req.user!, q.unread === true, q.limit, offsetOf(q.page, q.limit));
    return ok(rows, pageMeta(q.page, q.limit, total));
  });
  router.post("/:id/read", async (req) => {
    const row = await repo.markRead(req.user!, parse(idParam, req.params).id);
    if (!row) throw notFound("Notification not found");
    return ok(row);
  });
  return router;
}
