"use client";

import { useActionState } from "react";
import { Avatar } from "@/components/avatar";
import { setAssignmentsAction } from "@/server/actions/clients";

type Person = { id: string; name: string; role: string; avatarUpdatedAt: Date | null };
const COLUMNS = [
  ["STRATEGY", "SEO Strategist"],
  ["EXECUTION", "SEO Project Manager"],
  ["OFFPAGE", "Off-Page SEO Specialist"],
] as const;

export function TeamForm({ clientId, people, current, locked }: { clientId: string; people: Person[]; current: string[]; locked: string[] }) {
  const [state, action, pending] = useActionState(setAssignmentsAction, undefined);
  const on = new Set(current);
  const fixed = new Set(locked);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="py-2 pr-4 font-semibold">Person</th>
              {COLUMNS.map(([, label]) => <th key={label} className="px-3 py-2 text-center font-semibold">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-2 whitespace-nowrap"><Avatar person={p} size="xs" />{p.name}</span>
                </td>
                {COLUMNS.map(([value, label]) => {
                  const key = `${p.id}:${value}`;
                  const allowed = p.role === "OFFPAGE" ? value === "OFFPAGE" : true;
                  return (
                    <td key={value} className="px-3 py-2 text-center">
                      {allowed && (
                        <input
                          type="checkbox"
                          name="member"
                          value={key}
                          defaultChecked={on.has(key)}
                          disabled={fixed.has(key)}
                          aria-label={`${p.name}: ${label}`}
                          className="h-4 w-4 accent-[var(--brand)]"
                        />
                      )}
                      {fixed.has(key) && <input type="hidden" name="member" value={key} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Owners and strategy can open every client already; tick them here to show who is responsible. The three leads picked above always stay on.</p>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save team"}</button>
    </form>
  );
}
