import type { Db, Queryable } from "../../db/pool";
import { ROLE_PRIORITY, type RoleCode } from "../../core/roles";

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  departmentId: number | null;
  department: string | null;
  role: RoleCode | null;
  createdAt: string;
  updatedAt: string;
}
export interface UserPatch {
  fullName?: string;
  email?: string;
  departmentId?: number | null;
  isActive?: boolean;
  password?: string;
}

export interface UsersRepo {
  list(filter: { role?: RoleCode; isActive?: boolean; departmentId?: number }): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  /** Checks the password in the database (pgcrypto bcrypt). null = no such email. */
  verifyLogin(email: string, password: string): Promise<{ user: UserRecord; passwordOk: boolean } | null>;
  emailExists(email: string): Promise<boolean>;
  create(input: {
    email: string;
    fullName: string;
    password: string;
    departmentId: number | null;
    role: RoleCode;
    grantedBy: string | null;
  }): Promise<UserRecord>;
  update(id: string, patch: UserPatch): Promise<UserRecord | null>;
  setRole(id: string, role: RoleCode, grantedBy: string): Promise<UserRecord | null>;
}

// ROLE_PRIORITY is a trusted constant (not user input), so inlining it is safe.
const ROLE_ORDER = `ARRAY[${ROLE_PRIORITY.map((r) => `'${r}'`).join(",")}]::text[]`;

export const SELECT_USER = `
  SELECT u.id, u.email::text AS email, u.full_name AS "fullName", u.is_active AS "isActive",
         u.department_id AS "departmentId", d.name AS department, r.role AS role,
         u.created_at AS "createdAt", u.updated_at AS "updatedAt"
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN LATERAL (
      SELECT ur.role::text AS role FROM user_roles ur
       WHERE ur.user_id = u.id
       ORDER BY array_position(${ROLE_ORDER}, ur.role::text) LIMIT 1
    ) r ON true`;

const DUMMY_SALT = "$2a$10$CwTycUXWue0Thq9StjUM0u"; // used only to burn the same time for unknown emails

export function createUsersRepo(db: Db): UsersRepo {
  const byId = async (q: Queryable, id: string) =>
    (await q.query<UserRecord>(`${SELECT_USER} WHERE u.id = $1`, [id])).rows[0] ?? null;

  return {
    async list({ role, isActive, departmentId }) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (role) { params.push(role); where.push(`r.role = $${params.length}`); }
      if (isActive !== undefined) { params.push(isActive); where.push(`u.is_active = $${params.length}`); }
      if (departmentId !== undefined) { params.push(departmentId); where.push(`u.department_id = $${params.length}`); }
      const sql = `${SELECT_USER} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY u.created_at, u.email`;
      return (await db.query<UserRecord>(sql, params)).rows;
    },

    findById: (id) => byId(db, id),

    async emailExists(email) {
      return (await db.query(`SELECT 1 FROM users WHERE email = $1`, [email])).rowCount > 0;
    },

    async verifyLogin(email, password) {
      const r = await db.query<UserRecord & { passwordOk: boolean }>(
        `SELECT x.*, (u.password_hash = crypt($2, u.password_hash)) AS "passwordOk"
           FROM (${SELECT_USER} WHERE u.email = $1) x JOIN users u ON u.id = x.id`,
        [email, password],
      );
      const row = r.rows[0];
      if (!row) {
        await db.query(`SELECT crypt($1, $2)`, [password, DUMMY_SALT]); // equalise timing
        return null;
      }
      const { passwordOk, ...user } = row;
      return { user, passwordOk: passwordOk === true };
    },

    create: (input) =>
      db.transaction(async (tx) => {
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO users (email, full_name, password_hash, department_id)
           VALUES ($1, $2, crypt($3, gen_salt('bf', 10)), $4) RETURNING id`,
          [input.email, input.fullName, input.password, input.departmentId],
        );
        const id = ins.rows[0]!.id;
        await tx.query(`INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2::role_code, $3)`, [
          id,
          input.role,
          input.grantedBy,
        ]);
        return (await byId(tx, id))!;
      }),

    async update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, value: unknown, expr = "$#") => {
        params.push(value);
        sets.push(`${col} = ${expr.replace("$#", `$${params.length}`)}`);
      };
      if (patch.fullName !== undefined) push("full_name", patch.fullName);
      if (patch.email !== undefined) push("email", patch.email);
      if (patch.departmentId !== undefined) push("department_id", patch.departmentId);
      if (patch.isActive !== undefined) push("is_active", patch.isActive);
      if (patch.password !== undefined) push("password_hash", patch.password, "crypt($#, gen_salt('bf', 10))");
      if (sets.length === 0) return byId(db, id);
      params.push(id);
      const r = await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
      return r.rowCount === 0 ? null : byId(db, id);
    },

    setRole: (id, role, grantedBy) =>
      db.transaction(async (tx) => {
        if (!(await byId(tx, id))) return null;
        await tx.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]);
        await tx.query(`INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2::role_code, $3)`, [id, role, grantedBy]);
        return byId(tx, id);
      }),
  };
}
