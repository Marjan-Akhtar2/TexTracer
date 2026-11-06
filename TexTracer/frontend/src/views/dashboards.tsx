import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeftRight, Boxes, ChevronRight, CircleAlert, CircleCheckBig, ClipboardCheck, Clock3, LockKeyhole,
  PackageCheck, Radio, ShieldCheck, Users, Check, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approvalsApi, dashboardApi, productsApi, reworkApi, rolesApi, scansApi, usersApi,
  type ApiUser, type ProductRow, type StageReport,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { ALL_STAGES, fmtDateTime, fmtDuration, fmtNumber, productLabel, stageLabel } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import {
  AlertLine, Async, Empty, Journey, Kpi, PageIntro, Pager, Panel, ProductTable, selectCls, Status,
} from "@/components/textracer/ui";
import type { View } from "@/lib/nav";

const POLL_MS = 30_000;
interface ManagementData {
  kpis: Awaited<ReturnType<typeof dashboardApi.kpis>>;
  stages: Awaited<ReturnType<typeof dashboardApi.stages>>;
  reasons: Awaited<ReturnType<typeof dashboardApi.rejectionReasons>>;
  anchors: Awaited<ReturnType<typeof dashboardApi.anchors>>;
  stalled: Awaited<ReturnType<typeof dashboardApi.stalled>>;
  overview: Awaited<ReturnType<typeof dashboardApi.overview>>;
}
const SLICE_COLORS = ["var(--color-destructive)", "var(--color-warning)", "var(--color-info)", "var(--color-chart-4)", "var(--color-muted-foreground)"];

/* ------------------------- Senior Management dashboard ------------------------- */
export function ManagementDashboard({ compact = false }: { compact?: boolean }) {
  const d = useApi<ManagementData>(async () => {
    const [kpis, stages, reasons, anchors, stalled, overview] = await Promise.all([
      dashboardApi.kpis(), dashboardApi.stages(), dashboardApi.rejectionReasons(), dashboardApi.anchors(), dashboardApi.stalled(10), dashboardApi.overview(),
    ]);
    return { kpis, stages, reasons, anchors, stalled, overview };
  }, [], POLL_MS);

  return (
    <>
      <PageIntro title={compact ? "Manufacturing Analytics" : "Management Dashboard"} detail="Throughput, rejection rates, cycle times, bottlenecks and verification status. Refreshes every 30 seconds." badge="Read-only" />
      <Async loading={d.loading && !d.data} error={d.data ? null : d.error} onRetry={d.reload}>
        {d.data && <ManagementBody data={d.data} />}
      </Async>
    </>
  );
}

