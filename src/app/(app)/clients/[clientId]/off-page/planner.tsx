"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { addActivityAction, copyActivitiesAction, removeActivityAction, updateActivityAction } from "@/server/actions/offpage";

type Person = { id: string; name: string; role: string };
type Activity = { id: string; name: string; monthlyQty: number; assigneeId: string | null; reviewerId: string | null; assignee: { name: string } | null; reviewer: { name: string } | null };

export function OffpagePlanner({
  clientId,
  activities,
  people,
  otherClients,
  suggestions,
}: {
  clientId: string;
  activities: Activity[];
  people: Person[];
  otherClients: { id: string; name: string }[];
  suggestions: string[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(activities.length === 0);
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Monthly plan</h2>
          <p className="text-sm text-muted">The fixed off-page work each month. It is split over the four weeks automatically.</p>
        </div>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="btn-secondary"><Plus className="h-4 w-4" />Add activity</button>}
      </div>
      <datalist id="activity-names">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>

      {activities.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {activities.map((a) =>
            editing === a.id ? (
              <li key={a.id} className="p-4">
                <ActivityForm clientId={clientId} people={people} activity={a} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <span className="font-semibold">{a.name}</span>
                  <span className="ml-2 chip bg-brand/10 text-brand">{a.monthlyQty} a month</span>
                  <div className="text-xs text-muted">
                    Done by {a.assignee?.name ?? "nobody yet"}{a.reviewer ? ` · checked by ${a.reviewer.name}` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditing(a.id)} className="btn-secondary px-2.5 py-1.5" aria-label={`Edit ${a.name}`}><Pencil className="h-4 w-4" /></button>
                  <RemoveButton activity={a} />
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {adding && (
        <div className="rounded-xl border border-dashed border-brand/40 p-4">
          <ActivityForm clientId={clientId} people={people} onDone={() => setAdding(false)} />
        </div>
      )}

      {activities.length === 0 && otherClients.length > 0 && <CopyForm clientId={clientId} otherClients={otherClients} />}
    </section>
  );
}

function ActivityForm({ clientId, people, activity, onDone }: { clientId: string; people: Person[]; activity?: Activity; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (s: Parameters<typeof addActivityAction>[0], f: FormData) => {
    const r = await (activity ? updateActivityAction : addActivityAction)(s, f);
    if (r?.ok) onDone();
    return r;
  }, undefined);
  const doers = people;
  const checkers = people.filter((p) => p.role !== "OFFPAGE");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      {activity && <input type="hidden" name="activityId" value={activity.id} />}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="label" htmlFor={`name-${activity?.id ?? "new"}`}>Activity</label>
          <input id={`name-${activity?.id ?? "new"}`} name="name" list="activity-names" required defaultValue={activity?.name} placeholder="e.g. Guest Posting" className="field" />
        </div>
        <div>
          <label className="label" htmlFor={`qty-${activity?.id ?? "new"}`}>Per month</label>
          <input id={`qty-${activity?.id ?? "new"}`} name="monthlyQty" type="number" min={1} max={500} required defaultValue={activity?.monthlyQty ?? 10} className="field" />
        </div>
        <div>
          <label className="label" htmlFor={`as-${activity?.id ?? "new"}`}>Done by</label>
          <select id={`as-${activity?.id ?? "new"}`} name="assigneeId" defaultValue={activity?.assigneeId ?? ""} className="field">
            <option value="">Nobody yet</option>
            {doers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`rv-${activity?.id ?? "new"}`}>Checked by</label>
          <select id={`rv-${activity?.id ?? "new"}`} name="reviewerId" defaultValue={activity?.reviewerId ?? ""} className="field">
            <option value="">The execution lead</option>
            {checkers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="applyNow" defaultChecked={!activity} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
        <span>Use this from this week, not just from next month. Ticked boxes and past weeks are never changed.</span>
      </label>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : activity ? "Save" : "Add"}</button>
        <button type="button" onClick={onDone} className="btn-secondary">Cancel</button>
      </div>
    </form>
  );
}

function RemoveButton({ activity }: { activity: Activity }) {
  const [state, action, pending] = useActionState(removeActivityAction, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove ${activity.name} from the plan? Unticked boxes from this week on are removed too; work already ticked stays.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="activityId" value={activity.id} />
      <input type="hidden" name="applyNow" value="on" />
      <button type="submit" disabled={pending} className="btn-danger px-2.5 py-1.5" aria-label={`Remove ${activity.name}`}><Trash2 className="h-4 w-4" /></button>
      {state?.error && <span role="alert" className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

function CopyForm({ clientId, otherClients }: { clientId: string; otherClients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(copyActivitiesAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="min-w-56 flex-1">
        <label htmlFor="fromClientId" className="label">Or copy the plan of another client</label>
        <select id="fromClientId" name="fromClientId" className="field">
          {otherClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-secondary">Copy plan</button>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="w-full text-sm text-success">{state.ok}</p>}
    </form>
  );
}
