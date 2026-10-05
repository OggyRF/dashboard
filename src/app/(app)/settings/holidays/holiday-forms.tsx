"use client";

import { useActionState, useState } from "react";
import { formatDayKey } from "@/lib/dates";
import { addHolidayAction, removeHolidayAction, updateHolidayAction } from "@/server/actions/leave";

export function AddHolidayForm() {
  const [state, action, pending] = useActionState(addHolidayAction, undefined);
  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-bold">Add a holiday</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="date" className="label">Date</label>
          <input id="date" name="date" type="date" required className="field" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="name" className="label">Name</label>
          <input id="name" name="name" required placeholder="For example: Diwali" className="field" />
        </div>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Adding…" : "Add holiday"}</button>
    </form>
  );
}

// One holiday: shown as text, or as an inline form while being edited.
export function HolidayRow({ holiday }: { holiday: { id: string; key: string; name: string } }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (s: Parameters<typeof updateHolidayAction>[0], f: FormData) => {
    const result = await updateHolidayAction(s, f);
    if (result?.ok) setEditing(false);
    return result;
  }, undefined);

  if (editing) {
    return (
      <li className="px-4 py-3">
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={holiday.id} />
          <input name="date" type="date" required defaultValue={holiday.key} className="field w-44 py-1.5" aria-label="Date" />
          <input name="name" required defaultValue={holiday.name} className="field min-w-48 flex-1 py-1.5" aria-label="Name" />
          <button type="submit" disabled={pending} className="btn-primary py-1.5">{pending ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="btn-secondary py-1.5">Cancel</button>
        </form>
        {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span>
        <span className="font-semibold">{formatDayKey(holiday.key, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</span>
        <span className="text-muted"> · </span>
        {holiday.name}
      </span>
      <span className="flex items-center gap-3">
        <button type="button" onClick={() => setEditing(true)} className="cursor-pointer text-sm font-medium text-brand hover:underline">Edit</button>
        <form action={removeHolidayAction}>
          <input type="hidden" name="id" value={holiday.id} />
          <button type="submit" className="cursor-pointer text-sm text-danger hover:underline">Remove</button>
        </form>
      </span>
    </li>
  );
}
