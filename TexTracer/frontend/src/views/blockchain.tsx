import { useState } from "react";
import { AlertLine, Async, Empty, GateCard, PageIntro, Panel, Status } from "@/components/textracer/ui";
import { fmtDateTime, gateLabel, decisionLabel, productLabel } from "@/lib/labels";
import type { GateCode } from "@/lib/api";
import { anchorSummary, ProductPicker, useProduct } from "@/views/tracking";

const GATES: { code: GateCode; number: string; title: string; detail: string }[] = [
  { code: "gate1_intake", number: "1", title: "Raw Material Intake", detail: "Acceptance and rejection" },
  { code: "gate2_qc", number: "2", title: "Stitching / QC", detail: "Approval, failure, and rework" },
  { code: "gate3_shipment", number: "3", title: "Before Shipment", detail: "Production Complete → Ready for Shipment" },
];

/** Per-product verification (GET /products/:id/verification): database hash chain + anchor queue status. */
export function Blockchain() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const product = useProduct(selectedId);
  const l = product.data;
  return (
    <>
      <PageIntro title="Blockchain Verification" detail="Record integrity and blockchain status for decisions at Gate 1, Gate 2 and Gate 3." />
      <div className="mb-6">
        <AlertLine title="MultiChain anchoring" detail="Each gate decision is queued by the database and published to the MultiChain ledger by the backend worker. Status moves from pending to submitted to confirmed once the transaction is in a block." />
      </div>
      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <ProductPicker selectedId={selectedId} onSelect={setSelectedId} />
        <div className="space-y-6">
          <Async loading={product.loading} error={product.error} onRetry={product.reload}>
            {l ? (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  {GATES.map((g) => {
                    const anchors = l.verification.anchors.filter((a) => a.gate === g.code);
                    return <GateCard key={g.code} number={g.number} title={g.title} detail={g.detail} status={anchors.length ? anchorSummary(anchors) : "No decision yet"} />;
                  })}
                </div>
                <Panel title={`${productLabel(l.detail)} · blockchain records`} subtitle={`Record chain over ${l.verification.transitionCount} stage transition(s): ${l.verification.chainValid ? "valid" : "broken"}`}>
                  {l.verification.anchors.length ? (
                    <div className="space-y-3">
                      {l.verification.anchors.map((a) => (
                        <div key={a.id} className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_1fr_auto]">
                          <div><b>{gateLabel(a.gate)} · {decisionLabel(a.decision)}</b><p className="mt-1 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)} · {a.chain}</p></div>
                          <div className="min-w-0 font-mono text-xs text-muted-foreground">
                            <div className="truncate">TX: {a.txHash ?? "not submitted"}</div>
                            <div className="mt-1 truncate">CID: {a.ipfsCid ?? "not uploaded"}</div>
                            <div className="mt-1">Metadata hash: {a.metadataHashValid ? "matches" : "MISMATCH"}</div>
                          </div>
                          <Status value={a.status} />
                        </div>
                      ))}
                    </div>
                  ) : <Empty text="No gate decisions have been recorded on the blockchain for this item yet." />}
                </Panel>
              </>
            ) : <Empty text="Select a product to see its verification." />}
          </Async>
        </div>
      </div>
    </>
  );
}
