import {
  Activity, AlertTriangle, ArrowLeftRight, Boxes, ClipboardCheck, FileClock, LayoutDashboard, LockKeyhole,
  PackageCheck, Radio, ScanLine, Search, ShieldCheck, Users, Warehouse, type LucideIcon,
} from "lucide-react";
import type { ApiUser } from "@/lib/api";

export type View =
  | "dashboard" | "tracking" | "flow" | "analytics" | "gate1" | "gate2" | "gate3" | "scan" | "rfid" | "audit" | "alerts"
  | "blockchain" | "livescans" | "users" | "roles" | "readers" | "rework" | "items";
export interface NavItem { id: View; label: string; icon: LucideIcon; group: string }

/**
 * Sidebar per role (SRS roles). Each screen appears once. Removed as duplicates:
 *  - Senior Management "Analytics" (same component as Overview) and "Production Flow" (already a panel of Overview).
 *  - Department Officer "Production Flow" (same stage counts / product journey as Overview and Product Tracking).
 * The `flow` and `analytics` views still exist in code but are no longer reachable from any menu.
 */
export function navFor(user: ApiUser): NavItem[] {
  switch (user.role) {
    case "system_admin":
      return [
        { id: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
        { id: "users", label: "User Management", icon: Users, group: "Administration" },
        { id: "roles", label: "Roles & Permissions", icon: LockKeyhole, group: "Administration" },
        { id: "readers", label: "RFID Readers", icon: Radio, group: "Administration" },
        { id: "livescans", label: "Live RFID Scans", icon: Activity, group: "Administration" },
      ];
    case "department_officer": {
      const items: NavItem[] = [
        { id: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
        { id: "scan", label: "RFID Scan", icon: ScanLine, group: "Operations" },
        { id: "items", label: "Department Items", icon: Boxes, group: "Operations" },
      ];
      if (user.department === "Production") items.push({ id: "rework", label: "Rework Queue", icon: ArrowLeftRight, group: "Operations" });
      if (user.department === "Packaging") items.push({ id: "gate3", label: "Shipment Readiness (Gate 3)", icon: PackageCheck, group: "Operations" });
      items.push({ id: "tracking", label: "Product Tracking", icon: Search, group: "Traceability" });
      return items;
    }
    case "warehouse_manager":
      return [
        { id: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
        { id: "gate1", label: "Raw Material Intake (Gate 1)", icon: Warehouse, group: "Operations" },
        { id: "rfid", label: "RFID Scan", icon: ScanLine, group: "Operations" },
        { id: "livescans", label: "Live RFID Scans", icon: Activity, group: "Operations" },
        { id: "tracking", label: "Product Tracking", icon: Search, group: "Traceability" },
        { id: "blockchain", label: "Blockchain Verification", icon: ShieldCheck, group: "Traceability" },
      ];
    case "qc_officer":
      return [
        { id: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
        { id: "gate2", label: "Stitching QC (Gate 2)", icon: ClipboardCheck, group: "Operations" },
        { id: "rework", label: "Rework Items", icon: ArrowLeftRight, group: "Operations" },
        { id: "tracking", label: "Product Tracking", icon: Search, group: "Traceability" },
      ];
    case "auditor":
      return [
        { id: "audit", label: "Audit History", icon: FileClock, group: "Audit" },
        { id: "livescans", label: "Live RFID Scans", icon: Activity, group: "Audit" },
        { id: "tracking", label: "Product Tracking", icon: Search, group: "Audit" },
        { id: "blockchain", label: "Blockchain Verification", icon: ShieldCheck, group: "Audit" },
      ];
    case "senior_management":
      return [
        { id: "dashboard", label: "Management Dashboard", icon: LayoutDashboard, group: "Workspace" },
        { id: "alerts", label: "Stalled-Item Alerts", icon: AlertTriangle, group: "Monitoring" },
        { id: "livescans", label: "Live RFID Scans", icon: Activity, group: "Monitoring" },
        { id: "tracking", label: "Product Tracking", icon: Search, group: "Traceability" },
        { id: "blockchain", label: "Blockchain Verification", icon: ShieldCheck, group: "Traceability" },
      ];
  }
}

export const homeView = (user: ApiUser): View => navFor(user)[0]?.id ?? "dashboard";
