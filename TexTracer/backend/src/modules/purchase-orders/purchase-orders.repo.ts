import type { Db } from "../../db/pool";

export interface PurchaseOrder {
  id: number;
  poNumber: string;
  supplierName: string;
  materialDescription: string;
  quantity: number;
  createdBy: string | null;
  createdAt: string;
}
const COLS = `id::int AS id, po_number AS "poNumber", supplier_name AS "supplierName",
  material_description AS "materialDescription", quantity::float8 AS quantity,
  created_by AS "createdBy", created_at AS "createdAt"`;

export interface PurchaseOrdersRepo {
  list(limit: number, offset: number): Promise<{ rows: PurchaseOrder[]; total: number }>;
  findById(id: number): Promise<PurchaseOrder | null>;
  create(input: { poNumber: string; supplierName: string; materialDescription: string; quantity: number; createdBy: string }): Promise<PurchaseOrder>;
}

export function createPurchaseOrdersRepo(db: Db): PurchaseOrdersRepo {
  return {
    async list(limit, offset) {
      const rows = (await db.query<PurchaseOrder>(`SELECT ${COLS} FROM purchase_orders ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset])).rows;
      const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM purchase_orders`)).rows[0]!.n;
      return { rows, total };
    },
    async findById(id) {
      return (await db.query<PurchaseOrder>(`SELECT ${COLS} FROM purchase_orders WHERE id = $1`, [id])).rows[0] ?? null;
    },
    async create(i) {
      return (
        await db.query<PurchaseOrder>(
          `INSERT INTO purchase_orders (po_number, supplier_name, material_description, quantity, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
          [i.poNumber, i.supplierName, i.materialDescription, i.quantity, i.createdBy],
        )
      ).rows[0]!;
    },
  };
}
