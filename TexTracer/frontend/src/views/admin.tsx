import { useState } from "react";
import { Check, KeyRound, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { departmentsApi, readersApi, rolesApi, usersApi, type ApiRole, type ApiUser, type UserRecord } from "@/lib/api";
import { errorMessage, fmtDateTime, ROLE_CODES, ROLE_LABEL, stageLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** System Administrator accounts are not created or assigned from this screen. */
const ASSIGNABLE_ROLES = ROLE_CODES.filter((r) => r !== "system_admin");
import { useApi } from "@/lib/useApi";
import { DeviceActivityPanel } from "@/views/livescans";
import { Async, Empty, inputCls, PageIntro, Panel, selectCls, Status } from "@/components/textracer/ui";

/* ---------------------------------- Users ---------------------------------- */
export function UsersView({ me }: { me: ApiUser }) {
  const users = useApi(() => usersApi.list(), []);
  const departments = useApi(() => departmentsApi.list(), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function changeRole(u: UserRecord, role: ApiRole) {
    setBusyId(u.id);
    try { await usersApi.setRole(u.id, role); toast.success(`${u.fullName} is now assigned the ${ROLE_LABEL[role]} role`); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusyId(null); users.reload(); }
  }
  async function toggleActive(u: UserRecord) {
    setBusyId(u.id);
    try { await usersApi.update(u.id, { isActive: !u.isActive }); toast.success(`${u.fullName} ${u.isActive ? "deactivated" : "activated"}`); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusyId(null); users.reload(); }
  }

  return (
    <>
      <PageIntro title="User Management" detail="Create accounts, assign roles and departments, and activate or deactivate access." />
      <Panel title="User accounts" subtitle={`${users.data?.length ?? 0} account(s)`}>
        <div className="mb-4 flex justify-end"><Button onClick={() => setCreating(true)}><Plus />New user</Button></div>
        <Async loading={users.loading} error={users.error} onRetry={users.reload}>
          {users.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">User</th><th>Email</th><th>Assigned role</th><th>Department</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {users.data.map((u) => (
                    <tr className="border-b" key={u.id}>
                      <td className="py-3"><b>{u.fullName}</b><div className="text-xs text-muted-foreground">Created {fmtDateTime(u.createdAt)}</div></td>
                      <td>{u.email}</td>
                      <td>
                        <select aria-label={`Role for ${u.fullName}`} value={u.role ?? ""} disabled={busyId === u.id || u.id === me.id} title={u.id === me.id ? "You cannot change your own role" : undefined}
                          onChange={(e) => changeRole(u, e.target.value as ApiRole)} className="h-8 rounded border border-input bg-card px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60">
                          {!u.role && <option value="">No role</option>}
                          {(u.role === "system_admin" ? ROLE_CODES : ASSIGNABLE_ROLES).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                      <td>{u.department ?? "—"}</td>
                      <td><Status value={u.isActive ? "Active" : "Inactive"} /></td>
                      <td className="text-right">
                        <Button variant="ghost" size="sm" disabled={busyId === u.id || u.id === me.id} title={u.id === me.id ? "You cannot deactivate yourself" : undefined} onClick={() => toggleActive(u)}>{u.isActive ? "Deactivate" : "Activate"}</Button>
                        <Button variant="ghost" size="icon" aria-label={`Edit ${u.fullName}`} onClick={() => setEditing(u)}><Pencil /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty text="No users found." />}
        </Async>
      </Panel>
      {creating && <CreateUser departments={departments.data ?? []} onClose={() => setCreating(false)} onDone={() => { setCreating(false); users.reload(); }} />}
      {editing && <EditUser user={editing} departments={departments.data ?? []} onClose={() => setEditing(null)} onDone={() => { setEditing(null); users.reload(); }} />}
    </>
  );
}

type Dept = { id: number; name: string };

function CreateUser({ departments, onClose, onDone }: { departments: Dept[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: "", email: "", password: "", role: "department_officer" as ApiRole, departmentId: "" });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsDept = f.role === "department_officer";

  async function submit() {
    if (f.fullName.trim().length < 2) { setError("Enter the full name."); return; }
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) { setError("Enter a valid email address."); return; }
    if (f.password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (f.role === "system_admin") { setError("System Administrator accounts cannot be created here."); return; }
    if (needsDept && !f.departmentId) { setTouched(true); setError("Select a department for the Department Officer."); return; }
    setBusy(true); setError("");
    try {
      await usersApi.create({ fullName: f.fullName.trim(), email: f.email.trim().toLowerCase(), password: f.password, role: f.role, departmentId: needsDept && f.departmentId ? Number(f.departmentId) : null });
      toast.success("User account created");
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create user account</DialogTitle><DialogDescription>Assign a role to the new account. The user can sign in immediately with the temporary password.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><label className="text-sm font-medium" htmlFor="cu-name">Full name</label><input id="cu-name" className={cn(inputCls, "mt-1")} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
          <div><label className="text-sm font-medium" htmlFor="cu-email">Email address</label><input id="cu-email" className={cn(inputCls, "mt-1")} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><label className="text-sm font-medium" htmlFor="cu-pass">Temporary password</label><input id="cu-pass" className={cn(inputCls, "mt-1")} type="password" placeholder="At least 8 characters" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
          <div>
            <label className="text-sm font-medium" htmlFor="cu-role">Role</label>
            <select id="cu-role" className={cn(selectCls, "mt-1 h-10 w-full")} value={f.role} onChange={(e) => { const role = e.target.value as ApiRole; setF({ ...f, role, departmentId: role === "department_officer" ? f.departmentId : "" }); setTouched(false); setError(""); }}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div>
            <label className={cn("text-sm font-medium", !needsDept && "text-muted-foreground")} htmlFor="cu-dept">Department{needsDept && <span className="text-destructive"> *</span>}</label>
            <select id="cu-dept" disabled={!needsDept} aria-required={needsDept} className={cn(selectCls, "mt-1 h-10 w-full", needsDept && touched && !f.departmentId && "border-destructive")} value={needsDept ? f.departmentId : ""} onChange={(e) => { setF({ ...f, departmentId: e.target.value }); setError(""); }}>
              <option value="">{needsDept ? "Select a department" : "Not applicable for this role"}</option>
              {needsDept && departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{needsDept ? "Department Officers can only access their assigned department." : "Only Department Officers are assigned to a department."}</p>
          </div>
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create user"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUser({ user, departments, onClose, onDone }: { user: UserRecord; departments: Dept[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: user.fullName, email: user.email, departmentId: user.departmentId ? String(user.departmentId) : "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (f.fullName.trim().length < 2) { setError("Enter the full name."); return; }
    if (f.password && f.password.length < 8) { setError("New password must be at least 8 characters."); return; }
    setBusy(true); setError("");
    try {
      await usersApi.update(user.id, {
        fullName: f.fullName.trim(), email: f.email.trim().toLowerCase(),
        departmentId: f.departmentId ? Number(f.departmentId) : null,
        password: f.password || undefined,
      });
      toast.success("User details saved");
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit {user.fullName}</DialogTitle><DialogDescription>Leave the password empty to keep it unchanged.</DialogDescription></DialogHeader>
        <input className={inputCls} aria-label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        <input className={inputCls} aria-label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <select aria-label="Department" className={`${selectCls} h-10`} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
          <option value="">No department</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input className={inputCls} type="password" placeholder="New password (optional)" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={submit}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- Roles ---------------------------------- */
export function RolesView() {
  const roles = useApi(() => rolesApi.list(), []);
  return (
    <>
      <PageIntro title="Roles & Permissions" detail="Access boundaries for the six system roles." />
      <Async loading={roles.loading} error={roles.error} onRetry={roles.reload}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.data?.map((r) => (
            <Panel title={r.label} key={r.code} subtitle={r.code === "auditor" || r.code === "senior_management" ? "Strictly read-only" : "Operational access"}>
              <ul className="space-y-3">{r.permissions.map((p) => <li className="flex gap-2 text-sm" key={p}><Check className="h-4 w-4 shrink-0 text-success" />{p}</li>)}</ul>
            </Panel>
          ))}
        </div>
      </Async>
    </>
  );
}

/* --------------------------- RFID reader device keys --------------------------- */
export function ReadersView() {
  const readers = useApi(() => readersApi.list(), []);
  const [confirm, setConfirm] = useState<{ id: number; code: string; hasKey: boolean } | null>(null);
  const [issued, setIssued] = useState<{ code: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function provision() {
    if (!confirm) return;
    setBusy(true); setError("");
    try {
      const r = await readersApi.provisionKey(confirm.id);
      setIssued({ code: r.readerCode, key: r.deviceKey });
      setConfirm(null); readers.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageIntro title="RFID Readers" detail="Issue the device key each reader uses to submit scans." />
      <Panel title="Readers" subtitle="Keys are stored hashed. Issuing a new key replaces the current one.">
        <Async loading={readers.loading} error={readers.error} onRetry={readers.reload}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-3">Reader</th><th>Stage</th><th>Department</th><th>Status</th><th>Device key</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {readers.data?.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-3 font-mono text-xs font-semibold">{r.code}<div className="font-sans font-normal text-muted-foreground">{r.description}</div></td>
                    <td>{stageLabel(r.stage)}</td><td>{r.department}</td>
                    <td><Status value={r.isActive ? "Active" : "Inactive"} /></td>
                    <td><Status value={r.hasDeviceKey ? "Key issued" : "No key issued"} /></td>
                    <td className="text-right"><Button size="sm" variant="outline" onClick={() => { setConfirm({ id: r.id, code: r.code, hasKey: r.hasDeviceKey }); setError(""); }}><KeyRound />{r.hasDeviceKey ? "Rotate key" : "Generate key"}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Async>
      </Panel>
      <div className="mt-6"><DeviceActivityPanel /></div>
      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o && !busy) setConfirm(null); }}>
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader><DialogTitle>{confirm.hasKey ? "Rotate" : "Generate"} key for {confirm.code}</DialogTitle><DialogDescription>{confirm.hasKey ? "The current key stops working immediately. " : ""}The new key is displayed once only.</DialogDescription></DialogHeader>
              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
              <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button><Button disabled={busy} onClick={provision}>Confirm</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent>
          {issued && (
            <>
              <DialogHeader><DialogTitle>Device key for {issued.code}</DialogTitle><DialogDescription>Copy it to the reader now. It cannot be displayed again.</DialogDescription></DialogHeader>
              <code className="block break-all rounded-md bg-muted p-3 font-mono text-xs">{issued.key}</code>
              <DialogFooter><Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(issued.key); toast.success("Key copied"); }}>Copy</Button><Button onClick={() => setIssued(null)}>Done</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
