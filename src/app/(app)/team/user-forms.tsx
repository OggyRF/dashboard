"use client";

import { useActionState } from "react";
import {
  createUserAction,
  resetPasswordAction,
  signOutEverywhereAction,
  updateUserAction,
  type UserFormState,
} from "@/server/actions/users";

const ROLES = [
  { value: "OWNER", label: "Owner" },
  { value: "STRATEGY", label: "Strategy" },
  { value: "EXECUTION", label: "Execution" },
  { value: "OFFPAGE", label: "Off-page" },
];

function Result({ state }: { state: UserFormState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  return (
    <div className="space-y-1 text-sm text-success">
      <p>{state.ok}</p>
      {state.temporaryPassword && (
        <p className="rounded-xl border border-border bg-background p-3 text-foreground">
          Temporary password for {state.forEmail}:{" "}
          <code className="font-mono font-semibold">{state.temporaryPassword}</code>
          <span className="mt-1 block text-xs text-muted">
            Shown once. Send it to them privately; they must change it when they first sign in.
          </span>
        </p>
      )}
    </div>
  );
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUserAction, undefined);
  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-bold">Add a team member</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="label">Name</label>
          <input id="name" name="name" required className="field" />
        </div>
        <div>
          <label htmlFor="email" className="label">Email (any provider)</label>
          <input id="email" name="email" type="email" required className="field" />
        </div>
        <div>
          <label htmlFor="role" className="label">Role</label>
          <select id="role" name="role" required defaultValue="EXECUTION" className="field">
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <Result state={state} />
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Creating…" : "Create login"}</button>
    </form>
  );
}

type RowUser = { id: string; email: string; role: string; status: string };

export function UserRowActions({ user, isSelf }: { user: RowUser; isSelf: boolean }) {
  const [roleState, roleAction] = useActionState(updateUserAction, undefined);
  const [statusState, statusAction] = useActionState(updateUserAction, undefined);
  const [resetState, resetAction, resetting] = useActionState(resetPasswordAction, undefined);
  const [signOutState, signOutAction] = useActionState(signOutEverywhereAction, undefined);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={roleAction} className="flex gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <select name="role" defaultValue={user.role} disabled={isSelf} className="field w-32 py-1">
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button type="submit" disabled={isSelf} className="btn-secondary py-1">Save role</button>
        </form>
        {!isSelf && (
          <form action={statusAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="status" value={user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"} />
            <button type="submit" className={user.status === "ACTIVE" ? "btn-danger py-1" : "btn-secondary py-1"}>
              {user.status === "ACTIVE" ? "Disable" : "Enable"}
            </button>
          </form>
        )}
        {!isSelf && (
          <form action={resetAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="email" value={user.email} />
            <button type="submit" disabled={resetting} className="btn-secondary py-1">Reset password</button>
          </form>
        )}
        {!isSelf && (
          <form action={signOutAction}>
            <input type="hidden" name="userId" value={user.id} />
            <button type="submit" className="btn-secondary py-1">Sign out everywhere</button>
          </form>
        )}
      </div>
      <Result state={roleState ?? statusState ?? resetState ?? signOutState} />
    </div>
  );
}
