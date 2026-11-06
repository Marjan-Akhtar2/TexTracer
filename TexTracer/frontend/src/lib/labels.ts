import type { ApiRole, GateCode, ProductRow } from "@/lib/api";

/** Journey shown in the UI (the backend also has an 'intake' stage = Gate 1 waiting area). */
export const JOURNEY_STAGES = [
  "raw_material_1", "raw_material_2", "design", "manufacturing_1", "manufacturing_2", "production", "stitching", "packaging", "shipping",
] as const;
export const ALL_STAGES = ["intake", ...JOURNEY_STAGES] as const;

export const STAGE_LABEL: Record<string, string> = {
  intake: "Raw Material Intake (Gate 1)",
  raw_material_1: "Raw Material 1",
  raw_material_2: "Raw Material 2",
  design: "Design",
  manufacturing_1: "Manufacturing 1",
  manufacturing_2: "Manufacturing 2",
  production: "Production",
  stitching: "Stitching",
  packaging: "Packaging",
  shipping: "Shipping",
};
export const stageLabel = (code: string | null | undefined) => (code ? (STAGE_LABEL[code] ?? code) : "—");

export const GATE_LABEL: Record<GateCode, string> = {
  gate1_intake: "Gate 1 · Raw Material Intake",
  gate2_qc: "Gate 2 · Stitching QC",
  gate3_shipment: "Gate 3 · Shipment Readiness",
};
export const gateLabel = (g: string | null | undefined) => (g ? (GATE_LABEL[g as GateCode] ?? g) : "—");

export const ROLE_LABEL: Record<ApiRole, string> = {
  system_admin: "System Administrator",
  department_officer: "Department Officer",
  warehouse_manager: "Warehouse Manager",
  qc_officer: "QC Officer",
  auditor: "Auditor",
  senior_management: "Senior Management",
};
export const ROLE_CODES = Object.keys(ROLE_LABEL) as ApiRole[];

const DECISION_LABEL: Record<string, string> = { approved: "Approved", rejected: "Rejected", ready_for_shipment: "Ready for shipment" };
export const decisionLabel = (d: string) => DECISION_LABEL[d] ?? d;

const SCAN_RESULT_LABEL: Record<string, string> = {
  accepted: "Valid Scan",
  duplicate: "Duplicate scan",
  rejected_unknown_tag: "Rejected · unknown tag",
  rejected_unknown_reader: "Rejected · unknown reader",
  rejected_out_of_sequence: "Invalid sequence",
  rejected_gate_not_approved: "Rejected · gate not approved",
  rejected_product_blocked: "Rejected · item blocked",
};
export const scanResultLabel = (r: string) => SCAN_RESULT_LABEL[r] ?? r;

/** Human status for a product, combining status, stalled flag and waiting gate. */
export function productStatus(p: Pick<ProductRow, "status" | "stalled" | "awaitingGate" | "reworkCompleted">): string {
  if (p.status === "rejected") return "Rejected";
  if (p.status === "shipped") return "Shipped";
  if (p.status === "ready_for_shipment") return "Ready for shipment";
  if (p.status === "rework") return p.reworkCompleted ? "Rework complete · awaiting QC" : "Rework required";
  if (p.stalled) return "Stalled";
  if (p.awaitingGate) return `Pending ${gateLabel(p.awaitingGate).split(" · ")[0]} review`;
  return "In Progress";
}

/** Short product label: batch code when present, otherwise the RFID UID. */
export const productLabel = (p: Pick<ProductRow, "rfidUid" | "batchCode">) => p.batchCode ?? p.rfidUid;

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const h = seconds / 3600;
  if (h >= 48) return `${(h / 24).toFixed(1)}d`;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.max(0, Math.round(seconds / 60))}m`;
}

export const fmtNumber = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-GB"));

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong. Please try again.";
}

/* ------------------------------ rejection reasons ------------------------------ */
/** Select value used by the Gate 1 dialog for a free-text reason. */
export const CUSTOM_REASON = "__custom__";
/** A reason code that stands for "other / custom" (the free text is stored in the decision notes). */
export const isGenericReason = (code: string | null | undefined) => !!code && /^(OTHER|CUSTOM)/i.test(code);
/** The reason as an end user should read it: the description, never the internal code. */
export function reasonText(code: string | null | undefined, notes: string | null | undefined, descriptions: Record<string, string>): string {
  if (!code) return "—";
  if (isGenericReason(code)) return notes?.trim() || descriptions[code] || "Other";
  return descriptions[code] ?? code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