function ManagementBody({ data }: { data: ManagementData }) {
  const { kpis, stages, reasons, anchors, stalled, overview } = data;
  const maxArrivals = Math.max(0, ...stages.departments.map((x) => x.arrivals24h));
  const maxDwell = Math.max(0, ...stages.departments.map((x) => x.avgDwellSeconds ?? 0));
  const totalReasons = reasons.reduce((a, r) => a + r.occurrences, 0);
  let acc = 0;
  const slices = reasons.map((r, i) => {
    const start = acc; acc += totalReasons ? (r.occurrences / totalReasons) * 100 : 0;
    return `${SLICE_COLORS[i % SLICE_COLORS.length]} ${start}% ${acc}%`;
  });
  const donut = slices.length ? `conic-gradient(${slices.join(",")})` : "conic-gradient(var(--color-muted) 0 100%)";
  const anchorTotal = kpis.anchorsConfirmed + kpis.anchorsPending;
  const stageByCode = new Map(stages.stages.map((s) => [s.stage, s]));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Items in production" value={fmtNumber(kpis.itemsInProgress)} note={`${fmtNumber(overview.totalProducts)} products registered`} icon={Boxes} />
        <Kpi label="Items shipped" value={fmtNumber(kpis.itemsShipped)} note="Shipped to date" icon={CircleCheckBig} />
        <Kpi label="Rejection rate" value={kpis.rejectionRatePct === null ? "—" : `${kpis.rejectionRatePct}%`} note="Gate 1 and Gate 2 decisions" icon={CircleAlert} />
        <Kpi label="Average cycle time" value={fmtDuration(kpis.avgCycleTimeSeconds)} note="Registration to shipping (shipped items)" icon={Clock3} />
        <Kpi label="Stalled items" value={fmtNumber(kpis.stalledItems)} note="Idle beyond the stage time limit" icon={AlertTriangle} warning />
        <Kpi label="Blockchain records confirmed" value={anchorTotal ? `${kpis.anchorsConfirmed}/${anchorTotal}` : "—"} note={anchorTotal ? "Confirmed of total gate records" : "No records yet"} icon={ShieldCheck} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <Panel title="Department throughput" subtitle="Stage arrivals · last 24 hours">
          {stages.departments.length ? (
            <div className="flex h-56 items-end gap-3 pt-5">
              {stages.departments.map((x) => (
                <div key={x.department} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="text-[10px] font-semibold text-foreground">{x.arrivals24h}</div>
                  <div className="relative h-36 w-full overflow-hidden bg-muted"><div className="absolute inset-x-0 bottom-0 bg-primary transition-all duration-500" style={{ height: `${maxArrivals ? (x.arrivals24h / maxArrivals) * 100 : 0}%` }} /></div>
                  <div className="min-h-8 text-center text-[9px] leading-3 text-muted-foreground">{x.department}</div>
                </div>
              ))}
            </div>
          ) : <Empty text="No department data." />}
        </Panel>
        <Panel title="Rejection reasons" subtitle="Gate decisions with a recorded reason">
          {reasons.length ? (
            <div className="grid grid-cols-[140px_1fr] items-center gap-5">
              <div className="relative h-36 w-36 rounded-full" style={{ background: donut }}>
                <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-card"><b className="text-2xl text-foreground">{kpis.rejectionRatePct === null ? "—" : `${kpis.rejectionRatePct}%`}</b><span className="text-[9px] text-muted-foreground">rejected</span></div>
              </div>
              <div className="space-y-3">
                {reasons.map((r, i) => (
                  <div key={`${r.gate}-${r.reasonCode}`} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                    <span className="flex-1 text-muted-foreground">{r.description}</span>
                    <b>{r.occurrences}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty text="No rejections recorded yet." />}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <Panel title="Production flow" subtitle={`Items in progress at each stage${stages.bottleneckStage ? ` · bottleneck: ${stageLabel(stages.bottleneckStage)}` : ""}`}>
          <div className="overflow-x-auto">
            <div className="flex min-w-[900px] items-center py-5">
              {ALL_STAGES.map((code, index) => {
                const s = stageByCode.get(code);
                const gate = code === "intake" ? 1 : code === "production" ? 2 : code === "packaging" ? 3 : 0;
                return (
                  <div key={code} className="flex flex-1 items-center">
                    <div className="min-w-0 flex-1 text-center">
                      <div className={cn("mx-auto flex h-12 w-12 items-center justify-center rounded-md border font-display text-sm font-semibold", s?.isBottleneck ? "border-warning bg-warning/20 text-warning-foreground" : "border-primary/20 bg-primary/10 text-primary")}>{s?.wip ?? 0}</div>
                      <p className="mt-2 text-[10px] font-semibold leading-3">{stageLabel(code)}</p>
                      {gate > 0 && <span className="mt-1 inline-block text-[8px] font-bold uppercase text-info">Gate {gate}</span>}
                    </div>
                    {index < ALL_STAGES.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
        <Panel title="Blockchain verification" subtitle="Gate decision records by network and status">
          {anchors.length ? (
            <div className="space-y-4">
              {anchors.map((a) => (
                <div key={`${a.chain}-${a.status}`} className="flex items-center gap-3">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", a.status === "confirmed" ? "bg-success/10 text-success" : "bg-warning/15 text-warning-foreground")}>{a.status === "confirmed" ? <Check className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</div>
                  <div className="min-w-0 flex-1"><div className="text-xs font-semibold">{a.chain}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{a.count} record(s)</div></div>
                  <Status value={a.status} />
                </div>
              ))}
            </div>
          ) : <Empty text="No blockchain records yet." />}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Panel title="Dwell time by department" subtitle="Average time items spend in a department's stages">
          {stages.departments.some((x) => x.avgDwellSeconds !== null) ? (
            <div className="space-y-3">
              {stages.departments.map((x) => (
                <div key={x.department} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-[11px]">
                  <span>{x.department}</span>
                  <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${maxDwell ? ((x.avgDwellSeconds ?? 0) / maxDwell) * 100 : 0}%` }} /></div>
                  <b>{fmtDuration(x.avgDwellSeconds)}</b>
                </div>
              ))}
            </div>
          ) : <Empty text="Not enough completed stages to compute dwell times." />}
        </Panel>
        <Panel title="Operational alerts" subtitle="Stalled items and items in rework">
          <div className="space-y-3">
            {stalled.map((s) => <AlertLine key={s.productId} title={`${s.rfidUid} · Stalled`} detail={`${stageLabel(s.stage)} · idle ${fmtDuration(s.idleSeconds)} (limit ${s.slaMinutes} min)`} />)}
            {overview.rework.open > 0 && <AlertLine title={`${overview.rework.open} item(s) in rework`} detail={`${overview.rework.awaitingQcRecheck} waiting for QC re-inspection`} />}
            {!stalled.length && overview.rework.open === 0 && <Empty text="No active alerts." />}
          </div>
        </Panel>
      </div>
    </>
  );
}
/* ------------------------- Dashboards for the other roles ------------------------- */
type Card = [label: string, value: string, note: string, icon: LucideIcon, warning?: boolean];
interface RoleData { title: string; detail: string; cards: Card[]; featured: ProductRow | null; exceptions: ProductRow[]; accounts?: { label: string; count: number }[] }

async function loadRoleData(user: ApiUser): Promise<RoleData> {
  const total = (r: { meta: { total?: number } }) => r.meta.total ?? 0;
  if (user.role === "system_admin") {
    const [users, roles] = await Promise.all([usersApi.list(), rolesApi.list()]);
    const active = users.filter((u) => u.isActive).length;
    return {
      title: "Administration Overview", detail: "User accounts and role assignments.", featured: null, exceptions: [],
      cards: [
        ["Active users", String(active), `${users.length} accounts in total`, Users],
        ["Defined roles", String(roles.length), "System roles", LockKeyhole],
        ["Inactive accounts", String(users.length - active), "Cannot sign in", ShieldCheck, users.length - active > 0],
      ],
      accounts: roles.map((r) => ({ label: r.label, count: users.filter((u) => u.role === r.code).length })),
    };
  }
  if (user.role === "warehouse_manager") {
    const [pending, all, rejected, stalled, latest] = await Promise.all([
      approvalsApi.pending({ gate: "gate1_intake", limit: 1 }), productsApi.list({ limit: 1 }), productsApi.list({ status: "rejected", limit: 1 }),
      productsApi.list({ stalled: true, limit: 5 }), productsApi.list({ limit: 1 }),
    ]);
    return {
      title: "Raw Material Intake", detail: "Gate 1 approvals against purchase orders.", featured: latest.data[0] ?? null, exceptions: stalled.data,
      cards: [
        ["Awaiting review", String(total(pending)), "Registered, waiting for Gate 1", ClipboardCheck],
        ["Registered items", String(total(all)), "All RFID-tagged material", ShieldCheck],
        ["Rejected at Gate 1", String(total(rejected)), "Procurement notified", AlertTriangle],
      ],
    };
  }
  if (user.role === "qc_officer") {
    const [pending, rework, stalled, latest] = await Promise.all([
      approvalsApi.pending({ gate: "gate2_qc", limit: 1 }), reworkApi.list({ limit: 100 }), productsApi.list({ stalled: true, limit: 5 }), productsApi.list({ stage: "production", limit: 1 }),
    ]);
    const ready = rework.data.filter((r) => r.reworkCompleted).length;
    return {
      title: "Stitching Quality Control", detail: "Gate 2 inspections and rework decisions.", featured: latest.data[0] ?? null, exceptions: stalled.data,
      cards: [
        ["Awaiting QC decision", String(total(pending)), "At Production, no Gate 2 approval yet", ClipboardCheck],
        ["In rework", String(total(rework)), "Returned to Production", ArrowLeftRight],
        ["Ready to re-inspect", String(ready), "Rework completed by Production", Check],
      ],
    };
  }
  // Department Officer
  const isPackaging = user.department === "Packaging";
  const [items, stalled, scans, gate3] = await Promise.all([
    productsApi.list({ limit: 5 }), productsApi.list({ stalled: true, limit: 5 }), scansApi.list({ limit: 1 }),
    isPackaging ? approvalsApi.pending({ gate: "gate3_shipment", limit: 1 }) : Promise.resolve(null),
  ]);
  const cards: Card[] = [
    ["Items through department", String(total(items)), user.department ?? "Your department", Boxes],
    ["Scans logged", String(total(scans)), "Your department's readers", Radio],
    ["Stalled items", String(total(stalled)), "Idle beyond the stage time limit", AlertTriangle, total(stalled) > 0],
  ];
  if (gate3) cards.push(["Awaiting Gate 3", String(total(gate3)), "Ready-for-shipment decisions", PackageCheck]);
  return { title: `${user.department ?? "Department"} workspace`, detail: "Work queue and stage handoffs for your department.", featured: items.data[0] ?? null, exceptions: stalled.data, cards };
}

export function RoleDashboard({ user, setView }: { user: ApiUser; setView: (v: View) => void }) {
  const d = useApi(() => loadRoleData(user), [user.id], POLL_MS);
  const queue: View = user.role === "qc_officer" ? "rework" : user.role === "warehouse_manager" ? "gate1" : user.role === "department_officer" ? "items" : "users";
  return (
    <Async loading={d.loading && !d.data} error={d.data ? null : d.error} onRetry={d.reload}>
      {d.data && (
        <>
          <PageIntro title={d.data.title} detail={d.data.detail} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {d.data.cards.map(([label, value, note, icon, warning]) => <Kpi key={label} label={label} value={value} note={note} icon={icon} {...(warning ? { warning } : {})} />)}
          </div>
          {d.data.accounts ? (
            <div className="mt-6"><Panel title="Accounts by role" subtitle="Effective role of every account">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{d.data.accounts.map((a) => <div key={a.label} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{a.label}</span><b>{a.count}</b></div>)}</div>
              <Button variant="outline" className="mt-4" onClick={() => setView("users")}>Manage users</Button>
            </Panel></div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
              <Panel title="Latest product journey" subtitle={d.data.featured ? `${productLabel(d.data.featured)} · ${d.data.featured.rfidUid}` : "Most recent item you can see"}>
                {d.data.featured && d.data.featured.status === "rejected" ? <Empty text="The most recent item was rejected at Gate 1 and did not enter production. Open its rejection record in Product Tracking." /> : d.data.featured ? <Journey stage={d.data.featured.stage} status={d.data.featured.status} /> : <Empty text="No products found." />}
              </Panel>
              <Panel title="Stalled items" subtitle="Items idle beyond their stage time limit">
                <div className="space-y-3">
                  {d.data.exceptions.length ? d.data.exceptions.map((p) => <AlertLine key={p.id} title={`${productLabel(p)} stalled`} detail={`${stageLabel(p.stage)} · last scan ${fmtDateTime(p.lastScanAt)}`} />) : <Empty text="No stalled items." />}
                  <Button variant="outline" className="mt-2 w-full" onClick={() => setView(user.role === "department_officer" ? "items" : "tracking")}>{user.role === "department_officer" ? "View department items" : "Open product tracking"}</Button>
                  {user.role !== "department_officer" && <Button variant="ghost" className="w-full" onClick={() => setView(queue)}>Go to work queue</Button>}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </Async>
  );
}

/* ------------------------------ Production flow ------------------------------ */
export function ProductionFlow({ user }: { user: ApiUser }) {
  const isMgmt = user.role === "senior_management";
  const products = useApi(() => productsApi.list({ limit: 100 }), [], POLL_MS);
  const report = useApi<StageReport | null>(async () => (isMgmt ? await dashboardApi.stages() : null), [isMgmt], POLL_MS);
  const [featuredId, setFeaturedId] = useState("");
  const rows = products.data?.data ?? [];
  useEffect(() => { if (!featuredId && rows[0]) setFeaturedId(rows[0].id); }, [rows, featuredId]);
  const featured = rows.find((p) => p.id === featuredId) ?? null;
  const counts = new Map<string, number>();
  if (isMgmt && report.data) for (const s of report.data.stages) counts.set(s.stage, s.wip);
  else for (const p of rows) if (p.status !== "rejected" && p.status !== "shipped") counts.set(p.stage, (counts.get(p.stage) ?? 0) + 1);

  return (
    <>
      <PageIntro title="Production Flow" detail={isMgmt ? "The complete textile journey with three verification gates." : "Items in your department across the textile journey."} />
      <Panel title="Live manufacturing network" subtitle="Items in progress at each stage across the production sequence">
        <Async loading={(products.loading && !products.data) || (isMgmt && report.loading && !report.data)} error={products.error ?? report.error} onRetry={() => { products.reload(); report.reload(); }}>
          <div className="relative overflow-x-auto pb-3">
            <div className="flex min-w-[980px] items-center py-8">
              {ALL_STAGES.map((code, index) => {
                const count = counts.get(code) ?? 0;
                const gate = code === "intake" ? 1 : code === "production" ? 2 : code === "packaging" ? 3 : 0;
                return (
                  <div key={code} className="flex flex-1 items-center">
                    <div className="relative min-w-0 flex-1 text-center">
                      <div className={cn("mx-auto flex h-14 w-14 items-center justify-center rounded-md border font-display text-lg font-semibold", count > 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>{count}</div>
                      <p className="mt-3 text-[11px] font-semibold leading-4">{stageLabel(code)}</p>
                      {gate > 0 && <div className="mx-auto mt-2 w-fit rounded bg-primary/10 px-2 py-1 text-[9px] font-bold uppercase text-primary">Gate {gate}</div>}
                    </div>
                    {index < ALL_STAGES.length - 1 && <div className="h-px w-6 shrink-0 bg-border" />}
                  </div>
                );
              })}
            </div>
          </div>
        </Async>
      </Panel>
      <div className="mt-5">
        <Panel title={featured ? `${productLabel(featured)} product journey` : "Product journey"} subtitle={featured ? `${featured.rfidUid} · ${featured.department}` : "No product selected"}
          action={rows.length ? <select aria-label="Choose product" value={featuredId} onChange={(e) => setFeaturedId(e.target.value)} className={cn(selectCls, "max-w-48")}>{rows.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}</select> : undefined}>
          {featured ? <Journey stage={featured.stage} status={featured.status} /> : <Empty text="No products found." />}
        </Panel>
      </div>
    </>
  );
}

/* ----------------------------- Department items ----------------------------- */
export function Items({ user }: { user: ApiUser }) {
  const [page, setPage] = useState(1);
  const list = useApi(() => productsApi.list({ page, limit: 25 }), [page]);
  return (
    <>
      <PageIntro title="Department Items" detail={`Items that are, or have been, in ${user.department ?? "your department"}.`} />
      <Panel title="Department queue">
        <Async loading={list.loading} error={list.error} onRetry={list.reload}>
          <ProductTable products={list.data?.data ?? []} actionHeader="Last scan" action={(p) => <span className="text-xs text-muted-foreground">{fmtDateTime(p.lastScanAt)}</span>} />
          <Pager page={list.data?.meta.page ?? page} pages={list.data?.meta.pages ?? 1} total={list.data?.meta.total ?? 0} onPage={setPage} />
        </Async>
      </Panel>
    </>
  );
}

/* --------------------------------- Alerts --------------------------------- */
export function Alerts() {
  const stalled = useApi(() => dashboardApi.stalled(100), [], POLL_MS);
  return (
    <>
      <PageIntro title="Stalled-Item Alerts" detail="Items whose next scan did not arrive within the stage time limit." badge="Read-only" />
      <Panel title="Active alerts" subtitle={`${stalled.data?.length ?? 0} stalled item(s)`}>
        <Async loading={stalled.loading && !stalled.data} error={stalled.data ? null : stalled.error} onRetry={stalled.reload}>
          {stalled.data?.length ? (
            <div className="space-y-4">
              {stalled.data.map((s) => (
                <div key={s.productId} className="rounded-md border border-warning/40 bg-warning/10 p-5">
                  <div className="flex items-start gap-4">
                    <AlertTriangle className="h-6 w-6 text-warning-foreground" />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Stalled Item · {s.rfidUid}</h3><Status value="Stalled" /></div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-4">
                        <div><div className="text-[11px] font-semibold uppercase text-muted-foreground">Current stage</div><div className="mt-1 text-sm font-medium">{stageLabel(s.stage)}</div></div>
                        <div><div className="text-[11px] font-semibold uppercase text-muted-foreground">Last scan</div><div className="mt-1 text-sm font-medium">{fmtDateTime(s.lastScanAt)}</div></div>
                        <div><div className="text-[11px] font-semibold uppercase text-muted-foreground">Idle for</div><div className="mt-1 text-sm font-medium">{fmtDuration(s.idleSeconds)}</div></div>
                        <div><div className="text-[11px] font-semibold uppercase text-muted-foreground">Overdue by</div><div className="mt-1 text-sm font-medium">{s.overdueMinutes} min (limit {s.slaMinutes} min)</div></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty text="No stalled items right now." />}
        </Async>
      </Panel>
    </>
  );
}
