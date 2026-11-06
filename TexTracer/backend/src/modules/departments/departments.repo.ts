import type { Db } from "../../db/pool";

export interface Department {
  id: number;
  code: string;
  name: string;
}
export interface DepartmentsRepo {
  list(): Promise<Department[]>;
  findById(id: number): Promise<Department | null>;
}

export function createDepartmentsRepo(db: Db): DepartmentsRepo {
  return {
    list: async () => (await db.query<Department>(`SELECT id::int AS id, code, name FROM departments ORDER BY id`)).rows,
    findById: async (id) =>
      (await db.query<Department>(`SELECT id::int AS id, code, name FROM departments WHERE id = $1`, [id])).rows[0] ?? null,
  };
}
