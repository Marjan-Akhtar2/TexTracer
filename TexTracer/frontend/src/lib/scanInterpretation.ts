/**
 * Scan interpretation: turns what the backend already decided into a clear, contextual explanation.
 *
 * Two separate things happen on every scan (and the UI keeps them apart):
 *   1. RFID DETECTION  - a reader saw a tag. Always true if a scan_logs row exists.
 *   2. STAGE VALIDATION - the database function record_scan() decided whether the product may move to that stage.
 *
 * Rules of this module:
 *   - The backend verdict (`result`) is AUTHORITATIVE. This module explains it; it never overrules it and never
 *     re-implements the sequence rules. "Expected next stage" is read from the database's own transition table
 *     (GET /stages -> `next`), so the UI can not drift from the backend.
 *   - Nothing here writes anything. An invalid scan is only ever described.
 *   - Everything is pure (no React, no fetch) so every scenario can be tested in isolation.
 */
import type { ProductHistory, ProductRow, ScanLogRow, ScanOutcomeInfo, StageInfo } from "@/lib/api";
import { gateLabel, productLabel, stageLabel } from "@/lib/labels";

export type Verdict =
  | "valid" | "duplicate" | "invalid_sequence" | "gate_blocked" | "rework"
  | "item_rejected" | "item_shipped" | "unknown_tag" | "unknown_reader" | "blocked";
export type Tone = "success" | "warning" | "danger" | "info";
export type SequenceIssue = "earlier_stage" | "skipped_ahead" | "other_branch" | "unexpected";
export type ItemState = "active" | "rework" | "rejected" | "shipped";

/** Everything the interpreter needs, as plain values. Built from a live POST outcome or from a scan_logs row. */
export interface ScanFacts {
  /** scan_result from the backend: accepted | duplicate | rejected_* */
  result: string;
  detail: string | null;
  uid: string;
  readerCode: string | null;
  /** stage the reader is mapped to ("detected department") */
  detectedStage: string | null;
  /** the product's last valid recorded stage at the moment of the scan; null when it can not be determined */
  previousStage: string | null;
  /** state of the product when scanned; null = unknown (e.g. a role that may not read product data) */
  itemState: ItemState | null;
  reworkCompleted: boolean;
  /** batch code / UID of the product; null when no product is registered for the tag */
  productLabel: string | null;
}

export interface ScanInterpretation {
  verdict: Verdict;
  tone: Tone;
  /** e.g. "INVALID SEQUENCE" (shown after "SCAN VALIDATION:") */
  title: string;
  /** one short line for tables, e.g. "Invalid sequence" */
  headline: string;
  explanation: string;
  /** did this scan change the official stage? */
  transitionApplied: boolean;
  transitionNote: string;
  /** ordered: Product, RFID UID, Current reader, Previously recorded stage, Expected next, Detected */
  facts: { label: string; value: string }[];
  issue?: SequenceIssue;
}

/* ------------------------------------------------------------------ graph helpers */
const find = (g: readonly StageInfo[], code: string | null) => (code ? g.find((s) => s.code === code) : undefined);
export const nextStages = (g: readonly StageInfo[], stage: string | null) => find(g, stage)?.next ?? [];
const seqOf = (g: readonly StageInfo[], stage: string | null) => find(g, stage)?.seq ?? null;

/** Stages that can legally precede `stage` according to the database. */
function predecessors(g: readonly StageInfo[], stage: string | null): { stage: string; requiresGate: string | null }[] {
  if (!stage) return [];
  return g.flatMap((s) => (s.next ?? []).filter((n) => n.stage === stage).map((n) => ({ stage: s.code, requiresGate: n.requiresGate })));
}

/** Two stages are alternatives when the database lets a product go from the same stage to either one (Manufacturing 1 / 2). */
const areAlternatives = (g: readonly StageInfo[], a: string, b: string) =>
  a !== b && g.some((s) => { const n = (s.next ?? []).map((x) => x.stage); return n.includes(a) && n.includes(b); });

/** Fewest forward steps from one stage to another, or null if not reachable. */
function stepsBetween(g: readonly StageInfo[], from: string, to: string): number | null {
  const seen = new Set<string>([from]);
  let frontier = [from];
  for (let d = 1; frontier.length; d++) {
    const next: string[] = [];
    for (const s of frontier) for (const n of nextStages(g, s)) {
      if (n.stage === to) return d;
      if (!seen.has(n.stage)) { seen.add(n.stage); next.push(n.stage); }
    }
    frontier = next;
  }
  return null;
}

/** "Raw Material 1 · Procurement" - the department is added only where it adds information. */
function stageText(g: readonly StageInfo[], code: string | null): string {
  if (!code) return "Unknown";
  const dept = find(g, code)?.department;
  const label = stageLabel(code);
  return dept && dept !== label ? `${label} · ${dept}` : label;
}

