import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auditApi, type ApiResult, type AuditDecision, type AuditTransition } from "@/lib/api";

type DecisionsResult = ApiResult<AuditDecision[]>;
type TransitionsResult = ApiResult<AuditTransition[]>;
import { cn } from "@/lib/utils";
import { decisionLabel, fmtDateTime, gateLabel, stageLabel } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import { reasonText } from "@/lib/labels";
import { useReasonDescriptions } from "@/lib/reasons";
import { Async, Empty, PageIntro, Pager, Panel, selectCls, Status } from "@/components/textracer/ui";
import { anchorSummary } from "@/views/tracking";

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

/** Auditor's global, read-only history: gate decisions (GET /audit/decisions) and stage transitions (GET /audit/transitions). */
export function Audit() {
  const reasonMap = useReasonDescriptions();
  const [tab, setTab] = useState<"decisions" | "transitions">("decisions");
  const [gate, setGate] = useState("");
  const [decision, setDecision] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [tab, gate, decision, kind, from, to]);

  const decisions = useApi<DecisionsResult | null>(
    async () => (tab === "decisions" ? await auditApi.decisions({ gate, decision, from: dayStart(from), to: dayEnd(to), page, limit: 25 }) : null),
    [tab, gate, decision, from, to, page],
  );
  const transitions = useApi<TransitionsResult | null>(
    async () => (tab === "transitions" ? await auditApi.transitions({ kind, from: dayStart(from), to: dayEnd(to), page, limit: 25 }) : null),
    [tab, kind, from, to, page],
  );
  const active = tab === "decisions" ? decisions : transitions;
  const q = query.trim().toLowerCase();

  const decisionRows = useMemo(
    () => (decisions.data?.data ?? []).filter((r) => !q || [r.rfidUid, r.gate, r.decision, r.reasonCode, r.decidedBy, r.notes].join(" ").toLowerCase().includes(q)),
    [decisions.data, q],
  );
  const transitionRows = useMemo(
    () => (transitions.data?.data ?? []).filter((r) => !q || [r.rfidUid, r.kind, r.fromStage, r.toStage, r.readerCode, r.actorName].join(" ").toLowerCase().includes(q)),
    [transitions.data, q],
  );
  const meta = active.data?.meta;

  return (
    <>
      <PageIntro title="Audit History" detail="Complete approval, rejection, rework and stage-movement history." badge="Read-only" />
      <Panel title="Event ledger" subtitle={`${meta?.total ?? 0} record(s) match the filters${q ? " · text filter applies to this page" : ""}`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(["decisions", "transitions"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t === "decisions" ? "Gate decisions" : "Stage transitions"}</Button>
          ))}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 max-w-md flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter this page: UID, user, reason…" aria-label="Filter audit records" className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          {tab === "decisions" ? (
            <>
              <select value={gate} onChange={(e) => setGate(e.target.value)} aria-label="Gate" className={selectCls}><option value="">All gates</option><option value="gate1_intake">Gate 1</option><option value="gate2_qc">Gate 2</option><option value="gate3_shipment">Gate 3</option></select>
              <select value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="Decision" className={selectCls}><option value="">All decisions</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="ready_for_shipment">Ready for shipment</option></select>
            </>
          ) : (
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Transition kind" className={selectCls}><option value="">All kinds</option><option value="initial">Initial</option><option value="forward">Forward</option><option value="rework">Rework</option></select>
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(selectCls, "px-2")} /></label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={cn(selectCls, "px-2")} /></label>
        </div>
        <Async loading={active.loading} error={active.error} onRetry={active.reload}>
          {tab === "decisions" ? (
            decisionRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Reference</th><th>RFID UID</th><th>Gate / Decision</th><th>Decided by</th><th>Timestamp</th><th>Reason</th><th>Blockchain record</th></tr></thead>
                  <tbody>
                    {decisionRows.map((r) => (
                      <tr key={`${r.inspectionId}-${r.chain ?? "none"}`} className="border-b">
                        <td className="py-3 font-mono text-xs">DEC-{r.inspectionId}{r.supersedesId && <div className="text-[10px] text-muted-foreground">supersedes DEC-{r.supersedesId}</div>}</td>
                        <td className="font-mono text-xs font-semibold">{r.rfidUid}</td>
                        <td>{gateLabel(r.gate)}<div className="text-xs text-muted-foreground">{decisionLabel(r.decision)}</div></td>
                        <td>{r.decidedBy}</td>
                        <td>{fmtDateTime(r.decidedAt)}</td>
                        <td>{reasonText(r.reasonCode, r.notes, reasonMap)}{r.notes && r.reasonCode && !/^(OTHER|CUSTOM)/i.test(r.reasonCode) && <div className="max-w-48 truncate text-xs text-muted-foreground">{r.notes}</div>}</td>
                        <td><Status value={anchorSummary(r.anchorStatus ? [{ status: r.anchorStatus }] : [])} /><div className="mt-1 max-w-36 truncate font-mono text-[10px] text-muted-foreground">{r.ipfsCid ?? (r.chain ? `${r.chain} · ${r.anchorStatus}` : "No blockchain record")}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty text="No audit decisions found." />
          ) : transitionRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Event</th><th>RFID UID</th><th>Kind</th><th>From → To</th><th>Reader / User</th><th>Timestamp</th><th>Row hash</th></tr></thead>
                <tbody>
                  {transitionRows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-3 font-mono text-xs">TR-{r.id}</td>
                      <td className="font-mono text-xs font-semibold">{r.rfidUid}</td>
                      <td className="capitalize">{r.kind}</td>
                      <td>{r.fromStage ? stageLabel(r.fromStage) : "—"} → {stageLabel(r.toStage)}</td>
                      <td>{r.readerCode ?? "—"}<div className="text-xs text-muted-foreground">{r.actorName ?? "System"}</div></td>
                      <td>{fmtDateTime(r.occurredAt)}</td>
                      <td className="max-w-32 truncate font-mono text-[10px] text-muted-foreground">{r.rowHash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="No stage transitions found." />}
        </Async>
        <Pager page={meta?.page ?? page} pages={meta?.pages ?? 1} total={meta?.total ?? 0} onPage={setPage} />
      </Panel>
    </>
  );
}
