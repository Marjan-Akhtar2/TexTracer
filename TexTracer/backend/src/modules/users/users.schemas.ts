import { z } from "zod";
import { ROLE_CODES } from "../../core/roles";

export const uuidParam = z.object({ id: z.string().uuid("id must be a valid UUID") });

const email = z.string().trim().toLowerCase().email().max(254);
const fullName = z.string().trim().min(2).max(100);
const password = z.string().min(8, "Password must be at least 8 characters").max(72);
const departmentId = z.number().int().positive();

export const createUserBody = z.object({
  email,
  fullName,
  password,
  role: z.enum(ROLE_CODES),
  departmentId: departmentId.nullable().optional(),
});

export const updateUserBody = z
  .object({
    email: email.optional(),
    fullName: fullName.optional(),
    password: password.optional(),
    departmentId: departmentId.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const setRoleBody = z.object({ role: z.enum(ROLE_CODES) });

export const listUsersQuery = z.object({
  role: z.enum(ROLE_CODES).optional(),
  isActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  departmentId: z.coerce.number().int().positive().optional(),
});
