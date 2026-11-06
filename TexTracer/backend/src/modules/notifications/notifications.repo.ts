import type { Db } from "../../db/pool";
import type { AuthUser } from "../auth/auth.types";

export interface NotificationRow {
  id: number;
  type: string;
  message: string;
  productId: string | null;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationsRepo {
  list(user: AuthUser, unreadOnly: boolean, limit: number, offset: number): Promise<{ rows: NotificationRow[]; total: number }>;
  markRead(user: AuthUser, id: number): Promise<NotificationRow | null>;
}

// A notification is visible to the user it names, or to everyone with the target role (in the target department, if set).
const VISIBLE = `(n.user_id = $1::uuid OR (n.target_role = $2::role_code AND (n.department_id IS NULL OR n.department_id = $3::smallint)))`;
const COLS = `n.id::int AS id, n.type, n.message, n.product_id AS "productId", n.created_at AS "createdAt", n.read_at AS "readAt"`;

export function createNotificationsRepo(db: Db): NotificationsRepo {
  return {
    async list(u, unreadOnly, limit, offset) {
      const base = [u.id, u.role, u.departmentId];
      const where = `${VISIBLE}${unreadOnly ? " AND n.read_at IS NULL" : ""}`;
      const rows = (
        await db.query<NotificationRow>(`SELECT ${COLS} FROM notifications n WHERE ${where} ORDER BY n.id DESC LIMIT $4 OFFSET $5`, [...base, limit, offset])
      ).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications n WHERE ${where}`, base)).rows[0]!.n;
      return { rows, total };
    },
    async markRead(u, id) {
      const r = await db.query<NotificationRow>(
        `UPDATE notifications n SET read_at = coalesce(n.read_at, now())
          WHERE n.id = $4 AND ${VISIBLE}
          RETURNING ${COLS}`,
        [u.id, u.role, u.departmentId, id],
      );
      return r.rows[0] ?? null;
    },
  };
}
