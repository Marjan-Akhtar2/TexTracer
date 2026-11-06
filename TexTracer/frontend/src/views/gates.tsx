import { useEffect, useState, type ReactNode } from "react";
import { Check, Eye, PackageCheck, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, approvalsApi, productsApi, purchaseOrdersApi, scansApi, type GateCode, type ProductDetail, type ProductRow, type ReasonCode, type PurchaseOrder } from "@/lib/api";
import { CUSTOM_REASON, errorMessage, fmtDateTime, fmtNumber, isGenericReason, productLabel, productStatus, stageLabel } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import { Async, AlertLine, Empty, Fact, FlowStep, inputCls, PageIntro, Panel, ProductTable, selectCls, textareaCls } from "@/components/textracer/ui";
import { RfidField, RFID_UID_PATTERN } from "@/components/textracer/RfidField";
import { RejectionRecord, useProduct } from "@/views/tracking";
import { useReasonDescriptions } from "@/lib/reasons";

/* ---------------------------- shared decision dialog ---------------------------- */
function DecisionDialog({ product, gate, reasons, approveLabel, rejectLabel, title, onClose, onDone, children }: {
  product: ProductRow; gate: GateCode; reasons: ReasonCode[]; approveLabel: string; rejectLabel?: string; title: string;
  onClose: () => void; onDone: () => void; children?: ReactNode;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isGate3 = gate === "gate3_shipment";
  const allowCustom = gate === "gate1_intake";
  const genericReason = reasons.find((r) => isGenericReason(r.code));
  const listedReasons = allowCustom ? reasons.filter((r) => !isGenericReason(r.code)) : reasons;
  const isCustom = reasonCode === CUSTOM_REASON;

  async function submit(decision: "approved" | "rejected" | "ready_for_shipment") {
    if (decision === "rejected" && !reasonCode) { setError("Select a rejection reason."); return; }
    let code = reasonCode;
    let finalNotes = notes.trim();
    if (decision === "rejected" && isCustom) {
      const text = customReason.trim();
      if (text.length < 3) { setError("Enter the rejection reason."); return; }
      if (!genericReason) { setError("Custom reasons are not enabled for this gate yet. Ask your administrator to add an 'Other' rejection reason (see the README note)."); return; }
      code = genericReason.code;
      finalNotes = finalNotes ? `${text}. ${finalNotes}` : text;
    }
    setBusy(true); setError("");
    try {
      await approvalsApi.decide(product.id, {
        gate, decision,
        reasonCode: decision === "rejected" ? code : undefined,
        notes: finalNotes.slice(0, 500) || undefined,
      });
      toast.success(decision === "rejected" ? "Rejection recorded" : isGate3 ? "Item marked ready for shipment" : "Approval recorded");
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title} {productLabel(product)}</DialogTitle>
          <DialogDescription>{product.poNumber ? `Purchase order ${product.poNumber}` : "No purchase order"}{product.supplier ? ` · ${product.supplier}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 rounded-md bg-muted p-4 text-sm">
          <Fact label="Material" value={product.material ?? "—"} />
          <Fact label="Ordered quantity" value={fmtNumber(product.poQuantity)} />
          <Fact label="RFID UID" value={product.rfidUid} />
          <Fact label="Status" value={productStatus(product)} />
          <Fact label="Stage" value={stageLabel(product.stage)} />
          <Fact label="Rework loops" value={String(product.reworkCount)} />
        </div>
        {children}
        {!isGate3 && rejecting && (
          <div>
            <label className="text-sm font-medium" htmlFor="reason-code">Rejection reason</label>
            <select id="reason-code" value={reasonCode} onChange={(e) => { setReasonCode(e.target.value); setError(""); }} className={`${selectCls} mt-2 w-full`}>
              <option value="">Select a reason…</option>
              {listedReasons.map((r) => <option key={r.code} value={r.code}>{r.description}</option>)}
              {allowCustom && <option value={CUSTOM_REASON}>Other (enter a reason)</option>}
            </select>
            {allowCustom && isCustom && (
              <div className="mt-3">
                <label className="text-sm font-medium" htmlFor="custom-reason">Rejection reason</label>
                <input id="custom-reason" value={customReason} maxLength={300} onChange={(e) => { setCustomReason(e.target.value); setError(""); }} className={cn(inputCls, "mt-1")} placeholder="Describe why this material is rejected" />
              </div>
            )}
          </div>
        )}
        <div>
          <label className="text-sm font-medium" htmlFor="decision-notes">Additional notes (optional)</label>
          <textarea id="decision-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={textareaCls} placeholder="Added to the audit record" />
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          {isGate3 ? (
            <Button disabled={busy} onClick={() => submit("ready_for_shipment")}><PackageCheck />{approveLabel}</Button>
          ) : rejecting ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => { setRejecting(false); setError(""); }}>Cancel</Button>
              <Button variant="destructive" disabled={busy} onClick={() => submit("rejected")}>{busy ? "Saving…" : (rejectLabel ?? "Confirm rejection")}</Button>
            </>
          ) : (
            <>
              <Button variant="destructive" disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>
              <Button disabled={busy} onClick={() => submit("approved")}><Check />{approveLabel}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Gate 1 --------------------------------- */
export function GateOne() {
  const pending = useApi(() => approvalsApi.pending({ gate: "gate1_intake", limit: 100 }), []);
  const rejected = useApi(() => productsApi.list({ status: "rejected", limit: 25 }), []);
  const reasons = useApi(() => approvalsApi.reasonCodes("gate1_intake"), []);
  const orders = useApi(() => purchaseOrdersApi.list({ limit: 100 }), []);
  const [active, setActive] = useState<ProductRow | null>(null);
  const [registering, setRegistering] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [record, setRecord] = useState<ProductRow | null>(null);
  const refresh = () => { pending.reload(); rejected.reload(); };
  const poList: PurchaseOrder[] = orders.data?.data ?? [];

  return (
    <>
      <PageIntro title="Raw Material Intake · Gate 1" detail="Register received material against its purchase order, then approve or reject it." />
      <Panel title="Awaiting Gate 1 decision" subtitle="Registered material waiting for approval or rejection"
        action={<Button size="sm" onClick={() => setRegistering(true)}><Plus />Register material</Button>}>
        <Async loading={pending.loading} error={pending.error} onRetry={pending.reload}>
          <ProductTable products={pending.data?.data ?? []} actionHeader="Action" action={(p) => <Button size="sm" variant="outline" onClick={() => setActive(p)}>Review</Button>} />
        </Async>
      </Panel>
      <div className="mt-5">
        <Panel title="Purchase orders" subtitle="Orders that incoming material is checked against"
          action={<Button size="sm" variant="outline" onClick={() => setNewOrder(true)}><Plus />New purchase order</Button>}>
          <Async loading={orders.loading} error={orders.error} onRetry={orders.reload}>
            {poList.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">PO number</th><th>Supplier</th><th>Material</th><th className="text-right">Ordered qty</th><th className="text-right">Created</th></tr></thead>
                  <tbody>{poList.map((x) => (
                    <tr key={x.id} className="border-b last:border-0"><td className="py-3 font-semibold">{x.poNumber}</td><td>{x.supplierName}</td><td>{x.materialDescription}</td><td className="text-right">{fmtNumber(x.quantity)}</td><td className="text-right text-xs text-muted-foreground">{fmtDateTime(x.createdAt)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Empty text="No purchase orders yet. Create one before registering material." />}
          </Async>
        </Panel>
      </div>
      <div className="mt-5">
        <Panel title="Rejected at Gate 1" subtitle="Rejection is final for the RFID tag. Procurement is notified for return or replacement.">
          <Async loading={rejected.loading} error={rejected.error} onRetry={rejected.reload}>
            {(rejected.data?.data.length ?? 0) > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Item</th><th>RFID UID</th><th>Purchase order</th><th>Rejected on</th><th className="text-right">Record</th></tr></thead>
                  <tbody>{rejected.data?.data.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-3 font-semibold">{productLabel(p)}{p.description && <div className="max-w-56 truncate text-xs font-normal text-muted-foreground">{p.description}</div>}</td>
                      <td className="font-mono text-xs">{p.rfidUid}</td><td>{p.poNumber ?? "—"}</td><td>{fmtDateTime(p.updatedAt)}</td>
                      <td className="text-right"><Button size="sm" variant="outline" onClick={() => setRecord(p)}><Eye />View record</Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Empty text="No material has been rejected at Gate 1." />}
          </Async>
        </Panel>
      </div>
      {active && (
        <DecisionDialog product={active} gate="gate1_intake" reasons={reasons.data ?? []} title="Gate 1 review ·" approveLabel="Approve material"
          onClose={() => setActive(null)} onDone={() => { setActive(null); refresh(); }} />
      )}
      {registering && <RegisterMaterial orders={poList} loadingOrders={orders.loading} onNewOrder={() => { setRegistering(false); setNewOrder(true); }} onClose={() => setRegistering(false)} onDone={() => { setRegistering(false); refresh(); }} />}
      {newOrder && <NewPurchaseOrder onClose={() => setNewOrder(false)} onDone={() => { setNewOrder(false); orders.reload(); }} />}
      {record && <RejectionDialog product={record} onClose={() => setRecord(null)} />}
    </>
  );
}

function RejectionDialog({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const loaded = useProduct(product.id);
  const reasons = useReasonDescriptions();
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Rejection record</DialogTitle><DialogDescription>Gate 1 rejection for {productLabel(product)}.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Async loading={loaded.loading} error={loaded.error} onRetry={loaded.reload}>
            {loaded.data ? <RejectionRecord loaded={loaded.data} reasons={reasons} /> : null}
          </Async>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewPurchaseOrder({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [po, setPo] = useState({ poNumber: "", supplierName: "", materialDescription: "", quantity: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    const q = Number(po.quantity);
    if (!po.poNumber.trim() || !po.supplierName.trim() || !po.materialDescription.trim() || !(q > 0)) { setError("Complete every field. Quantity must be greater than zero."); return; }
    setBusy(true); setError("");
    try {
      const created = await purchaseOrdersApi.create({ poNumber: po.poNumber.trim(), supplierName: po.supplierName.trim(), materialDescription: po.materialDescription.trim(), quantity: q });
      toast.success(`Purchase order ${created.poNumber} created`);
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New purchase order</DialogTitle><DialogDescription>Record a purchase order for incoming raw material.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><label className="text-sm font-medium" htmlFor="po-number">PO number</label><input id="po-number" className={cn(inputCls, "mt-1")} value={po.poNumber} onChange={(e) => setPo({ ...po, poNumber: e.target.value })} /></div>
          <div><label className="text-sm font-medium" htmlFor="po-supplier">Supplier</label><input id="po-supplier" className={cn(inputCls, "mt-1")} value={po.supplierName} onChange={(e) => setPo({ ...po, supplierName: e.target.value })} /></div>
          <div><label className="text-sm font-medium" htmlFor="po-material">Material description</label><input id="po-material" className={cn(inputCls, "mt-1")} value={po.materialDescription} onChange={(e) => setPo({ ...po, materialDescription: e.target.value })} /></div>
          <div><label className="text-sm font-medium" htmlFor="po-qty">Ordered quantity</label><input id="po-qty" className={cn(inputCls, "mt-1")} type="number" min="0" value={po.quantity} onChange={(e) => setPo({ ...po, quantity: e.target.value })} /></div>
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={create}>{busy ? "Creating…" : "Create purchase order"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type UidCheck = { state: "idle" | "checking" | "free" } | { state: "taken"; product: ProductDetail };

function RegisterMaterial({ orders, loadingOrders, onNewOrder, onClose, onDone }: { orders: PurchaseOrder[]; loadingOrders: boolean; onNewOrder: () => void; onClose: () => void; onDone: () => void }) {
  const [poId, setPoId] = useState("");
  const [rfidUid, setRfidUid] = useState("");
  const [qty, setQty] = useState("");
  const [batch, setBatch] = useState("");
  const [desc, setDesc] = useState("");
  const [notes, setNotes] = useState("");
  const [check, setCheck] = useState<UidCheck>({ state: "idle" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tapped = useApi(() => scansApi.unregistered({ minutes: 1440, limit: 6 }), [], 3_000);

  // Look the UID up (GET /products/by-uid/:uid) so a tag that is already assigned cannot be assigned to another item.
  useEffect(() => {
    const uid = rfidUid.trim().toUpperCase();
    if (!RFID_UID_PATTERN.test(uid)) { setCheck({ state: "idle" }); return; }
    let alive = true;
    setCheck({ state: "checking" });
    const timer = window.setTimeout(() => {
      productsApi.byUid(uid)
        .then((product) => { if (alive) setCheck({ state: "taken", product }); })
        .catch((e: unknown) => { if (alive) setCheck(e instanceof ApiError && e.status === 404 ? { state: "free" } : { state: "idle" }); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [rfidUid]);

  async function register() {
    const q = Number(qty);
    const uid = rfidUid.trim().toUpperCase();
    if (!poId) { setError("Select the purchase order this material belongs to."); return; }
    if (!RFID_UID_PATTERN.test(uid)) { setError("Scan the RFID tag. The UID must be 8–20 hexadecimal characters."); return; }
    if (check.state === "taken") { setError("This RFID tag is already assigned to another item."); return; }
    if (!(q > 0)) { setError("Received quantity must be greater than zero."); return; }
    setBusy(true); setError("");
    try {
      const p = await productsApi.register({
        rfidUid: uid, poId: Number(poId), receivedQty: q,
        batchCode: batch.trim() || undefined, description: desc.trim() || undefined, notes: notes.trim() || undefined,
      });
      toast.success(`Tag ${p.rfidUid} registered and sent to the Gate 1 queue`);
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const taken = check.state === "taken" ? check.product : null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register received material</DialogTitle>
          <DialogDescription>Link an RFID tag to an existing purchase order and item. The material then appears in the Gate 1 queue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="po">Purchase order</label>
            <select id="po" value={poId} onChange={(e) => setPoId(e.target.value)} disabled={loadingOrders} className={cn(selectCls, "mt-1 h-10 w-full")}>
              <option value="">{loadingOrders ? "Loading purchase orders…" : orders.length ? "Select a purchase order" : "No purchase orders available"}</option>
              {orders.map((x) => <option key={x.id} value={x.id}>{x.poNumber} · {x.supplierName} · {x.materialDescription}</option>)}
            </select>
            {!loadingOrders && !orders.length && <p className="mt-1 text-xs text-muted-foreground">Create a purchase order first. <button type="button" className="font-medium text-primary underline" onClick={onNewOrder}>New purchase order</button></p>}
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="reg-uid">RFID tag UID</label>
            <div className="mt-1"><RfidField id="reg-uid" value={rfidUid} onChange={(v) => { setRfidUid(v); setError(""); }} /></div>
            {(tapped.data?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Tapped on a reader:</span>
                {tapped.data?.map((t) => (
                  <button key={t.rfidUid} type="button" onClick={() => { setRfidUid(t.rfidUid); setError(""); }}
                    className="rounded border px-2 py-1 font-mono hover:bg-muted">{t.rfidUid}</button>
                ))}
              </div>
            )}
            {check.state === "checking" && <p className="mt-1 text-xs text-muted-foreground">Checking whether this tag is already assigned…</p>}
            {check.state === "free" && <p className="mt-1 text-xs text-success">Tag is available for assignment.</p>}
            {taken && <p className="mt-1 text-xs text-destructive" role="alert">This tag is already assigned to {productLabel(taken)}{taken.poNumber ? ` (PO ${taken.poNumber})` : ""}. Use a different tag.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="text-sm font-medium" htmlFor="reg-batch">Batch code</label><input id="reg-batch" className={cn(inputCls, "mt-1")} value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
            <div><label className="text-sm font-medium" htmlFor="reg-qty">Received quantity</label><input id="reg-qty" className={cn(inputCls, "mt-1")} type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          </div>
          <div><label className="text-sm font-medium" htmlFor="reg-desc">Item description</label><input id="reg-desc" className={cn(inputCls, "mt-1")} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div><label className="text-sm font-medium" htmlFor="reg-notes">Receipt notes (optional)</label><input id="reg-notes" className={cn(inputCls, "mt-1")} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || loadingOrders || check.state === "taken"} onClick={register}>{busy ? "Registering…" : "Register material"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- Gate 2 --------------------------------- */
export function GateTwo() {
  const pending = useApi(() => approvalsApi.pending({ gate: "gate2_qc", limit: 100 }), []);
  const reasons = useApi(() => approvalsApi.reasonCodes("gate2_qc"), []);
  const [active, setActive] = useState<ProductRow | null>(null);
  return (
    <>
      <PageIntro title="Stitching QC · Gate 2" detail="Inspect production output before it proceeds to Stitching." />
      <div className="mb-6 grid gap-3 md:grid-cols-4"><FlowStep text="QC failed" /><FlowStep text="Rework required" /><FlowStep text="Returned to Production" /><FlowStep text="Re-inspection · approved" good /></div>
      <Panel title="Awaiting QC inspection" subtitle="Items in rework can be re-inspected once Production marks the rework complete">
        <Async loading={pending.loading} error={pending.error} onRetry={pending.reload}>
          <ProductTable products={pending.data?.data ?? []} action={(p) =>
            p.status === "rework" && !p.reworkCompleted
              ? <Button size="sm" variant="outline" disabled title="Production must complete the rework first">Awaiting rework</Button>
              : <Button size="sm" variant="outline" onClick={() => setActive(p)}><Eye />{p.status === "rework" ? "Re-inspect" : "Inspect"}</Button>} />
        </Async>
      </Panel>
      {active && (
        <DecisionDialog product={active} gate="gate2_qc" reasons={reasons.data ?? []} title="QC inspection ·" approveLabel="Approve for Stitching" rejectLabel="Fail and return for rework"
          onClose={() => setActive(null)} onDone={() => { setActive(null); pending.reload(); }} />
      )}
    </>
  );
}

/* --------------------------------- Gate 3 --------------------------------- */
export function GateThree() {
  const pending = useApi(() => approvalsApi.pending({ gate: "gate3_shipment", limit: 100 }), []);
  const [active, setActive] = useState<ProductRow | null>(null);
  return (
    <>
      <PageIntro title="Shipment Readiness · Gate 3" detail="Confirm that finished items are ready for shipment." />
      <Panel title="Awaiting shipment readiness" subtitle="Items at Packaging without a Gate 3 decision">
        <Async loading={pending.loading} error={pending.error} onRetry={pending.reload}>
          <ProductTable products={pending.data?.data ?? []} action={(p) => <Button size="sm" variant="outline" onClick={() => setActive(p)}><PackageCheck />Review</Button>} />
        </Async>
      </Panel>
      {active && (
        <DecisionDialog product={active} gate="gate3_shipment" reasons={[]} title="Shipment readiness ·" approveLabel="Mark ready for shipment"
          onClose={() => setActive(null)} onDone={() => { setActive(null); pending.reload(); }}>
          <AlertLine title="This decision is added to the audit history" detail="Once confirmed, the item can be scanned at Shipping." />
        </DecisionDialog>
      )}
    </>
  );
}
