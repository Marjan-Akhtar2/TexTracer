import type { Guard, Handler, Req } from "./types";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Route {
  method: Method;
  segments: string[];
  guards: Guard[];
  handler: Handler;
}
interface Mount {
  prefix: string[];
  router: Router;
  guards: Guard[];
}
export interface Resolved {
  guards: Guard[];
  handler: Handler;
  params: Record<string, string>;
}

const split = (p: string) => p.split("/").filter(Boolean);

/** Tiny router: path params (":id"), per-router guards, nested mounting. */
export class Router {
  private routes: Route[] = [];
  private mounts: Mount[] = [];
  private shared: Guard[] = [];

  /** Guards applied to every route of this router (also routes defined later). */
  use(...guards: Guard[]): this {
    this.shared.push(...guards);
    return this;
  }

  private add(method: Method, path: string, fns: (Guard | Handler)[]): this {
    const handler = fns[fns.length - 1] as Handler;
    this.routes.push({ method, segments: split(path), guards: fns.slice(0, -1) as Guard[], handler });
    return this;
  }
  get = (path: string, ...fns: (Guard | Handler)[]) => this.add("GET", path, fns);
  post = (path: string, ...fns: (Guard | Handler)[]) => this.add("POST", path, fns);
  put = (path: string, ...fns: (Guard | Handler)[]) => this.add("PUT", path, fns);
  patch = (path: string, ...fns: (Guard | Handler)[]) => this.add("PATCH", path, fns);
  delete = (path: string, ...fns: (Guard | Handler)[]) => this.add("DELETE", path, fns);

  mount(prefix: string, router: Router, ...guards: Guard[]): this {
    this.mounts.push({ prefix: split(prefix), router, guards });
    return this;
  }

  resolve(method: string, segments: string[]): Resolved | null {
    for (const r of this.routes) {
      if (r.method !== method || r.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let match = true;
      for (let i = 0; i < segments.length; i++) {
        const pattern = r.segments[i]!;
        const actual = segments[i]!;
        if (pattern.startsWith(":")) {
          try {
            params[pattern.slice(1)] = decodeURIComponent(actual);
          } catch {
            match = false;
            break;
          }
        } else if (pattern !== actual) {
          match = false;
          break;
        }
      }
      if (match) return { guards: [...this.shared, ...r.guards], handler: r.handler, params };
    }
    for (const m of this.mounts) {
      if (m.prefix.length > segments.length || !m.prefix.every((s, i) => s === segments[i])) continue;
      const sub = m.router.resolve(method, segments.slice(m.prefix.length));
      if (sub) return { guards: [...this.shared, ...m.guards, ...sub.guards], handler: sub.handler, params: sub.params };
    }
    return null;
  }

  /** Test helper: invoke the router without HTTP. */
  async run(method: string, path: string, req: Omit<Req, "params" | "path" | "method">) {
    const found = this.resolve(method, split(path));
    if (!found) return null;
    const full: Req = { ...req, method, path, params: found.params };
    for (const g of found.guards) await g(full);
    return found.handler(full);
  }
}
