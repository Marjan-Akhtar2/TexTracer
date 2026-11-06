import { useState } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { scansApi, stagesApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDateTime, scanResultLabel, stageLabel } from "@/lib/labels";
import { humanizeDetail } from "@/lib/scanInterpretation";
import { useApi } from "@/lib/useApi";
import { Async, Empty, PageIntro, Panel, Status } from "@/components/textracer/ui";
import { ScanDetail } from "@/components/textracer/ScanVerdict";

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-GB");
};
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
/** Human explanation of what a reader request returned, so a misconfigured reader is obvious. */
export function outcomeLabel(status: number, outcome: string): string {
  if (outcome === "INVALID_DEVICE_KEY") return "Rejected · wrong or missing device key";
  if (outcome === "RATE_LIMITED") return "Failed · rate limited";
  if (outcome === "INTERNAL_ERROR") return "Failed · server / database error";
  if (outcome === "VALIDATION_ERROR" || outcome === "BAD_REQUEST") return "Failed · invalid request";
  if (/^(accepted|duplicate|rejected_)/.test(outcome)) return scanResultLabel(outcome);
  return status >= 400 ? `Failed · ${outcome}` : outcome;
}

/** Live view of what the ESP32 readers are sending to the backend (including requests that were refused). */
export function DeviceActivityPanel() {
  const act = useApi(() => scansApi.deviceActivity(), [], 3_000);
  return (
    <Panel title="Reader connection status" subtitle="Every request the readers make to the backend since it started, including refused ones. Refreshes every 3 seconds.">
      <Async loading={act.loading} error={act.error} onRetry={act.reload}>
        {(act.data?.readers.length ?? 0) > 0 ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-2">Reader</th><th>Last contact</th><th>From IP</th><th>Last result</th><th>Requests</th><th>Failed</th></tr></thead>
                <tbody>
                  {act.data?.readers.map((r) => (
                    <tr key={r.readerCode} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs font-semibold">{r.readerCode}</td>
                      <td>{ago(r.lastContactAt)}</td><td className="font-mono text-xs">{r.lastIp.replace("::ffff:", "")}</td>
                      <td><Status value={outcomeLabel(r.lastHttpStatus, r.lastOutcome)} /></td>
                      <td>{r.attempts}</td><td>{r.failures}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
              {act.data?.recent.slice(0, 15).map((a, i) => (
                <div key={`${a.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5">
                  <span className="font-mono">{time(a.at)} · {a.readerCode ?? "?"} · {a.rfidUid ?? "—"}</span>
                  <span className="text-muted-foreground">HTTP {a.httpStatus} · {a.message ?? a.outcome}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <Empty text="No reader has contacted the backend since it started. Check the ESP32 Serial Monitor, Wi-Fi, BACKEND_HOST and the laptop firewall (see RUN_GUIDE.md)." />}
      </Async>
    </Panel>
  );
}

/** All recent scans from every reader plus reader connection status. */
export function LiveScans() {
  const log = useApi(() => scansApi.list({ limit: 30 }), [], 3_000);
  const stages = useApi(() => stagesApi.list(), []);
  const [pinned, setPinned] = useState<number | null>(null);
  const rows = log.data?.data ?? [];
  // Follow the newest scan automatically, unless the user clicked an older row to inspect it.
  const selected = rows.find((r) => r.id === pinned) ?? rows[0] ?? null;
  const showing = pinned !== null && rows.some((r) => r.id === pinned);
  return (
    <>
      <PageIntro title="Live RFID Scans" detail="Scans recorded by the readers, newest first. Every attempt is stored, including rejected ones. A detected tag is not always an accepted stage move; the validation result says which." />
      <div className="grid gap-6">
        <Panel
          title="Scan interpretation"
          subtitle={showing ? "Showing the scan you selected." : "Showing the latest scan from any reader. Updates automatically."}
          action={showing ? <Button size="sm" variant="outline" onClick={() => setPinned(null)}>Follow latest</Button> : undefined}
        >
          {selected ? <ScanDetail key={selected.id} row={selected} graph={stages.data ?? []} /> : <Empty text="No scans yet. Tap a tag on any reader and its validation result appears here." />}
        </Panel>
        <DeviceActivityPanel />
        <Panel title="Recorded scans" subtitle="From the scan_logs table in the database. Refreshes every 3 seconds. Select a row to see its full explanation.">
          <Async loading={log.loading} error={log.error} onRetry={log.reload}>
            {rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-2">Time</th><th>Reader</th><th>Stage</th><th>RFID UID</th><th>Result</th><th>Detail</th></tr></thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr
                        key={s.id} tabIndex={0} aria-selected={s.id === selected?.id}
                        onClick={() => setPinned(s.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPinned(s.id); } }}
                        className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring", s.id === selected?.id && "bg-accent")}
                      >
                        <td className="py-2 text-xs">{fmtDateTime(s.scannedAt)}</td>
                        <td className="font-mono text-xs"><Radio className="mr-1 inline h-3 w-3" />{s.readerCode}</td>
                        <td>{stageLabel(s.stage)}</td><td className="font-mono text-xs">{s.rfidUid}</td>
                        <td><Status value={scanResultLabel(s.result)} /></td>
                        <td className="text-xs text-muted-foreground">{humanizeDetail(s.detail)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty text="No scans recorded yet." />}
          </Async>
        </Panel>
      </div>
    </>
  );
}
