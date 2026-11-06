import { z } from "zod";

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const pageMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit)),
});

export const offsetOf = (page: number, limit: number) => (page - 1) * limit;
