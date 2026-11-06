/**
 * Single source of truth for roles. Database enum `role_code` <-> SRS display name.
 */
export const ROLE_LABELS = {
  system_admin: "System Administrator",
  department_officer: "Department Officer",
  warehouse_manager: "Warehouse Manager",
  qc_officer: "QC Officer",
  auditor: "Auditor",
  senior_management: "Senior Management",
} as const;

export type RoleCode = keyof typeof ROLE_LABELS;
export const ROLE_CODES = Object.keys(ROLE_LABELS) as [RoleCode, ...RoleCode[]];

export const Roles = {
  ADMIN: "system_admin",
  OFFICER: "department_officer",
  WAREHOUSE: "warehouse_manager",
  QC: "qc_officer",
  AUDITOR: "auditor",
  MANAGEMENT: "senior_management",
} as const satisfies Record<string, RoleCode>;

/** If an account has several role rows, the first in this order is its effective role. */
export const ROLE_PRIORITY: RoleCode[] = [
  "system_admin",
  "senior_management",
  "auditor",
  "qc_officer",
  "warehouse_manager",
  "department_officer",
];

export const ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  system_admin: ["Manage users", "Assign roles", "View role permissions", "Provision RFID reader keys"],
  department_officer: ["View own department", "Scan items at own department readers", "Complete rework (Production)", "Gate 3 ready-for-shipment (Packaging)"],
  warehouse_manager: ["Register raw material intake", "Gate 1 approve / reject", "View product tracking"],
  qc_officer: ["Gate 2 approve / reject", "Route failed items to rework", "View product tracking"],
  auditor: ["Read complete approval/rejection history (read-only)", "Verify records and anchors"],
  senior_management: ["Read KPI dashboard (read-only)", "View stalled alerts and bottlenecks"],
};

export const isRoleCode = (v: unknown): v is RoleCode => typeof v === "string" && v in ROLE_LABELS;
