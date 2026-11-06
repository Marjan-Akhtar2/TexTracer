/**
 * TexTracer API client. Talks ONLY to the real backend (see backend/docs/API.md).
 * Base URL comes from VITE_API_URL (frontend/.env), default http://localhost:5000/api
 * No data in this file is invented: every type mirrors a backend response.
 */
const RAW_BASE: string = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:5000/api";
export const API_BASE = RAW_BASE.replace(/\/$/, "");
const TOKEN_KEY = "textracer.token";
export const UNAUTHORIZED_EVENT = "textracer:unauthorized";

/* ----------------------------- shared types ----------------------------- */
export type ApiRole =
  | "system_admin" | "department_officer" | "warehouse_manager" | "qc_officer" | "auditor" | "senior_management";
export type GateCode = "gate1_intake" | "gate2_qc" | "gate3_shipment";
export type ProductStatusCode = "active" | "rework" | "rejected" | "ready_for_shipment" | "shipped";

export interface ApiUser {
  id: string; name: string; email: string; role: ApiRole; roleLabel: string;
  departmentId: number | null; department: string | null;
}
export interface ApiMeta { page?: number; limit?: number; total?: number; pages?: number; count?: number; [k: string]: unknown }

export interface ProductRow {
  id: string; rfidUid: string; batchCode: string | null; description: string | null;
  stage: string; status: ProductStatusCode; reworkFlag: boolean; reworkCount: number;
  lastScanAt: string; createdAt: string; updatedAt: string; stageSeq: number; slaMinutes: number;
  departmentId: number; department: string;
  poId: number | null; poNumber: string | null; supplier: string | null; material: string | null; poQuantity: number | null;
  stalled: boolean; awaitingGate: GateCode | null; reworkCompleted: boolean;
}
export interface DecisionSummary {
  inspectionId: number; gate: GateCode; decision: string; reasonCode: string | null; notes: string | null;
  decidedBy: string; decidedAt: string; supersedesId: number | null;
}
export interface ProductDetail extends ProductRow {
  idleSeconds: number;
  receipt: { id: number; receivedQty: number; notes: string | null; receivedAt: string; receivedBy: string | null } | null;
  currentDecisions: DecisionSummary[];
  nextStages: { stage: string; requiresGate: string | null }[];
}
export interface AnchorInfo { chain: string; status: string; ipfsCid: string | null; txHash: string | null; confirmations: number }
export type TimelineEvent =
  | { type: "transition"; at: string; id: number; kind: string; fromStage: string | null; toStage: string; readerCode: string | null; actorName: string | null; inspectionId: number | null }
  | { type: "decision"; at: string; id: number; gate: GateCode; decision: string; reasonCode: string | null; notes: string | null; decidedBy: string; supersedesId: number | null; anchors: AnchorInfo[] }
  | { type: "scan"; at: string; id: number; readerCode: string; result: string; detail: string | null };
