import type { ReactNode } from "react";
import { AlertTriangle, Check, ChevronRight, Database, Fingerprint, Gauge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductRow, ProductStatusCode } from "@/lib/api";
import { JOURNEY_STAGES, productLabel, productStatus, stageLabel } from "@/lib/labels";

export const inputCls = "h-10 w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70";
export const selectCls = "h-9 rounded-md border border-input bg-card px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70";
export const textareaCls = "mt-2 min-h-24 w-full rounded-md border border-input bg-card p-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring";

export function PageIntro({ title, detail, badge }: { title: string; detail: string; badge?: string }) {
  return (
    <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b pb-4">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
      {badge && <Status value={badge} />}
    </div>
  );
}

export function Panel({ title, subtitle, children, className, action }: { title: string; subtitle?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("overflow-hidden rounded-md border bg-card", className)}>
      <div className="flex items-start justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Status({ value }: { value: string }) {
  const tone = /approved|verified|completed|valid scan|valid|shipped|ready for shipment|confirmed|connected|active|key issued/i.test(value) && !/invalid/i.test(value)
    ? "bg-success/10 text-success ring-1 ring-success/20"
    : /reject|failed|invalid/i.test(value)
      ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20"
      : /pending|stalled|rework|warning|awaiting|submitted|not anchored|no decision/i.test(value)
        ? "bg-warning/15 text-warning-foreground ring-1 ring-warning/30"
        : "bg-secondary text-secondary-foreground ring-1 ring-border";
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium", tone)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {value}
    </span>
  );
}

export function Kpi({ label, value, note, icon: Icon, warning }: { label: string; value: string; note: string; icon: typeof Gauge; warning?: boolean }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className={cn("rounded p-1.5", warning ? "bg-warning/15 text-warning-foreground" : "bg-primary/10 text-primary")}><Icon className="h-4 w-4" /></div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>
    </div>
  );
}

export function AlertLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
      <div><div className="text-sm font-semibold">{title}</div><div className="mt-0.5 text-xs text-muted-foreground">{detail}</div></div>
    </div>
  );
}

export const Fact = ({ label, value }: { label: string; value: string }) => (
  <div><div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div><div className="mt-1 break-words text-sm font-medium">{value}</div></div>
);
export const FactRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"><span className="text-sm text-muted-foreground">{label}</span><span className="text-right text-sm font-medium">{value}</span></div>
);
export const Verify = ({ label, status }: { label: string; status: string }) => (
  <div className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"><div className="flex items-center gap-2 text-sm"><Fingerprint className="h-4 w-4 text-primary" />{label}</div><Status value={status} /></div>
);
export const FlowStep = ({ text, good }: { text: string; good?: boolean }) => (
  <div className={cn("flex items-center justify-between rounded-md border p-3 text-sm font-semibold", good ? "border-success/30 bg-success/10 text-success" : "bg-card")}><span>{text}</span><ChevronRight className="h-4 w-4" /></div>
);
export const GateCard = ({ number, title, detail, status }: { number: string; title: string; detail: string; status: string }) => (
  <div className="rounded-md border bg-card p-4">
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-semibold text-primary-foreground">G{number}</div>
      <div><b>{title}</b><p className="text-xs text-muted-foreground">{detail}</p></div>
    </div>
    <div className="mt-4"><Status value={status} /></div>
  </div>
);

export const Empty = ({ text }: { text: string }) => (
  <div className="py-10 text-center"><Database className="mx-auto h-7 w-7 text-muted-foreground/60" /><p className="mt-2 text-sm text-muted-foreground">{text}</p></div>
);

export const Loading = ({ text = "Loading…" }: { text?: string }) => (
  <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />{text}</div>
);

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-destructive">Unable to load data</div><div className="mt-1 break-words text-xs text-muted-foreground">{message}</div></div>
        {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
      </div>
    </div>
  );
}

/** Renders loading / error / empty / content for an API-backed block. */
export function Async({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} {...(onRetry ? { onRetry } : {})} />;
  return <>{children}</>;
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <div className="mt-3 text-xs text-muted-foreground">{total} record{total === 1 ? "" : "s"}</div>;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{total} records · page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** Nine-stage journey. 'intake' (waiting for Gate 1) means no journey stage is reached yet. */
export function Journey({ stage, status }: { stage: string; status: ProductStatusCode }) {
  const current = (JOURNEY_STAGES as readonly string[]).indexOf(stage);
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-[820px] items-start">
        {JOURNEY_STAGES.map((code, index) => {
          const done = index < current || status === "shipped";
          const active = index === current && status !== "shipped";
          return (
            <div key={code} className="flex flex-1 items-start">
              <div className="min-w-0 flex-1 text-center">
                <div className={cn("mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold", done && "border-success bg-success text-success-foreground", active && "border-primary bg-primary text-primary-foreground", !done && !active && "border-border bg-card text-muted-foreground")}>{done ? <Check className="h-4 w-4" /> : index + 1}</div>
                <div className={cn("mt-2 text-[11px] font-medium leading-tight", active && "text-primary")}>{stageLabel(code)}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">{done ? "Completed" : active ? "Current" : "Pending"}</div>
              </div>
              {index < JOURNEY_STAGES.length - 1 && <div className={cn("mt-4 h-0.5 w-4 shrink-0", index < current || status === "shipped" ? "bg-success" : "bg-border")} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProductTable({ products, action, actionHeader = "Action" }: { products: ProductRow[]; action: (p: ProductRow) => ReactNode; actionHeader?: string }) {
  if (!products.length) return <Empty text="No products match the current view." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Product</th><th>RFID UID</th><th>Purchase order</th><th>Stage / Department</th><th>Status</th><th className="text-right">{actionHeader}</th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr className="border-b last:border-0" key={p.id}>
              <td className="py-3 font-semibold">{productLabel(p)}{p.description && <div className="max-w-56 truncate text-xs font-normal text-muted-foreground">{p.description}</div>}</td>
              <td className="font-mono text-xs">{p.rfidUid}</td>
              <td>{p.poNumber ?? "—"}</td>
              <td>{stageLabel(p.stage)}<div className="text-xs text-muted-foreground">{p.department}</div></td>
              <td><Status value={productStatus(p)} /></td>
              <td className="text-right">{action(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
