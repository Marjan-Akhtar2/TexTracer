import { z } from "zod";
import { ok } from "../../core/response";
import { parse } from "../../core/validate";
import { Router } from "../../http/router";
import { rateLimit } from "../../http/rateLimit";
import type { ModuleContext } from "../../routes/context";

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export function createAuthRouter(ctx: ModuleContext): Router {
  const router = new Router();

  // POST /api/auth/login  (public, rate limited per IP)
  router.post("/login", rateLimit(ctx.limiters.login), async (req) => {
    const { email, password } = parse(loginBody, req.body);
    return ok(await ctx.auth.login(email, password));
  });

  // GET /api/auth/me  (any logged-in user)
  router.get("/me", ctx.authenticate, (req) => ok(req.user));

  // POST /api/auth/logout  (tokens are stateless: the client discards its token)
  router.post("/logout", ctx.authenticate, () => ok({ loggedOut: true }));

  return router;
}
