"use client";

import { useActionState, useState } from "react";
import { correctDayAction } from "@/server/actions/attendance";

type Kind = "CHANGE_TIME" | "ADD_EVENT" | "REMOVE_EVENT";

export function CorrectionForms({ dayId, events }: { dayId: string; events: { id: string; label: string }[] }) {
  const [kind, setKind] = useState<Kind>(events.length ? "CHANGE_TIME" : "ADD_EVENT");
  const [state, action, pending] = useActionState(correctDayAction, undefined);

  return (
    <form action={action} className="card space-y-4">
      <div>
        <h2 className="text-lg font-bold">Correct this day</h2>
        <p className="text-sm text-muted">The original entries are kept. Your correction and reason are shown on the record and in the audit log.</p>
      </div>
      <input type="hidden" name="dayId" value={dayId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap gap-2">
        {([
          ["CHANGE_TIME", "Change a time"],
          ["ADD_EVENT", "Add a missing entry"],
          ["REMOVE_EVENT", "Remove an entry"],
        ] as [Kind, string][]).map(([k, label]) => (
          <button key={k} type="button" disabled={k !== "ADD_EVENT" && !events.length} onClick={() => setKind(k)} className={kind === k ? "btn-primary py-1" : "btn-secondary py-1"}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {kind !== "ADD_EVENT" && (
          <div>
            <label htmlFor="eventId" className="label">Entry</label>
            <select id="eventId" name="eventId" className="field">
              {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
        )}
        {kind === "ADD_EVENT" && (
          <div>
            <label htmlFor="type" className="label">Entry</label>
            <select id="type" name="type" className="field" defaultValue="LOGOUT">
              <option value="LOGIN">Logged in</option>
              <option value="BREAK_START">Break started</option>
              <option value="BREAK_END">Break ended</option>
              <option value="LOGOUT">Logged out</option>
            </select>
          </div>
        )}
        {kind !== "REMOVE_EVENT" && (
          <div>
            <label htmlFor="time" className="label">{kind === "CHANGE_TIME" ? "Correct time (IST)" : "Time (IST)"}</label>
            <input id="time" name="time" type="time" required defaultValue={state?.time} className="field" />
          </div>
        )}
        <div className="sm:col-span-3">
          <label htmlFor="reason" className="label">Reason</label>
          <input id="reason" name="reason" required defaultValue={state?.reason} placeholder="For example: forgot to log out, left at 6:30 pm" className="field" />
        </div>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save correction"}</button>
    </form>
  );
}
