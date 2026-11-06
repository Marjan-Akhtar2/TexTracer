import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Loader2 } from "lucide-react";
import logoAsset from "@/assets/textracer-logo-transparent.png";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import type { ApiUser } from "@/lib/api";
import { homeView, navFor, type View } from "@/lib/nav";
import { SessionProvider, useSession } from "@/lib/session";
import { errorMessage } from "@/lib/labels";
import { NotificationBell } from "@/components/textracer/NotificationBell";
import { Empty } from "@/components/textracer/ui";
import { Audit } from "@/views/audit";
import { Blockchain } from "@/views/blockchain";
import { Alerts, Items, ManagementDashboard, ProductionFlow, RoleDashboard } from "@/views/dashboards";
import { GateOne, GateThree, GateTwo } from "@/views/gates";
import { Rework } from "@/views/rework";
import { IntakeScan, ScanWorkspace } from "@/views/scan";
import { LiveScans } from "@/views/livescans";
import { ProductTracking } from "@/views/tracking";
import { ReadersView, RolesView, UsersView } from "@/views/admin";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "TexTracer · Textile Traceability Platform" },
    { name: "description", content: "TexTracer manufacturing tracking and verification platform." },
    { property: "og:title", content: "TexTracer · Textile Traceability Platform" },
    { property: "og:description", content: "Textile manufacturing tracking and verification." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: TexTracerRoot,
});

function TexTracerRoot() {
  return <SessionProvider><TexTracerApp /><Toaster richColors position="top-right" /></SessionProvider>;
}

function TexTracerApp() {
  const { user, restoring, logout } = useSession();
  const [splash, setSplash] = useState(true);
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => { setSidebarCollapsed(window.sessionStorage.getItem("textracer-sidebar") === "collapsed"); }, []);
  useEffect(() => { const timer = window.setTimeout(() => setSplash(false), 2100); return () => window.clearTimeout(timer); }, []);
  // Whenever a different account signs in, land on that role's home screen.
  const userId = user?.id;
  useEffect(() => { if (user) setView(homeView(user)); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (splash || restoring) return <Splash />;
  if (!user) return <Login />;
  // Protected views: a view that is not in this user's navigation falls back to their home screen.
  const allowed = navFor(user).some((n) => n.id === view);
  const current: View = allowed ? view : homeView(user);
  return (
    <Shell user={user} view={current} setView={setView} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={(value) => { setSidebarCollapsed(value); window.sessionStorage.setItem("textracer-sidebar", value ? "collapsed" : "expanded"); }} onLogout={logout}>
      <AppView user={user} view={current} setView={setView} />
    </Shell>
  );
}

function Brand({ compact = false, inverse = false, iconOnly = false }: { compact?: boolean; inverse?: boolean; iconOnly?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded bg-white", compact ? "h-9 w-11 p-1" : "h-12 w-16 p-1.5")}><img src={logoAsset} alt="TexTracer logo" className="h-full w-full object-contain" /></div>
      {!iconOnly && <div className="min-w-0"><div className={cn("font-semibold leading-tight", inverse ? "text-sidebar-foreground" : "text-foreground", compact ? "text-base" : "text-xl")}>TexTracer</div><div className={cn("truncate text-[11px]", inverse ? "text-sidebar-foreground/60" : "text-muted-foreground")}>Textile Traceability Platform</div></div>}
    </div>
  );
}

function Splash() {
  return (
    <main className="splash-exit flex min-h-screen items-center justify-center bg-sidebar">
      <div className="text-center text-sidebar-foreground">
        <div className="mx-auto w-fit rounded-md bg-white p-3"><img src={logoAsset} alt="TexTracer logo" className="h-20 w-32 object-contain" /></div>
        <h1 className="mt-5 text-2xl font-semibold">TexTracer</h1>
        <p className="mt-1 text-sm text-sidebar-foreground/65">Textile manufacturing tracking and verification</p>
        <div className="mx-auto mt-6 h-0.5 w-24 overflow-hidden bg-sidebar-border"><div className="trace-line h-full w-full bg-sidebar-primary" /></div>
      </div>
    </main>
  );
}

function Login() {
  const { login, notice } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Enter your email address and password."); return; }
    setBusy(true); setError("");
    try { await login(email, password); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const field = "mt-1.5 h-10 w-full rounded-md border border-input bg-card px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring";
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1fr_1fr]">
      <section className="hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <Brand inverse />
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Every textile item, traced from raw material to shipment.</h1>
          <p className="mt-4 text-sm leading-6 text-sidebar-foreground/70">RFID stage tracking, three approval gates and blockchain-anchored decision records in one operational system.</p>
          <div className="mt-8 grid grid-cols-3 gap-4 border-t border-sidebar-border pt-6">
            {[["8", "Departments"], ["3", "Approval gates"], ["6", "User roles"]].map(([a, b]) => <div key={b}><div className="text-2xl font-semibold">{a}</div><div className="mt-1 text-xs text-sidebar-foreground/60">{b}</div></div>)}
          </div>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Authorised personnel only.</p>
      </section>
      <section className="flex items-center justify-center p-6 lg:p-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Brand /></div>
          <h2 className="text-2xl font-semibold text-foreground">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use your TexTracer account to open your workspace.</p>
          <label htmlFor="login-email" className="mt-6 block text-sm font-medium">Email address</label>
          <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} className={field} />
          <label htmlFor="login-password" className="mt-4 block text-sm font-medium">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} className={field} />
          {(error || notice) && <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">{error || notice}</p>}
          <Button className="mt-6 h-10 w-full" type="submit" disabled={busy}>{busy ? <><Loader2 className="animate-spin" />Signing in…</> : "Sign in"}</Button>
          <p className="mt-4 text-xs text-muted-foreground">Accounts are created and managed by your System Administrator.</p>
        </form>
      </section>
    </main>
  );
}

