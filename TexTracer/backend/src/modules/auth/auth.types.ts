import type { RoleCode } from "../../core/roles";

/** The logged-in user as seen by every module (`req.user`). */
export interface AuthUser {
  id: string; // users.id (uuid)
  name: string; // users.full_name
  email: string;
  role: RoleCode; // machine value, e.g. "qc_officer" - use in requireRole()
  roleLabel: string; // SRS display name, e.g. "QC Officer"
  departmentId: number | null;
  department: string | null; // departments.name, e.g. "Production"
}
