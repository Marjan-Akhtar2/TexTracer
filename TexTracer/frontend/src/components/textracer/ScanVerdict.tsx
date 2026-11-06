import { AlertTriangle, Check, Radio, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { productsApi, type ProductDetail, type ProductHistory, type ScanLogRow, type StageInfo } from "@/lib/api";
import { factsFromLog, interpretScan, type ScanInterpretation, type Tone } from "@/lib/scanInterpretation";
import { useApi } from "@/lib/useApi";
import { Async, FactRow } from "@/components/textracer/ui";

const TONE: Record<Tone, { box: string; text: string }> = {
  success: { box: "border-success/30 bg-success/10", text: "text-success" },
  danger: { box: "border-destructive/30 bg-destructive/10", text: "text-destructive" },
  warning: { box: "border-warning/40 bg-warning/10", text: "text-warning-foreground" },
  info: { box: "border-border bg-muted", text: "text-foreground" },
};

function ToneIcon({ tone }: { tone: Tone }) {
  const cls = cn("h-5 w-5 shrink-0", TONE[tone].text);
  return tone === "success" ? <Check className={cls} /> : tone === "danger" ? <X className={cls} /> : tone === "warning" ? <AlertTriangle className={cls} /> : <Radio className={cls} />;
}

/**
 * The two-part scan result:
 *  1. RFID DETECTED   - what the reader saw and how it maps (product, reader, previous / expected / detected stage).
 *  2. SCAN VALIDATION - the backend's verdict explained in words, and whether the official stage changed.
 * Detection and validation are shown separately on purpose: a detected tag is not necessarily an accepted stage move.
 */
export function ScanVerdictCard({ it }: { it: ScanInterpretation }) {
  const tone = TONE[it.tone];
  return (
    <div className="space-y-4">
      <section className="rounded-md border p-4" aria-label="RFID detected">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide"><Radio className="h-4 w-4 text-primary" />RFID DETECTED</div>
        <div className="space-y-3">{it.facts.map((f) => <FactRow key={f.label} label={f.label} value={f.value} />)}</div>
      </section>
      <section className={cn("rounded-md border p-4", tone.box)} role="status" aria-label="Scan validation">
        <div className={cn("flex items-center gap-2 text-sm font-semibold", tone.text)}><ToneIcon tone={it.tone} />SCAN VALIDATION: {it.title}</div>
        <p className="mt-3 text-sm">{it.explanation}</p>
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{it.transitionApplied ? "Stage transition accepted. " : "Official stage unchanged. "}</span>{it.transitionNote}</p>
      </section>
    </div>
  );
}

interface ScanContext { product: ProductDetail | null; history: ProductHistory | null }

/**
 * Explains ONE row of the scan log. Loads the product and its append-only history (best effort: a role that may not
 * read product data, e.g. the System Administrator, still gets an explanation built from the log row itself).
 * Read-only: it only calls GET endpoints.
 */
export function ScanDetail({ row, graph }: { row: ScanLogRow; graph: readonly StageInfo[] }) {
  const ctx = useApi<ScanContext>(async () => {
    if (!row.productId) return { product: null, history: null };
    const [product, history] = await Promise.all([
      productsApi.get(row.productId).catch(() => null),
      productsApi.history(row.productId).catch(() => null),
    ]);
    return { product, history };
  }, [row.id, row.productId]);
  const it = interpretScan(factsFromLog(row, { graph, product: ctx.data?.product ?? null, history: ctx.data?.history ?? null }), graph);
  return <Async loading={ctx.loading} error={ctx.error} onRetry={ctx.reload}><ScanVerdictCard it={it} /></Async>;
}
