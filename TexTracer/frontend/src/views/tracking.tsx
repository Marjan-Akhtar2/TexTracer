import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { productsApi, type AnchorInfo, type ProductDetail, type ProductHistory, type ProductVerification, type TimelineEvent } from "@/lib/api";
import { decisionLabel, fmtDateTime, fmtNumber, gateLabel, productLabel, productStatus, reasonText, scanResultLabel, stageLabel } from "@/lib/labels";
import { useReasonDescriptions } from "@/lib/reasons";
import { useApi, useDebounced } from "@/lib/useApi";
import { Async, Empty, Fact, FactRow, Journey, PageIntro, Pager, Panel, selectCls, Status, Verify } from "@/components/textracer/ui";

const STATUS_FILTERS = [["", "All statuses"], ["active", "In progress"], ["rework", "Rework"], ["rejected", "Rejected"], ["ready_for_shipment", "Ready for shipment"], ["shipped", "Shipped"]] as const;

/** Product list with server-side search/status filter + pagination. Reused by Tracking and Blockchain views. */
export function ProductPicker({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(query.trim());
  useEffect(() => { setPage(1); }, [search, status]);
  const list = useApi(() => productsApi.list({ search, status, page, limit: 25 }), [search, status, page]);
  const rows = list.data?.data ?? [];

  useEffect(() => { if (!selectedId && rows[0]) onSelect(rows[0].id); }, [rows, selectedId, onSelect]);

  return (
    <Panel title="Products" subtitle="Search by RFID UID, batch code, PO number or description">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={`${selectCls} mt-3 w-full`}>
        {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto">
        <Async loading={list.loading} error={list.error} onRetry={list.reload}>
          {rows.length ? rows.map((p) => (
            <button key={p.id} onClick={() => onSelect(p.id)} className={cn("w-full rounded-md border p-3 text-left transition-colors hover:bg-accent", p.id === selectedId && "border-primary bg-accent")}>
              <div className="flex justify-between gap-2"><b className="truncate text-sm">{productLabel(p)}</b><Status value={productStatus(p)} /></div>
              <div className="mt-2 text-xs text-muted-foreground">{stageLabel(p.stage)} · {p.department}</div>
            </button>
          )) : <Empty text="No products found." />}
        </Async>
      </div>
      <Pager page={list.data?.meta.page ?? page} pages={list.data?.meta.pages ?? 1} total={list.data?.meta.total ?? 0} onPage={setPage} />
    </Panel>
  );
}

export interface Loaded { detail: ProductDetail; history: ProductHistory; verification: ProductVerification }
export function useProduct(id: string | null) {
  return useApi<Loaded | null>(async () => {
    if (!id) return null;
    const [detail, history, verification] = await Promise.all([productsApi.get(id), productsApi.history(id), productsApi.verification(id)]);
    return { detail, history, verification };
  }, [id]);
}

export const anchorSummary = (anchors: { status: string }[]): string => {
  if (!anchors.length) return "Not anchored";
  if (anchors.every((a) => a.status === "confirmed")) return "Verified";
  if (anchors.some((a) => a.status === "failed")) return "Failed";
  return "Pending";
};

function eventRow(e: TimelineEvent, reasons: Record<string, string>) {
  if (e.type === "transition") {
    const kind = e.kind === "initial" ? "Registered at Gate 1 intake" : e.kind === "rework" ? "Rework routing" : "Stage transition";
    return { key: `t${e.id}`, id: `TR-${e.id}`, type: kind, stage: stageLabel(e.toStage), who: e.actorName ?? "System", reader: e.readerCode ?? "—", status: "Completed", anchors: [] as AnchorInfo[] };
  }
  if (e.type === "decision") {
    return { key: `d${e.id}`, id: `DEC-${e.id}`, type: `${gateLabel(e.gate)} ${decisionLabel(e.decision)}`, stage: gateLabel(e.gate), who: e.decidedBy, reader: "—", status: `${decisionLabel(e.decision)}${e.reasonCode ? ` · ${reasonText(e.reasonCode, e.notes, reasons)}` : ""}`, anchors: e.anchors };
  }
  return { key: `s${e.id}`, id: `SCAN-${e.id}`, type: "RFID scan", stage: e.readerCode, who: "Reader", reader: e.readerCode, status: scanResultLabel(e.result), anchors: [] as AnchorInfo[] };
}

export function EventTable({ timeline, reasons = {} }: { timeline: TimelineEvent[]; reasons?: Record<string, string> }) {
  return (
    <Panel title="Manufacturing & approval history" subtitle="Append-only record of stage movements, scans and gate decisions">
      {timeline.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Reference</th><th className="pb-3">Event</th><th className="pb-3">Stage / Gate</th><th className="pb-3">Timestamp</th><th className="pb-3">Status</th><th className="pb-3">Verification</th></tr></thead>
            <tbody>
              {timeline.map((e) => {
                const r = eventRow(e, reasons);
                const a = r.anchors[0];
                return (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-3 font-mono text-xs">{r.id}</td>
                    <td>{r.type}<div className="text-xs text-muted-foreground">{r.who}</div></td>
                    <td>{r.stage}<div className="text-xs text-muted-foreground">{r.reader}</div></td>
                    <td>{fmtDateTime(e.at)}</td>
                    <td>{r.status}</td>
                    <td>{e.type === "decision" ? <Status value={anchorSummary(r.anchors)} /> : <span className="text-xs text-muted-foreground">Not anchored</span>}{a?.txHash && <div className="mt-1 max-w-32 truncate font-mono text-[10px] text-muted-foreground">{a.txHash}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty text="No events recorded yet." />}
    </Panel>
  );
}

/** Gate 1 rejection record. A rejected raw material never entered production, so this replaces the normal tracking view. */
export function RejectionRecord({ loaded, reasons }: { loaded: Loaded; reasons: Record<string, string> }) {
  const { detail, history, verification } = loaded;
  const decisions = history.timeline.filter((e): e is Extract<TimelineEvent, { type: "decision" }> => e.type === "decision");
  const rejection = [...decisions].reverse().find((d) => d.gate === "gate1_intake" && d.decision === "rejected");
  const anchors = verification.anchors.filter((a) => a.gate === "gate1_intake" && a.decision === "rejected");
  const reason = rejection ? reasonText(rejection.reasonCode, rejection.notes, reasons) : "—";
  const extraNotes = rejection?.notes && !/^(OTHER|CUSTOM)/i.test(rejection.reasonCode ?? "") ? rejection.notes : null;
  return (
    <>
      <Panel title={`${productLabel(detail)} · Gate 1 rejection record`} subtitle={`RFID UID ${detail.rfidUid}`} action={<Status value="Rejected" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Rejection reason" value={reason} />
          <Fact label="Rejected by" value={rejection?.decidedBy ?? "—"} />
          <Fact label="Rejected on" value={fmtDateTime(rejection?.at)} />
          <Fact label="Purchase order" value={detail.poNumber ?? "—"} />
          <Fact label="Supplier" value={detail.supplier ?? "—"} />
          <Fact label="Material" value={detail.material ?? "—"} />
        </div>
        {extraNotes && <div className="mt-4"><Fact label="Notes" value={extraNotes} /></div>}
        <p className="mt-4 rounded-md border bg-muted p-3 text-xs text-muted-foreground">This material was rejected at intake and did not enter production. Procurement has been notified for return or replacement. The record is permanent and cannot be edited.</p>
      </Panel>
      <Panel title="Blockchain record" subtitle="Verification of the rejection decision">
        {anchors.length ? (
          <div className="space-y-3">
            {anchors.map((a) => (
              <div key={a.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_auto]">
                <div className="min-w-0 font-mono text-xs text-muted-foreground">
                  <div>Network: {a.chain}</div>
                  <div className="mt-1 truncate">Transaction: {a.txHash ?? "not yet submitted"}</div>
                  {a.ipfsCid ? <div className="mt-1 truncate">IPFS CID: {a.ipfsCid}</div> : null}
                  {a.status === "confirmed" && a.confirmations ? <div className="mt-1">Confirmations: {a.confirmations}</div> : null}
                  <div className="mt-1">Recorded {fmtDateTime(a.createdAt)}</div>
                </div>
                <Status value={anchorSummary([a])} />
              </div>
            ))}
          </div>
        ) : <Empty text="No blockchain record has been created for this rejection yet." />}
      </Panel>
      <Panel title="Decision history" subtitle="All Gate 1 decisions recorded for this item">
        {decisions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Reference</th><th>Decision</th><th>Reason</th><th>Decided by</th><th>Timestamp</th></tr></thead>
              <tbody>{decisions.map((d) => (
                <tr key={d.id} className="border-b last:border-0"><td className="py-3 font-mono text-xs">DEC-{d.id}</td><td>{gateLabel(d.gate)}<div className="text-xs text-muted-foreground">{decisionLabel(d.decision)}</div></td><td>{d.decision === "rejected" ? reasonText(d.reasonCode, d.notes, reasons) : "—"}</td><td>{d.decidedBy}</td><td>{fmtDateTime(d.at)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty text="No decisions recorded." />}
      </Panel>
    </>
  );
}

export function ProductTracking() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const product = useProduct(selectedId);
  const reasons = useReasonDescriptions();
  const l = product.data;
  return (
    <>
      <PageIntro title="Product Tracking" detail="Item identity, current location, movement history and verification status." />
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <ProductPicker selectedId={selectedId} onSelect={setSelectedId} />
        <div className="space-y-6">
          <Async loading={product.loading} error={product.error} onRetry={product.reload}>
            {l && l.detail.status === "rejected" ? <RejectionRecord loaded={l} reasons={reasons} /> : l ? (
              <>
                <Panel title={`${productLabel(l.detail)} · Product details`} subtitle={`RFID UID ${l.detail.rfidUid}`}>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="Current stage" value={stageLabel(l.detail.stage)} />
                    <Fact label="Current department" value={l.detail.department} />
                    <Fact label="Registered" value={fmtDateTime(l.detail.createdAt)} />
                    <Fact label="Purchase order" value={l.detail.poNumber ?? "—"} />
                  </div>
                  <div className="mt-5"><Journey stage={l.detail.stage} status={l.detail.status} /></div>
                </Panel>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Panel title="Product information">
                    <div className="space-y-3">
                      <FactRow label="Material" value={l.detail.material ?? "—"} />
                      <FactRow label="Supplier" value={l.detail.supplier ?? "—"} />
                      <FactRow label="Received quantity" value={fmtNumber(l.detail.receipt?.receivedQty)} />
                      <FactRow label="Expected next stage" value={l.detail.nextStages.length ? l.detail.nextStages.map((n) => stageLabel(n.stage)).join(" / ") : "Complete"} />
                      <FactRow label="Status" value={productStatus(l.detail)} />
                    </div>
                  </Panel>
                  <Panel title="Verification">
                    <div className="space-y-3">
                      <Verify label="Record integrity (hash chain)" status={l.verification.chainValid ? "Verified" : "Invalid"} />
                      <Verify label={`Stage transitions (${l.verification.transitionCount})`} status={l.verification.transitionCount > 0 ? "Completed" : "Pending"} />
                      <Verify label="Blockchain anchors" status={anchorSummary(l.verification.anchors)} />
                      <Verify label="Shipment" status={l.detail.status === "shipped" ? "Shipped" : l.detail.status === "ready_for_shipment" ? "Ready for Shipment" : "Pending"} />
                    </div>
                  </Panel>
                </div>
                <EventTable timeline={l.history.timeline} reasons={reasons} />
              </>
            ) : <Empty text="Select a product to view its details." />}
          </Async>
        </div>
      </div>
    </>
  );
}
