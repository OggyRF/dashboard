"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { EXTRA_TASK_SUGGESTIONS } from "@/lib/daily-labels";
import { addDailyTaskAction } from "@/server/actions/daily";

type Options = {
  people: { id: string; name: string; role: string }[];
  followers: { id: string; name: string; role: string }[];
  clients: { id: string; name: string; executionOwnerId: string | null; strategicOwnerId: string | null; offpageActivities: { id: string; name: string; onlyMonth: string | null }[] }[];
};
// For leads: a folded form to give someone extra work for the day.
export function AddDailyTask({ date, options }: { date: string; options: Options }) {
  return (
    <details className="group card p-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-bold">
        <Plus className="h-4 w-4 text-brand transition group-open:rotate-45" />Add an extra task to someone&apos;s day
        <span className="ml-auto text-xs font-normal text-muted">SERP update, extra GMB post, review replies…</span>
      </summary>
      <div className="border-t border-border p-5">
        <AddForm date={date} options={options} />
      </div>
    </details>
  );
}

function AddForm({ date, options }: { date: string; options: Options }) {
  const [clientId, setClientId] = useState("");
  const [work, setWork] = useState("OTHER");
  const [assigneeId, setAssigneeId] = useState("");
  const [state, action, pending] = useActionState(addDailyTaskAction, undefined);
  const month = date.slice(0, 7);
  const client = options.clients.find((c) => c.id === clientId);
  const activities = (client?.offpageActivities ?? []).filter((a) => !a.onlyMonth || a.onlyMonth === month);
  const usualFollowUp = client ? ([client.executionOwnerId, client.strategicOwnerId].find((id) => id && id !== assigneeId) ?? "") : "";
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor="d-person">Who</label>
          <select id="d-person" name="assigneeId" required value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field">
            <option value="" disabled>Pick a person</option>
            {options.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="d-client">Client</label>
          <select id="d-client" name="clientId" required value={clientId} onChange={(e) => setClientId(e.target.value)} className="field">
            <option value="" disabled>Pick a client</option>
            {options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="d-work">Work</label>
          <select id="d-work" name="work" value={work} onChange={(e) => setWork(e.target.value)} className="field">
            <option value="OTHER">Extra task (SERP update, GMB post…)</option>
            <option value="UPLOADING">Off-page uploading (ticks the checklist)</option>
            <option value="WRITING">Off-page writing</option>
          </select>
        </div>
        {work !== "OTHER" && (
          <div>
            <label className="label" htmlFor="d-activity">Activity</label>
            <select id="d-activity" name="activityId" required key={clientId} defaultValue="" className="field">
              <option value="" disabled>{clientId ? (activities.length ? "Pick an activity" : "No off-page plan yet") : "Pick a client first"}</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="d-qty">How many</label>
          <input id="d-qty" name="qty" type="number" min={1} max={50} required defaultValue={work === "OTHER" ? 1 : 2} key={work} className="field" />
        </div>
        <div className={work === "OTHER" ? "sm:col-span-2" : ""}>
          <label className="label" htmlFor="d-details">{work === "OTHER" ? "What to do" : "Note (optional)"}</label>
          <input id="d-details" name="details" maxLength={300} required={work === "OTHER"} list={work === "OTHER" ? "d-extra" : undefined} placeholder={work === "OTHER" ? "e.g. SERP update" : "e.g. topic: dental implants"} className="field" />
          <datalist id="d-extra">{EXTRA_TASK_SUGGESTIONS.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor="d-follow">Follow-up</label>
          <select id="d-follow" name="followUpId" key={`${clientId}:${assigneeId}`} defaultValue={usualFollowUp} className="field">
            <option value="">{client ? "Usual (project manager)" : "Pick a client first"}</option>
            {options.followers.filter((p) => p.id !== assigneeId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Adding…" : "Add"}</button>
    </form>
  );
}
