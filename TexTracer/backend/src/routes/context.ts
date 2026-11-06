import type { Config } from "../config/env";
import type { Logger } from "../core/logger";
import type { Db } from "../db/pool";
import type { Guard } from "../http/types";
import type { RateLimiter } from "../http/rateLimit";
import type { AuthService } from "../modules/auth/auth.service";
import type { MultichainService } from "../modules/blockchain";

/** Everything a module needs. Modules never create their own database connection. */
export interface ModuleContext {
  config: Config;
  db: Db;
  logger: Logger;
  auth: AuthService;
  authenticate: Guard;
  limiters: { login: RateLimiter; device: RateLimiter };
  /** Blockchain layer; `enabled` is false when MultiChain is not configured. */
  blockchain?: MultichainService;
}