function expectedText(g: readonly StageInfo[], stage: string | null): string {
  const next = nextStages(g, stage);
  if (!stage) return "Unknown";
  if (!next.length) return "None (final stage)";
  return next.map((n) => `${stageLabel(n.stage)}${n.requiresGate ? ` (requires ${gateLabel(n.requiresGate)} approval)` : ""}`).join(" or ");
}
const expectedLabels = (g: readonly StageInfo[], stage: string | null) =>
  nextStages(g, stage).map((n) => stageLabel(n.stage)).join(" or ");

/* ------------------------------------------------------------------ text helpers */
const STAGE_CODE = /\b(intake|raw_material_1|raw_material_2|design|manufacturing_1|manufacturing_2|production|stitching|packaging|shipping)\b/g;
const GATE_CODE = /\bgate[123]_[a-z]+\b/g;

/** The backend's `detail` text contains raw enum codes ("Cannot move from design to packaging"); show labels instead. */
export function humanizeDetail(detail: string | null | undefined): string {
  if (!detail) return "";
  return detail.replace(GATE_CODE, (g) => gateLabel(g)).replace(STAGE_CODE, (s) => stageLabel(s));
}

const previousLabel = (stage: string | null) =>
  stage === "intake" ? "Raw Material Intake (Gate 1) · registered, no reader scan yet" : stage ? stageLabel(stage) : "Not determinable";

/* ------------------------------------------------------------------ builders */
export const itemStateOf = (status: string | null | undefined): ItemState | null =>
  !status ? null : status === "rework" ? "rework" : status === "rejected" ? "rejected" : status === "shipped" ? "shipped" : "active";

const stateFromDetail = (result: string, detail: string | null): ItemState | null =>
  result !== "rejected_product_blocked" || !detail ? null : /rejected/i.test(detail) ? "rejected" : /shipped/i.test(detail) ? "shipped" : null;

type ProductLike = Pick<ProductRow, "batchCode" | "rfidUid" | "status" | "reworkCompleted">;

/** From the reply of POST /scans (a manual scan right now). `outcome.fromStage` is the last valid recorded stage. */
export function factsFromOutcome(
  o: ScanOutcomeInfo,
  ctx: { uid: string; readerCode: string; readerStage: string | null; product?: ProductLike | null },
): ScanFacts {
  const p = ctx.product ?? o.product ?? null;
  return {
    result: o.result, detail: o.detail, uid: ctx.uid, readerCode: ctx.readerCode,
    detectedStage: o.toStage ?? ctx.readerStage,
    previousStage: o.fromStage,
    itemState: itemStateOf(p?.status) ?? stateFromDetail(o.result, o.detail),
    reworkCompleted: !!p?.reworkCompleted,
    productLabel: p ? productLabel(p) : null,
  };
}

/**
 * What the product looked like at the moment of a scan, rebuilt from its append-only history.
 * Events at or after the scan time are ignored (an accepted scan's own transition carries the same timestamp).
 */
export function stateAt(history: ProductHistory, atIso: string): { stage: string | null; state: ItemState } {
  const at = Date.parse(atIso);
  let stage: string | null = null;
  let rejected = false, shipped = false, rework = false;
  for (const e of history.timeline) {
    if (!(Date.parse(e.at) < at)) break; // timeline is oldest-first
    if (e.type === "transition") { stage = e.toStage; if (e.toStage === "shipping") shipped = true; }
    else if (e.type === "decision") {
      if (e.gate === "gate1_intake" && e.decision === "rejected") rejected = true;
      if (e.gate === "gate2_qc") rework = e.decision === "rejected";
    }
  }
  return { stage, state: rejected ? "rejected" : shipped ? "shipped" : rework ? "rework" : "active" };
}

/** Best effort when no history is available: read it from the backend's own detail text / the transition table. */
function previousFromLog(row: Pick<ScanLogRow, "result" | "detail" | "stage">, g: readonly StageInfo[]): string | null {
  if (row.result === "rejected_out_of_sequence") return /Cannot move from (\w+) to/.exec(row.detail ?? "")?.[1] ?? null;
  if (row.result === "duplicate") return row.stage;
  if (row.result === "rejected_gate_not_approved" || row.result === "accepted") {
    const pre = predecessors(g, row.stage).filter((p) => row.result === "accepted" || p.requiresGate !== null);
    return pre.length === 1 ? (pre[0]?.stage ?? null) : null;
  }
  return null;
}