function Shell({ user, view, setView, sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed, onLogout, children }: { user: ApiUser; view: View; setView: (v: View) => void; sidebarOpen: boolean; setSidebarOpen: (v: boolean) => void; sidebarCollapsed: boolean; setSidebarCollapsed: (v: boolean) => void; onLogout: () => void; children: ReactNode }) {
  const items = navFor(user);
  const active = items.find((x) => x.id === view)?.label ?? "TexTracer";
  const initials = user.name.split(" ").filter(Boolean).map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  const groups = items.reduce<{ name: string; items: typeof items }[]>((acc, item) => {
    const g = acc.find((x) => x.name === item.group);
    if (g) g.items.push(item); else acc.push({ name: item.group, items: [item] });
    return acc;
  }, []);
  return (
    <div className={cn("min-h-screen bg-background lg:grid", sidebarCollapsed ? "lg:grid-cols-[68px_1fr]" : "lg:grid-cols-[250px_1fr]")}>
      {sidebarOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-foreground/30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", sidebarCollapsed && "lg:w-[68px]", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center border-b border-sidebar-border px-3.5"><Brand compact inverse iconOnly={sidebarCollapsed} /></div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main navigation">
          {groups.map((g) => (
            <div key={g.name} className="mb-4">
              <div className={cn("px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/45", sidebarCollapsed && "lg:hidden")}>{g.name}</div>
              <div className="space-y-0.5">
                {g.items.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" title={sidebarCollapsed ? label : undefined} onClick={() => { setView(id); setSidebarOpen(false); }}
                    aria-current={view === id ? "page" : undefined}
                    className={cn("relative flex h-9 w-full items-center gap-2.5 rounded px-2.5 text-left text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground", sidebarCollapsed && "lg:justify-center lg:px-0", view === id && "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary")}>
                    <Icon className={cn("h-4 w-4 shrink-0", view === id && "text-sidebar-primary")} />
                    <span className={cn("truncate", sidebarCollapsed && "lg:hidden")}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-2.5">
          <div className={cn("mb-2 px-2.5", sidebarCollapsed && "lg:hidden")}>
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-[11px] text-sidebar-foreground/60">{user.roleLabel}{user.department ? ` · ${user.department}` : ""}</div>
          </div>
          <button type="button" title="Sign out" onClick={onLogout} className={cn("flex h-9 w-full items-center gap-2.5 rounded px-2.5 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground", sidebarCollapsed && "lg:justify-center lg:px-0")}>
            <LogOut className="h-4 w-4 shrink-0" /><span className={cn(sidebarCollapsed && "lg:hidden")}>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-card px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu /></Button>
            <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>{sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button>
            <h1 className="truncate text-sm font-semibold text-foreground">{active}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <NotificationBell />
            <div className="hidden text-right md:block"><div className="text-xs font-medium">{user.name}</div><div className="text-[11px] text-muted-foreground">{user.roleLabel}</div></div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials}</div>
          </div>
        </header>
        <main className="page-enter p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function AppView({ user, view, setView }: { user: ApiUser; view: View; setView: (v: View) => void }) {
  switch (view) {
    case "tracking": return <ProductTracking />;
    case "scan": return <ScanWorkspace />;
    case "rfid": return <IntakeScan onRegister={() => setView("gate1")} />;
    case "gate1": return <GateOne />;
    case "gate2": return <GateTwo />;
    case "gate3": return <GateThree />;
    case "rework": return <Rework />;
    case "audit": return <Audit />;
    case "alerts": return <Alerts />;
    case "blockchain": return <Blockchain />;
    case "users": return <UsersView me={user} />;
    case "roles": return <RolesView />;
    case "readers": return <ReadersView />;
    case "livescans": return <LiveScans />;
    case "items": return <Items user={user} />;
    case "flow": return <ProductionFlow user={user} />;
    case "analytics": return <ManagementDashboard compact />;
    case "dashboard":
      return user.role === "senior_management" ? <ManagementDashboard /> : user.role === "auditor" ? <Audit /> : <RoleDashboard user={user} setView={setView} />;
    default: return <Empty text="This page is not available." />;
  }
}