export interface ProductHistory { productId: string; timeline: TimelineEvent[] }
export interface ProductVerification {
  productId: string; chainValid: boolean; transitionCount: number; onChainVerification: string; note: string;
  anchors: {
    id: number; inspectionId: number; gate: GateCode; decision: string; chain: string; status: string; ipfsCid: string | null;
    txHash: string | null; blockNumber: number | null; confirmations: number; metadataHashValid: boolean; createdAt: string; confirmedAt: string | null;
  }[];
}
export interface PurchaseOrder {
  id: number; poNumber: string; supplierName: string; materialDescription: string; quantity: number; createdBy: string | null; createdAt: string;
}
export interface ReasonCode { code: string; gate: GateCode; description: string }
export interface ReworkCase extends ProductRow {
  inspectionId: number | null; reasonCode: string | null; rejectionNotes: string | null; rejectedBy: string | null;
  rejectedAt: string | null; completedAt: string | null; completedBy: string | null; assignedDepartment: string;
}
export interface ScanOutcomeInfo { result: string; productId: string | null; fromStage: string | null; toStage: string | null; detail: string | null; product?: ProductRow | null }
export interface ScanLogRow {
  id: number; rfidUid: string; readerCode: string; productId: string | null; result: string; detail: string | null;
  deviceTs: string | null; scannedAt: string; stage: string | null;
}
export interface UnregisteredTag { rfidUid: string; lastSeenAt: string; readerCode: string; timesSeen: number }
export interface DeviceSeen { readerCode: string; lastContactAt: string; lastIp: string; lastHttpStatus: number; lastOutcome: string; lastUid: string | null; attempts: number; failures: number }
export interface DeviceAttempt { at: string; ip: string; readerCode: string | null; rfidUid: string | null; httpStatus: number; outcome: string; message: string | null }
export interface DeviceActivity { readers: DeviceSeen[]; recent: DeviceAttempt[] }
export interface NotificationRow { id: number; type: string; message: string; productId: string | null; createdAt: string; readAt: string | null }
export interface AuditDecision {
  inspectionId: number; rfidUid: string; productId: string; gate: GateCode; decision: string; reasonCode: string | null; notes: string | null;
  decidedBy: string; decidedAt: string; supersedesId: number | null; chain: string | null; anchorStatus: string | null;
  ipfsCid: string | null; txHash: string | null; confirmations: number | null;
}
export interface AuditTransition {
  id: number; productId: string; rfidUid: string; kind: string; fromStage: string | null; toStage: string; readerCode: string | null;
  actorName: string | null; inspectionId: number | null; occurredAt: string; rowHash: string; prevHash: string | null;
}
export interface Department { id: number; code: string; name: string }
export interface ReaderInfo {
  id: number; code: string; stage: string; departmentId: number; department: string; isActive: boolean; description: string | null; hasDeviceKey: boolean;
}
export interface StageInfo {
  code: string; seq: number; slaMinutes: number; departmentId: number; department: string;
  /** Sent by GET /stages: the readers mapped to this stage and the forward moves the database allows from it. */
  readers?: { id: number; code: string; isActive: boolean; description: string | null; hasDeviceKey: boolean }[];
  next?: { stage: string; requiresGate: string | null }[];
}
export interface UserRecord {
  id: string; email: string; fullName: string; isActive: boolean; departmentId: number | null; department: string | null;
  role: ApiRole | null; createdAt: string; updatedAt: string;
}
export interface RoleInfo { code: ApiRole; label: string; permissions: string[] }
export interface KpiSummary {
  itemsInProgress: number; itemsShipped: number; rejectionRatePct: number | null; avgCycleTimeSeconds: number | null;
  stalledItems: number; anchorsConfirmed: number; anchorsPending: number;
}
export interface StageKpi { seq: number; stage: string; department: string; wip: number; arrivalsTotal: number; arrivals24h: number; avgDwellSeconds: number | null; isBottleneck: boolean }
export interface DepartmentKpi { department: string; wip: number; arrivalsTotal: number; arrivals24h: number; avgDwellSeconds: number | null; isBottleneck: boolean }
export interface StageReport { stages: StageKpi[]; departments: DepartmentKpi[]; bottleneckStage: string | null; bottleneckDepartment: string | null }
export interface RejectionReason { gate: GateCode; reasonCode: string; description: string; occurrences: number }
export interface AnchorCount { chain: string; status: string; count: number }
export interface StalledItem { productId: string; rfidUid: string; stage: string; status: string; lastScanAt: string; idleSeconds: number; slaMinutes: number; overdueMinutes: number }
export interface Overview {
  totalProducts: number; byStatus: Record<string, number>;
  byStage: { stage: string; seq: number; department: string; count: number }[];
  pendingApprovals: { gate1_intake: number; gate2_qc: number; gate3_shipment: number };
  rework: { open: number; awaitingQcRecheck: number; totalReworkLoops: number };
  stalledItems: number;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

/* ------------------------------ token store ------------------------------ */
let memoryToken: string | null = null;
export const getToken = (): string | null => {
  if (memoryToken) return memoryToken;
  try { return (memoryToken = window.sessionStorage.getItem(TOKEN_KEY)); } catch { return null; }
};
export const setToken = (t: string | null) => {
  memoryToken = t;
  try { if (t) window.sessionStorage.setItem(TOKEN_KEY, t); else window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};

/* ------------------------------ core request ------------------------------ */
type Query = Record<string, string | number | boolean | undefined | null>;
export function qs(q: Query = {}): string {
  const p = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
}

export interface ApiResult<T> { data: T; meta: ApiMeta }

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", `Cannot reach the TexTracer API at ${API_BASE}. Is the backend running and is this page's address listed in CORS_ORIGIN?`);
  }
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; meta?: ApiMeta; error?: { code: string; message: string; details?: unknown } }
    | null;
  if (!res.ok || !json?.success) {
    if (res.status === 401 && token && path !== "/auth/login") {
      setToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, json?.error?.code ?? "REQUEST_FAILED", json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  }
  return { data: json.data as T, meta: json.meta ?? {} };
}

const get = <T>(path: string, q?: Query | undefined) => api<T>("GET", `${path}${qs(q)}`);

/* -------------------------------- endpoints -------------------------------- */
export const authApi = {
  async login(email: string, password: string): Promise<ApiUser> {
    const { data } = await api<{ token: string; user: ApiUser }>("POST", "/auth/login", { email, password });
    setToken(data.token);
    return data.user;
  },
  me: () => get<ApiUser>("/auth/me").then((r) => r.data),
  logout: () => { setToken(null); },
};
export const healthApi = { get: () => get<{ status: string; database: string }>("/health") };

