"use client";

import { useActionState, useState } from "react";
import { applyForLeaveAction, cancelLeaveAction, decideLeaveAction } from "@/server/actions/leave";
import { LeaveCalendar } from "./leave-calendar";

type CalendarProps = Omit<Parameters<typeof LeaveCalendar>[0], "onPick" | "picked">;

export function ApplyForLeave({ calendar }: { calendar: CalendarProps }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, action, pending] = useActionState(applyForLeaveAction, undefined);
  const single = from !== "" && from === to;

  return (
    <div className="space-y-4">
      <LeaveCalendar {...calendar} picked={from ? { from, to: to || from } : undefined} onPick={(f, t) => { setFrom(f); setTo(t); }} />
      <form action={action} className="card space-y-4">
        <h2 className="font-semibold">Apply for leave</h2>
        <p className="text-sm text-muted">Click a start day and an end day on the calendar, or type the dates.</p>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="fromDate" className="label">From</label>
            <input id="fromDate" name="fromDate" type="date" required value={from} onChange={(e) => { setFrom(e.target.value); if (!to || e.target.value > to) setTo(e.target.value); }} className="field" />
          </div>
          <div>
            <label htmlFor="toDate" className="label">To</label>
            <input id="toDate" name="toDate" type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} className="field" />
          </div>
          <div>
            <label htmlFor="type" className="label">Type</label>
            <select id="type" name="type" className="field" defaultValue="CASUAL">
              <option value="CASUAL">Casual</option>
              <option value="SICK">Sick</option>
              <option value="UNPAID">Unpaid</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <label className={`flex items-end gap-2 pb-2 text-sm ${single ? "" : "opacity-50"}`}>
            <input type="checkbox" name="halfDay" disabled={!single} /> Half day
          </label>
          <div className="sm:col-span-4">
            <label htmlFor="reason" className="label">Reason</label>
            <textarea id="reason" name="reason" required rows={2} className="field" />
          </div>
        </div>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Sending…" : "Request leave"}</button>
      </form>
    </div>
  );
}

export function CancelLeave({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelLeaveAction, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-sm text-danger hover:underline">Cancel</button>
      {state?.error && <span className="ml-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}

export function DecideLeave({ id }: { id: string }) {
  const [state, action, pending] = useActionState(decideLeaveAction, undefined);
  if (state?.ok) return <span className="text-sm text-success">{state.ok}</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="note" placeholder="Note (needed to reject)" className="field w-56 py-1" />
      <button type="submit" name="decision" value="approve" disabled={pending} className="btn-primary py-1">Approve</button>
      <button type="submit" name="decision" value="reject" disabled={pending} className="btn-danger py-1">Reject</button>
      {state?.error && <span role="alert" className="text-sm text-danger">{state.error}</span>}
    </form>
  );
}
