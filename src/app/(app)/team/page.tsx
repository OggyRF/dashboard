import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/time";
import { listUsers } from "@/services/users";
import { CreateUserForm, UserRowActions } from "./user-forms";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const actor = await requirePermission("users.manage");
  const users = await listUsers(actor);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">Team</h1>
        <p className="text-sm text-muted">Create logins, change roles, reset passwords and sign people out.</p>
      </div>
      <CreateUserForm />
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/60 text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Last login</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 transition hover:bg-background/60 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-muted">{u.email}</div>
                </td>
                <td className="px-4 py-3">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 py-3">
                  {u.status === "ACTIVE" ? (u.mustChangePassword ? "Invited" : "Active") : "Disabled"}
                </td>
                <td className="px-4 py-3 text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                <td className="px-4 py-3">
                  <UserRowActions
                    user={{ id: u.id, email: u.email, role: u.role, status: u.status }}
                    isSelf={u.id === actor.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
