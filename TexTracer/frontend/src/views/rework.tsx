import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reworkApi, type ReworkCase } from "@/lib/api";
import { errorMessage, fmtDateTime, productLabel, productStatus } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";
import { reasonText } from "@/lib/labels";
import { useReasonDescriptions } from "@/lib/reasons";
import { Async, Empty, PageIntro, Panel, Status, textareaCls } from "@/components/textracer/ui";

/** Rework queue (GET /rework). Only a Production officer can complete rework (POST /rework/:id/complete). */
export function Rework() {
  const { user } = useSession();
  const reasonMap = useReasonDescriptions();
  const canComplete = user?.role === "department_officer" && user.department === "Production";
  const list = useApi(() => reworkApi.list({ limit: 100 }), []);
  const [active, setActive] = useState<ReworkCase | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = list.data?.data ?? [];

  async function complete() {
    if (!active) return;
    setBusy(true); setError("");
    try {
      await reworkApi.complete(active.id, notes.trim() || undefined);
      toast.success("Rework completed. The item is back with QC for re-inspection.");
      setActive(null); setNotes(""); list.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageIntro title="Rework Queue" detail="Items that failed QC and were returned to Production. Original QC decisions are not changed." />
      <Panel title="Production rework" subtitle={`${list.data?.meta.total ?? 0} item(s) currently in rework`}>
        <Async loading={list.loading} error={list.error} onRetry={list.reload}>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Product</th><th>RFID UID</th><th>QC failure</th><th>Rejected by</th><th>Status</th><th className="text-right">Action</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-3 font-semibold">{productLabel(r)}<div className="text-xs font-normal text-muted-foreground">{r.poNumber ?? "—"} · loops: {r.reworkCount}</div></td>
                      <td className="font-mono text-xs">{r.rfidUid}</td>
                      <td>{reasonText(r.reasonCode, r.rejectionNotes, reasonMap)}{r.rejectionNotes && !/^(OTHER|CUSTOM)/i.test(r.reasonCode ?? "") && <div className="max-w-56 truncate text-xs text-muted-foreground">{r.rejectionNotes}</div>}</td>
                      <td>{r.rejectedBy ?? "—"}<div className="text-xs text-muted-foreground">{fmtDateTime(r.rejectedAt)}</div></td>
                      <td><Status value={productStatus(r)} />{r.completedAt && <div className="mt-1 text-xs text-muted-foreground">Completed {fmtDateTime(r.completedAt)}</div>}</td>
                      <td className="text-right">
                        {canComplete
                          ? <Button size="sm" disabled={r.reworkCompleted} onClick={() => { setActive(r); setError(""); }}>{r.reworkCompleted ? "Returned to QC" : "Complete rework and return to QC"}</Button>
                          : <span className="text-xs text-muted-foreground">{r.assignedDepartment}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="No items currently require rework." />}
        </Async>
      </Panel>
      <Dialog open={!!active} onOpenChange={(o) => { if (!o && !busy) setActive(null); }}>
        <DialogContent>
          {active && (
            <>
              <DialogHeader><DialogTitle>Complete rework · {productLabel(active)}</DialogTitle><DialogDescription>This tells QC the item is ready to be inspected again.</DialogDescription></DialogHeader>
              <label className="text-sm font-medium" htmlFor="rework-notes">Notes (optional)</label>
              <textarea id="rework-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={textareaCls} placeholder="What was corrected?" />
              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
              <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setActive(null)}>Cancel</Button><Button disabled={busy} onClick={complete}>Confirm</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
