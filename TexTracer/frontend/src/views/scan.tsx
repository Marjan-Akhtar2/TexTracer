import { useEffect, useState, type FormEvent } from "react";
import { Radio, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, productsApi, readersApi, scansApi, stagesApi, type ProductDetail, type ScanLogRow, type ScanOutcomeInfo } from "@/lib/api";
import { errorMessage, fmtDateTime, fmtNumber, productLabel, productStatus, scanResultLabel, stageLabel } from "@/lib/labels";
import { factsFromOutcome, humanizeDetail, interpretScan, type ScanFacts } from "@/lib/scanInterpretation";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";
import { Async, Empty, FactRow, PageIntro, Panel, selectCls, Status } from "@/components/textracer/ui";
import { RfidField, RFID_UID_PATTERN } from "@/components/textracer/RfidField";
import { ScanDetail, ScanVerdictCard } from "@/components/textracer/ScanVerdict";

type Shown = { facts: ScanFacts; time: string };

/** Department Officer scans an RFID tag at a reader of their own department (POST /scans). */
export function ScanWorkspace() {
  const { user } = useSession();
  const readers = useApi(() => readersApi.list(), []);
  const log = useApi(() => scansApi.list({ limit: 15 }), [], 4_000);
  const mine = (readers.data ?? []).filter((r) => r.departmentId === user?.departmentId && r.isActive);
  const [uid, setUid] = useState("");
  const [readerCode, setReaderCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [openScan, setOpenScan] = useState<ScanLogRow | null>(null);
  // The database's own transition table (GET /stages): "expected next stage" is read from it, never hardcoded here.
  const stages = useApi(() => stagesApi.list(), []);
  const graph = stages.data ?? [];
  const shownIt = shown ? interpretScan(shown.facts, graph) : null;

  useEffect(() => { if (!readerCode && mine[0]) setReaderCode(mine[0].code); }, [mine, readerCode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = uid.trim().toUpperCase();
    if (!RFID_UID_PATTERN.test(clean)) { setError("Scan an RFID tag first. The UID must be 8–20 hexadecimal characters."); return; }
    if (!readerCode) { setError("Select a reader."); return; }
    setBusy(true); setError("");
    const time = new Date().toISOString();
    const readerStage = mine.find((r) => r.code === readerCode)?.stage ?? null;
    try {
      const outcome = await scansApi.scan(clean, readerCode);
      setShown({ facts: factsFromOutcome(outcome, { uid: clean, readerCode, readerStage }), time });
      setUid("");
    } catch (err) {
      const d = err instanceof ApiError ? (err.details as Partial<ScanOutcomeInfo> | undefined) : undefined;
      if (err instanceof ApiError && d && typeof d.result === "string") {
        const outcome: ScanOutcomeInfo = { result: d.result, productId: d.productId ?? null, fromStage: d.fromStage ?? null, toStage: d.toStage ?? null, detail: d.detail ?? null };
        // A rejected reply carries no product. Look it up (read-only, best effort) so the explanation can name it and see rework state.
        const product = outcome.productId ? await productsApi.get(outcome.productId).catch(() => null) : null;
        setShown({ facts: factsFromOutcome(outcome, { uid: clean, readerCode, readerStage, product }), time });
      } else setError(errorMessage(err));
    } finally { setBusy(false); log.reload(); }
  }

  return (
    <>
      <PageIntro title="RFID Scan" detail="Record an item arriving at your department. The system checks the production sequence and gate approvals." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Scan an item" subtitle={user?.department ? `Readers assigned to ${user.department}` : "No department assigned to this account"}>
          <Async loading={readers.loading} error={readers.error} onRetry={readers.reload}>
            {mine.length ? (
              <form onSubmit={submit} className="flex flex-col gap-3">
                <label className="text-sm font-medium" htmlFor="scan-uid">RFID tag UID</label>
                <RfidField id="scan-uid" value={uid} onChange={(v) => { setUid(v); setError(""); }} />
                <label className="text-sm font-medium" htmlFor="scan-reader">Reader</label>
                <select id="scan-reader" className={`${selectCls} w-full`} value={readerCode} onChange={(e) => setReaderCode(e.target.value)}>
                  {mine.map((r) => <option key={r.id} value={r.code}>{r.code} · {stageLabel(r.stage)}</option>)}
                </select>
                {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
                <Button type="submit" disabled={busy || !uid}><Radio />{busy ? "Recording…" : "Record scan"}</Button>
              </form>
            ) : <Empty text={user?.departmentId ? "No active readers are configured for your department." : "This account has no department assigned, so it cannot record scans."} />}
          </Async>
        </Panel>
        <Panel title="Recent scans" subtitle="Latest scans at your department's readers, including those submitted by the readers themselves. Select one for its full explanation. Refreshes every 4 seconds.">
          <Async loading={log.loading} error={log.error} onRetry={log.reload}>
            {(log.data?.data.length ?? 0) > 0 ? (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {log.data?.data.map((s) => (
                  <button key={s.id} type="button" onClick={() => setOpenScan(s)} className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left text-xs hover:bg-muted">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold">{s.rfidUid}</div>
                      <div className="text-muted-foreground">{s.readerCode} · {fmtDateTime(s.scannedAt)}</div>
                      {s.result !== "accepted" && s.detail && <div className="mt-1 truncate text-muted-foreground">{humanizeDetail(s.detail)}</div>}
                    </div>
                    <Status value={scanResultLabel(s.result)} />
                  </button>
                ))}
              </div>
            ) : <Empty text="No scans recorded yet." />}
          </Async>
        </Panel>
      </div>
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {shown && shownIt && (
            <>
              <DialogHeader>
                <DialogTitle>{shownIt.verdict === "valid" ? "Scan accepted" : "Tag detected · stage not changed"}</DialogTitle>
                <DialogDescription>
                  {shownIt.transitionApplied
                    ? "The tag was detected and the move to the next stage was accepted."
                    : "The reader detected the tag, but the system did not move the product. The attempt has been logged."}
                </DialogDescription>
              </DialogHeader>
              <ScanVerdictCard it={shownIt} />
              <p className="text-xs text-muted-foreground">Scanned {fmtDateTime(shown.time)}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!openScan} onOpenChange={(o) => !o && setOpenScan(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {openScan && (
            <>
              <DialogHeader>
                <DialogTitle>Scan details</DialogTitle>
                <DialogDescription>{fmtDateTime(openScan.scannedAt)} · {openScan.readerCode}</DialogDescription>
              </DialogHeader>
              <ScanDetail row={openScan} graph={graph} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Gate 1 tag check for the Warehouse Manager. Reuses the RFID field used by the Department Officer scan screen.
 * The Warehouse Manager role cannot post scans (POST /scans is for department readers); this screen looks the tag up
 * (GET /products/by-uid/:uid) and routes unregistered tags to material registration.
 */
export function IntakeScan({ onRegister }: { onRegister: () => void }) {
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ uid: string; product: ProductDetail | null } | null>(null);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    const clean = uid.trim().toUpperCase();
    if (!RFID_UID_PATTERN.test(clean)) { setError("Scan an RFID tag first. The UID must be 8–20 hexadecimal characters."); return; }
    setBusy(true); setError(""); setResult(null);
    try { setResult({ uid: clean, product: await productsApi.byUid(clean) }); }
    catch (err) {
      if (err instanceof ApiError && err.status === 404) setResult({ uid: clean, product: null });
      else setError(errorMessage(err));
    } finally { setBusy(false); }
  }

  const tapped = useApi(() => scansApi.unregistered({ minutes: 1440, limit: 8 }), [], 3_000);
  const p = result?.product ?? null;
  return (
    <>
      <PageIntro title="RFID Scan" detail="Identify a tag at Gate 1 before registering or reviewing incoming raw material." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Scan a tag" subtitle="Gate 1 · Raw Material Intake">
          <form onSubmit={lookup} className="flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="intake-uid">RFID tag UID</label>
            <RfidField id="intake-uid" value={uid} onChange={(v) => { setUid(v); setError(""); setResult(null); }} />
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <Button type="submit" disabled={busy || !uid}><ScanLine />{busy ? "Checking…" : "Check tag"}</Button>
          </form>
        </Panel>
        <Panel title="Tags just tapped on the readers" subtitle="Unregistered tags seen by the ESP32 readers in the last 24 hours. Click one to look it up, then register it." className="lg:col-span-2">
          {(tapped.data?.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tapped.data?.map((t) => (
                <button key={t.rfidUid} type="button" onClick={() => { setUid(t.rfidUid); setError(""); setResult(null); }}
                  className="rounded-md border px-3 py-2 text-left text-xs hover:bg-muted">
                  <div className="font-mono font-semibold">{t.rfidUid}</div>
                  <div className="text-muted-foreground">{t.readerCode} · {fmtDateTime(t.lastSeenAt)}{t.timesSeen > 1 ? ` · ${t.timesSeen}×` : ""}</div>
                </button>
              ))}
            </div>
          ) : <Empty text="No unregistered tag has been tapped on a reader recently. Tap a new tag on any reader and it appears here." />}
        </Panel>
        <Panel title="Tag status" subtitle={result ? `UID ${result.uid}` : "Scan a tag to see its status"}>
          {!result ? <Empty text="No tag scanned yet." /> : p ? (
            <div className="space-y-3">
              <FactRow label="Item" value={productLabel(p)} />
              <FactRow label="Status" value={productStatus(p)} />
              <FactRow label="Current stage" value={stageLabel(p.stage)} />
              <FactRow label="Purchase order" value={p.poNumber ?? "—"} />
              <FactRow label="Material" value={p.material ?? "—"} />
              <FactRow label="Received quantity" value={fmtNumber(p.receipt?.receivedQty)} />
              <FactRow label="Registered" value={fmtDateTime(p.createdAt)} />
              {p.awaitingGate === "gate1_intake" && <p className="rounded-md border bg-muted p-3 text-xs text-muted-foreground">This material is waiting for a Gate 1 decision. Open Raw Material Intake to approve or reject it.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <Status value="Not registered" />
              <p className="text-sm text-muted-foreground">No item is assigned to this tag. Register the received material to link the tag to a purchase order.</p>
              <Button variant="outline" onClick={onRegister}>Go to Raw Material Intake</Button>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
