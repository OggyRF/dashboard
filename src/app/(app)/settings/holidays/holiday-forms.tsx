"use client";

import { useActionState } from "react";
import { addHolidayAction, removeHolidayAction } from "@/server/actions/leave";

export function AddHolidayForm() {
  const [state, action, pending] = useActionState(addHolidayAction, undefined);
  return (
    <form action={action} className="card space-y-4">
      <h2 className="font-semibold">Add a holiday</h2>
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

export function RemoveHolidayButton({ id }: { id: string }) {
  return (
    <form action={removeHolidayAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-sm text-danger hover:underline">Remove</button>
    </form>
  );
}
