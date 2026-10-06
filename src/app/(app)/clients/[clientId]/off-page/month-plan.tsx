"use client";

import { useActionState, useState } from "react";
import { CalendarCog, Plus } from "lucide-react";
import { addMonthActivityAction, setMonthQtyAction } from "@/server/actions/offpage";

type Row = { id: string; name: string; assignee: string | null; usual: number; qty: number; extra: boolean };
type Person = { id: string; name: string };

// Changes to one month only: more or fewer of an activity, or an extra
// activity just for this month. The usual monthly plan stays as it is.
export function MonthPlan({ clientId, month, label, rows, people, isCurrent }: { clientId: string; month: string; label: string; rows: Row[]; people: Person[]; isCurrent: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarCog className="h-5 w-5 text-brand" />{label} only</h2>
          <p className="text-sm text-muted">
            Change the numbers for this month without touching the usual plan.
            {isCurrent ? " Ticked boxes and past weeks are kept; the rest is spread over the weeks left." : " Next month goes back to the usual numbers."}
          </p>
        </div>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="btn-secondary"><Plus className="h-4 w-4" />Extra for {label.split(" ")[0]}</button>}
      </div>
      {rows.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((r) => <QtyRow key={r.id} row={r} month={month} />)}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing planned for this month yet.</p>
      )}
      {adding && <ExtraForm clientId={clientId} month={month} people={people} onDone={() => setAdding(false)} />}
    </section>
  );
}

function QtyRow({ row, month }: { row: Row; month: string }) {
  const [state, action, pending] = useActionState(setMonthQtyAction, undefined);
  const changed = !row.extra && row.qty !== row.usual;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <span className="font-semibold">{row.name}</span>
        {row.extra ? (
          <span className="ml-2 chip bg-violet-50 text-violet-700">This month only</span>
        ) : (
          changed && <span className="ml-2 chip bg-warning/10 text-warning">Usually {row.usual}</span>
        )}
        <div className="text-xs text-muted">Done by {row.assignee ?? "nobody yet"}</div>
      </div>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="activityId" value={row.id} />
        <input type="hidden" name="month" value={month} />
        <label className="sr-only" htmlFor={`mq-${row.id}`}>{row.name} this month</label>
        <input id={`mq-${row.id}`} name="qty" type="number" min={0} max={500} required defaultValue={row.qty} className="field w-20 py-1.5" />
        <button type="submit" disabled={pending} className="btn-secondary py-1.5">{pending ? "Saving…" : "Save"}</button>
        {changed && (
          <button type="submit" name="usualQty" value={row.usual} disabled={pending} className="text-xs font-semibold text-brand">Back to {row.usual}</button>
        )}
      </form>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </li>
  );
}

function ExtraForm({ clientId, month, people, onDone }: { clientId: string; month: string; people: Person[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (s: Parameters<typeof addMonthActivityAction>[0], f: FormData) => {
    const r = await addMonthActivityAction(s, f);
    if (r?.ok) onDone();
    return r;
  }, undefined);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-dashed border-brand/40 p-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="month" value={month} />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr]">
        <div>
          <label className="label" htmlFor="extra-name">Activity</label>
          <input id="extra-name" name="name" list="activity-names" required placeholder="e.g. Press Release" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="extra-qty">How many</label>
          <input id="extra-qty" name="monthlyQty" type="number" min={1} max={500} required defaultValue={1} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="extra-as">Done by</label>
          <select id="extra-as" name="assigneeId" className="field">
            <option value="">Nobody yet</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Adding…" : "Add for this month"}</button>
        <button type="button" onClick={onDone} className="btn-secondary">Cancel</button>
      </div>
    </form>
  );
}