/** From a scan_logs row (live feed / history). Uses the product's history when the viewer may read it. */
export function factsFromLog(
  row: ScanLogRow,
  ctx: { graph: readonly StageInfo[]; product?: ProductLike | null; history?: ProductHistory | null },
): ScanFacts {
  const at = ctx.history ? stateAt(ctx.history, row.scannedAt) : null;
  const known = !!at && at.stage !== null;
  const p = ctx.product ?? null;
  return {
    result: row.result, detail: row.detail, uid: row.rfidUid, readerCode: row.readerCode,
    detectedStage: row.stage,
    previousStage: known ? at.stage : previousFromLog(row, ctx.graph),
    itemState: known ? at.state : (stateFromDetail(row.result, row.detail) ?? itemStateOf(p?.status)),
    reworkCompleted: !!p?.reworkCompleted && p.status === "rework",
    productLabel: p ? productLabel(p) : null,
  };
}

/* ------------------------------------------------------------------ the interpreter */
export function interpretScan(f: ScanFacts, graph: readonly StageInfo[]): ScanInterpretation {
  const prev = f.previousStage;
  const det = f.detectedStage;
  const prevName = prev ? stageLabel(prev) : "its last recorded stage";
  const detName = det ? stageLabel(det) : "this reader";
  const unchanged = `No stage transition was made. The official stage stays at ${prev ? stageLabel(prev) : "its last recorded stage"}; this scan is stored in the scan log only.`;

  const facts: { label: string; value: string }[] = [
    { label: "Product ID", value: f.productLabel ?? (f.result === "rejected_unknown_tag" ? "Not registered" : "Not available to your role") },
    { label: "RFID UID", value: f.uid },
    { label: "Current reader", value: f.readerCode ? `${f.readerCode}${det ? ` · ${stageLabel(det)}` : ""}` : "—" },
    { label: "Previously recorded stage", value: f.result === "rejected_unknown_tag" || f.result === "rejected_unknown_reader" ? "—" : previousLabel(prev) },
    { label: "Expected next stage", value: "—" },
    { label: "Detected department", value: det ? stageText(graph, det) : "Unknown reader" },
  ];
  const setExpected = (v: string) => { facts[4] = { label: "Expected next stage", value: v }; };
  const make = (
    verdict: Verdict, tone: Tone, title: string, headline: string, explanation: string,
    extra: { transitionApplied?: boolean; transitionNote?: string; issue?: SequenceIssue } = {},
  ): ScanInterpretation => ({
    verdict, tone, title, headline, explanation, facts,
    transitionApplied: extra.transitionApplied ?? false,
    transitionNote: extra.transitionNote ?? unchanged,
    ...(extra.issue ? { issue: extra.issue } : {}),
  });

  /* ---- accepted ---- */
  if (f.result === "accepted") {
    setExpected(prev ? expectedText(graph, prev) : "Unknown");
    const first = prev === "intake";
    return make(
      "valid", "success", "VALID", "Valid · stage advanced",
      `Correct manufacturing sequence. ${first ? `First reader scan after Gate 1 approval: the product now enters the production journey at ${detName}.` : `${prevName} → ${detName} is an allowed move.`}${det === "shipping" ? " The product has completed Shipping." : ""}`,
      { transitionApplied: true, transitionNote: `Stage transition accepted: ${prev ? stageLabel(prev) : "previous stage"} → ${detName}. The official stage is now ${detName}.` },
    );
  }

  /* ---- tag / reader not known ---- */
  if (f.result === "rejected_unknown_tag") {
    return make("unknown_tag", "danger", "UNKNOWN TAG", "Unknown tag",
      "This RFID tag is not registered to any product. The reader detected it and the attempt was logged, but there is no product to validate or move. A Warehouse Manager can register it at Raw Material Intake (Gate 1).",
      { transitionNote: "No product exists for this tag, so nothing was changed." });
  }
  if (f.result === "rejected_unknown_reader") {
    return make("unknown_reader", "danger", "UNKNOWN READER", "Unknown reader",
      "The reader code that sent this scan is not registered (or is inactive), so it can not be mapped to a department. The attempt was logged and no product was changed.",
      { transitionNote: "No department could be determined, so nothing was changed." });
  }

  /* From here on the tag is a known product that was NOT moved. State context decides the message. */
  if (prev) setExpected(expectedText(graph, prev));

  /* ---- closed products: rejected at intake / already shipped ---- */
  if (f.itemState === "rejected") {
    setExpected("None (rejected material does not continue)");
    return make("item_rejected", "danger", "ITEM REJECTED AT INTAKE", "Rejected item",
      `This raw material was rejected at Gate 1 intake. That is a terminal state: it is not processed in production, and Procurement handles the return or replacement. The scan at ${detName} was detected and logged, but the item can not move to any stage.`,
      { transitionNote: "No stage transition was made. A rejected item never enters the manufacturing sequence." });
  }
  if (f.itemState === "shipped") {
    setExpected("None (already shipped)");
    return make("item_shipped", "info", "ALREADY SHIPPED", "Already shipped",
      `This product has already completed Shipping, the final stage, so there is no next stage. The scan at ${detName} was detected and logged for the audit trail; nothing was changed.`,
      { transitionNote: "No stage transition was made. The product stays Shipped." });
  }

  /* ---- QC rework exception flow (Gate 2 rejection) ---- */
  if (f.itemState === "rework") {
    const gate2 = gateLabel("gate2_qc");
    const state = f.reworkCompleted
      ? `Production has marked the rework complete; it is waiting for QC re-inspection (${gate2}).`
      : `Production must complete the rework, then QC must re-inspect and approve it (${gate2}).`;
    const where = det === "production"
      ? "A repeat scan at Production changes nothing."
      : det === "stitching"
        ? "It can not go on to Stitching until QC approves it again."
        : `It can not be processed at ${detName} while it is in rework.`;
    setExpected(`Stitching, only after rework is completed and ${gate2} approves it again`);
    return make("rework", "warning", "QC REWORK IN PROGRESS", "In QC rework",
      `This product failed QC (${gate2}) and is in the rework loop at Production. ${where} ${state}`,
      { transitionNote: "No stage transition was made. Rework is an exception flow: the product stays at Production until QC approves it, and the rework is recorded in its history." });
  }

  /* ---- duplicate ---- */
  if (f.result === "duplicate") {
    return make("duplicate", "info", "DUPLICATE SCAN", "Duplicate scan",
      `This product is already recorded at ${detName}. The repeat scan was detected and logged, but it is not a new stage.`,
      { transitionNote: `No new transition was recorded. The product stays at ${detName} and its history is unchanged.` });
  }

  /* ---- missing approval ---- */
  if (f.result === "rejected_gate_not_approved") {
    const gate = /gate[123]_[a-z]+/.exec(f.detail ?? "")?.[0]
      ?? predecessors(graph, det).find((p) => p.stage === prev && p.requiresGate)?.requiresGate ?? null;
    const why = gate === "gate1_intake"
      ? "Gate 1 (Raw Material Intake) approval is still pending. The Warehouse Manager must approve this material before reader scans can move it; it has no reader scan history yet."
      : gate === "gate2_qc"
        ? `QC (${gateLabel("gate2_qc")}) has not approved this product, so it can not move to ${detName}. It is waiting for QC inspection or has been sent for rework.`
        : gate === "gate3_shipment"
          ? `Packaging has not marked this product Ready for Shipment (${gateLabel("gate3_shipment")}), so it can not be shipped yet.`
          : `${gate ? gateLabel(gate) : "A required approval"} is missing, so the product can not move to ${detName}.`;
    return make("gate_blocked", "warning", "BLOCKED — APPROVAL REQUIRED", "Approval required",
      `${prev ? `This product was last recorded at ${prevName} and ${detName} is the right next stage, but it is not allowed yet. ` : ""}${why}`);
  }

  /* ---- sequence ---- */
  if (f.result === "rejected_out_of_sequence" && prev && det) {
    const exp = expectedLabels(graph, prev);
    const pSeq = seqOf(graph, prev), dSeq = seqOf(graph, det);
    const steps = stepsBetween(graph, prev, det);
    const issue: SequenceIssue = areAlternatives(graph, prev, det) ? "other_branch"
      : pSeq !== null && dSeq !== null && dSeq < pSeq ? "earlier_stage"
        : steps !== null && steps >= 2 ? "skipped_ahead" : "unexpected";
    const why = {
      earlier_stage: `${detName} is an earlier stage that this product has already passed; scanning backwards does not reverse its progress.`,
      skipped_ahead: `${detName} is ${steps ?? "several"} steps ahead of its last recorded stage; the stages in between must be scanned first.`,
      other_branch: `${prevName} and ${detName} are alternative routes in the process, so a product that took one does not go through the other.`,
      unexpected: `The process does not allow a move from ${prevName} to ${detName}.`,
    }[issue];
    const noHistory = prev === "intake" ? " This product has no reader scan history yet: it is registered at Raw Material Intake." : "";
    return make("invalid_sequence", "danger", "INVALID SEQUENCE", "Invalid sequence",
      `This product was last recorded at ${prevName}. It is expected to proceed to ${exp || "no further stage"}, but it was detected at ${detName}. ${why}${noHistory}`,
      { issue });
  }

  /* ---- fallbacks (previous stage unknown, or a result this version does not know) ---- */
  const text = humanizeDetail(f.detail);
  if (f.result === "rejected_out_of_sequence") {
    return make("invalid_sequence", "danger", "INVALID SEQUENCE", "Invalid sequence",
      `The system rejected this scan as out of sequence${text ? `: ${text}` : ""}. The product's previous stage could not be loaded for your role, but its official stage was not changed.`);
  }
  return make("blocked", "danger", "REJECTED", "Rejected",
    `The system rejected this scan${text ? `: ${text}` : ""}. It was logged and the product's official stage was not changed.`);
}