export const productsApi = {
  list: (q: Query = {}) => get<ProductRow[]>("/products", q),
  get: (id: string) => get<ProductDetail>(`/products/${id}`).then((r) => r.data),
  history: (id: string) => get<ProductHistory>(`/products/${id}/history`).then((r) => r.data),
  verification: (id: string) => get<ProductVerification>(`/products/${id}/verification`).then((r) => r.data),
  byUid: (uid: string) => get<ProductDetail>(`/products/by-uid/${encodeURIComponent(uid)}`).then((r) => r.data),
  register: (b: { rfidUid: string; poId: number; receivedQty: number; batchCode?: string | undefined; description?: string | undefined; notes?: string | undefined }) =>
    api<ProductDetail>("POST", "/products", b).then((r) => r.data),
};
export const purchaseOrdersApi = {
  list: (q: Query = {}) => get<PurchaseOrder[]>("/purchase-orders", q),
  create: (b: { poNumber: string; supplierName: string; materialDescription: string; quantity: number }) =>
    api<PurchaseOrder>("POST", "/purchase-orders", b).then((r) => r.data),
};
export const scansApi = {
  scan: (rfidUid: string, readerCode: string) => api<ScanOutcomeInfo>("POST", "/scans", { rfidUid, readerCode }).then((r) => r.data),
  list: (q: Query = {}) => get<ScanLogRow[]>("/scans", q),
  /** Tags tapped on a reader that no product owns yet (Warehouse Manager / Admin). */
  unregistered: (q: Query = {}) => get<UnregisteredTag[]>("/scans/unregistered", q).then((r) => r.data),
  /** What the ESP32 readers are doing right now, including failed / unauthorised attempts. */
  deviceActivity: () => get<DeviceActivity>("/scans/device-activity").then((r) => r.data),
};
export const approvalsApi = {
  pending: (q: Query = {}) => get<ProductRow[]>("/approvals/pending", q),
  reasonCodes: (gate?: GateCode | undefined) => get<ReasonCode[]>("/approvals/reason-codes", { gate }).then((r) => r.data),
  decide: (productId: string, d: { gate: GateCode; decision: "approved" | "rejected" | "ready_for_shipment"; reasonCode?: string | undefined; notes?: string | undefined }) =>
    api<{ decision: unknown; product: ProductRow }>("POST", `/approvals/${productId}/decisions`, d).then((r) => r.data),
};
export const reworkApi = {
  list: (q: Query = {}) => get<ReworkCase[]>("/rework", q),
  complete: (productId: string, notes?: string | undefined) =>
    api<{ notificationId: number | null; product: ProductRow }>("POST", `/rework/${productId}/complete`, notes ? { notes } : {}).then((r) => r.data),
};
export const auditApi = {
  decisions: (q: Query = {}) =>
    get<AuditDecision[]>("/audit/decisions", q),
  transitions: (q: Query = {}) => get<AuditTransition[]>("/audit/transitions", q),
};
export const dashboardApi = {
  overview: () => get<Overview>("/dashboard/overview").then((r) => r.data),
  kpis: () => get<KpiSummary>("/dashboard/kpis").then((r) => r.data),
  stages: () => get<StageReport>("/dashboard/stages").then((r) => r.data),
  rejectionReasons: () => get<RejectionReason[]>("/dashboard/rejection-reasons").then((r) => r.data),
  anchors: () => get<AnchorCount[]>("/dashboard/anchors").then((r) => r.data),
  stalled: (limit = 100) => get<StalledItem[]>("/dashboard/stalled", { limit }).then((r) => r.data),
};
export const usersApi = {
  list: () => get<UserRecord[]>("/users").then((r) => r.data),
  create: (b: { email: string; fullName: string; password: string; role: ApiRole; departmentId?: number | null | undefined }) =>
    api<UserRecord>("POST", "/users", b).then((r) => r.data),
  update: (id: string, b: { email?: string | undefined; fullName?: string | undefined; password?: string | undefined; departmentId?: number | null | undefined; isActive?: boolean | undefined }) =>
    api<UserRecord>("PATCH", `/users/${id}`, b).then((r) => r.data),
  setRole: (id: string, role: ApiRole) => api<UserRecord>("PUT", `/users/${id}/role`, { role }).then((r) => r.data),
};
export const rolesApi = { list: () => get<RoleInfo[]>("/roles").then((r) => r.data) };
export const departmentsApi = { list: () => get<Department[]>("/departments").then((r) => r.data) };
export const stagesApi = { list: () => get<StageInfo[]>("/stages").then((r) => r.data) };
export const readersApi = {
  list: () => get<ReaderInfo[]>("/readers").then((r) => r.data),
  provisionKey: (id: number) => api<{ readerId: number; readerCode: string; deviceKey: string; note: string }>("PUT", `/readers/${id}/key`).then((r) => r.data),
};
export const notificationsApi = {
  list: (q: Query = {}) => get<NotificationRow[]>("/notifications", q),
  read: (id: number) => api<NotificationRow>("POST", `/notifications/${id}/read`).then((r) => r.data),
};
