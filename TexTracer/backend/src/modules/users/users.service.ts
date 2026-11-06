import { conflict, forbidden, notFound, unprocessable } from "../../core/errors";
import type { RoleCode } from "../../core/roles";
import type { UserPatch, UserRecord, UsersRepo } from "./users.repo";

export function createUsersService(users: UsersRepo) {
  const mustExist = async (id: string) => {
    const u = await users.findById(id);
    if (!u) throw notFound("User not found");
    return u;
  };

  return {
    list: (filter: Parameters<UsersRepo["list"]>[0]) => users.list(filter),
    get: mustExist,

    async create(
      actorId: string,
      input: { email: string; fullName: string; password: string; role: RoleCode; departmentId?: number | null },
    ): Promise<UserRecord> {
      const departmentId = input.departmentId ?? null;
      if (input.role === "department_officer" && departmentId === null) {
        throw unprocessable("A Department Officer must be assigned to a department (departmentId)", "DEPARTMENT_REQUIRED");
      }
      if (await users.emailExists(input.email)) throw conflict("A user with this email already exists");
      return users.create({
        email: input.email,
        fullName: input.fullName,
        password: input.password,
        departmentId,
        role: input.role,
        grantedBy: actorId,
      });
    },

    async update(
      actorId: string,
      id: string,
      body: { email?: string; fullName?: string; password?: string; departmentId?: number | null; isActive?: boolean },
    ): Promise<UserRecord> {
      const current = await mustExist(id);
      if (id === actorId && body.isActive === false) throw forbidden("You cannot deactivate your own account");
      if (body.departmentId === null && current.role === "department_officer") {
        throw unprocessable("A Department Officer must keep a department", "DEPARTMENT_REQUIRED");
      }
      const patch: UserPatch = {};
      if (body.email !== undefined) patch.email = body.email;
      if (body.fullName !== undefined) patch.fullName = body.fullName;
      if (body.departmentId !== undefined) patch.departmentId = body.departmentId;
      if (body.isActive !== undefined) patch.isActive = body.isActive;
      if (body.password !== undefined) patch.password = body.password;
      const updated = await users.update(id, patch);
      if (!updated) throw notFound("User not found");
      return updated;
    },

    async setRole(actorId: string, id: string, role: RoleCode): Promise<UserRecord> {
      const current = await mustExist(id);
      if (id === actorId) throw forbidden("You cannot change your own role");
      if (role === "department_officer" && current.departmentId === null) {
        throw unprocessable("Assign the user a department before making them a Department Officer", "DEPARTMENT_REQUIRED");
      }
      const updated = await users.setRole(id, role, actorId);
      if (!updated) throw notFound("User not found");
      return updated;
    },
  };
}
export type UsersService = ReturnType<typeof createUsersService>;
