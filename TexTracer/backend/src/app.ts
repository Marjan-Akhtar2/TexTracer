import { createServer, type Server } from "node:http";
import type { Config } from "./config/env";
import { createLogger } from "./core/logger";
import { ok } from "./core/response";
import { unavailableDb, type Db } from "./db/pool";
import { createListener } from "./http/listener";
import { RateLimiter } from "./http/rateLimit";
import { Router } from "./http/router";
import { createAuthenticate } from "./middleware/authenticate";
import { createAuthService } from "./modules/auth/auth.service";
import { createBlockchain } from "./modules/blockchain";
import { createUsersRepo } from "./modules/users/users.repo";
import { createApiRouter, type RepoOverrides } from "./routes";
import type { ModuleContext } from "./routes/context";

export interface AppDeps {
  config: Config;
  /** Real pg-backed Db, or undefined when no database URL is configured. */
  db?: Db | undefined;
  /** Test hook: replace some repositories with in-memory fakes. */
  repos?: RepoOverrides;
}

export function createApp({ config, db, repos = {} }: AppDeps): Server {
  const database = db ?? unavailableDb;
  const logger = createLogger(config.logRequests);
  const usersRepo = repos.users ?? createUsersRepo(database);
  const auth = createAuthService(usersRepo, config);
  const blockchain = createBlockchain(config);
  const ctx: ModuleContext = {
    config,
    db: database,
    logger,
    auth,
    authenticate: createAuthenticate(auth),
    limiters: {
      login: new RateLimiter(config.loginRateLimitMax, 15 * 60_000),
      device: new RateLimiter(config.deviceRateLimitMax, 60_000),
    },
    blockchain,
  };

  const root = new Router();
  // Public health check: always answers 200 so you can see whether the database is reachable.
  root.get("/api/health", async () => {
    const diag = db ? (db.diagnose ? await db.diagnose() : { ok: await db.ping() }) : undefined;
    const connected = diag?.ok === true;
    return ok({
      status: "ok",
      service: "textracer-backend",
      uptimeSeconds: Math.round(process.uptime()),
      database: db ? (connected ? "connected" : "unreachable") : "not_configured",
      databaseMode: config.dbMode,
      ...(diag && diag.ok === false && "hint" in diag ? { databaseHint: diag.hint, databaseErrorCode: diag.code } : {}),
      blockchain: blockchain.enabled ? ((await blockchain.ping()) ? "connected" : "unreachable") : "disabled",
    });
  });
  root.mount("/api", createApiRouter(ctx, { ...repos, users: usersRepo }));

  const globalLimiter = new RateLimiter(config.globalRateLimitMax, 60_000);
  return createServer(createListener({ router: root, config, logger, globalLimiter }));
}
