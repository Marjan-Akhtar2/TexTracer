import { Router } from "../http/router";
import { createApprovalsRouter } from "../modules/approvals/approvals.routes";
import { createAuditRouter } from "../modules/audit/audit.routes";
import { createAuthRouter } from "../modules/auth/auth.routes";
import { createBlockchainRouter } from "../modules/blockchain";
import { createDashboardRouter } from "../modules/dashboard/dashboard.routes";
import type { DashboardRepo } from "../modules/dashboard/dashboard.repo";
import { createDepartmentsRouter } from "../modules/departments/departments.routes";
import type { DepartmentsRepo } from "../modules/departments/departments.repo";
import { createNotificationsRouter } from "../modules/notifications/notifications.routes";
import { createProductsRouter } from "../modules/products/products.routes";
import { createPurchaseOrdersRouter } from "../modules/purchase-orders/purchase-orders.routes";
import { createReworkRouter } from "../modules/rework/rework.routes";
import { createRolesRouter } from "../modules/roles/roles.routes";
import { createScansRouter } from "../modules/scans/scans.routes";
import { createReadersRouter, createStagesRouter } from "../modules/stages/stages.routes";
import { createUsersRouter } from "../modules/users/users.routes";
import type { UsersRepo } from "../modules/users/users.repo";
import type { ModuleContext } from "./context";

/** Optional replacements (used by tests to run without a database). */
export interface RepoOverrides {
  users?: UsersRepo;
  departments?: DepartmentsRepo;
  dashboard?: DashboardRepo;
}

/** The route table: every endpoint lives under /api. */
export function createApiRouter(ctx: ModuleContext, repos: RepoOverrides = {}): Router {
  return new Router()
    .mount("/auth", createAuthRouter(ctx))
    .mount("/users", createUsersRouter(ctx, repos.users))
    .mount("/roles", createRolesRouter(ctx))
    .mount("/departments", createDepartmentsRouter(ctx, repos.departments))
    .mount("/stages", createStagesRouter(ctx))
    .mount("/readers", createReadersRouter(ctx))
    .mount("/purchase-orders", createPurchaseOrdersRouter(ctx))
    .mount("/products", createProductsRouter(ctx))
    .mount("/scans", createScansRouter(ctx))
    .mount("/approvals", createApprovalsRouter(ctx))
    .mount("/rework", createReworkRouter(ctx))
    .mount("/notifications", createNotificationsRouter(ctx))
    .mount("/audit", createAuditRouter(ctx))
    .mount("/blockchain", createBlockchainRouter(ctx))
    .mount("/dashboard", createDashboardRouter(ctx, repos.dashboard));
}
