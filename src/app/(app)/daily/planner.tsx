"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProgressBar } from "@/components/progress-bar";
import { EXTRA_TASK_SUGGESTIONS } from "@/lib/daily-labels";
import { addDailyTaskAction, removeDailyTaskAction } from "@/server/actions/daily";
import type { DailyTaskView } from "@/services/daily";
import { DailyLine } from "./daily-line";

type Options = {
  people: { id: string; name: string; role: string }[];
  followers: { id: string; name: string; role: string }[];
  clients: { id: string; name: string; executionOwnerId: string | null; strategicOwnerId: string | null; offpageActivities: { id: string; name: string; onlyMonth: string | null }[] }[];
};
type Group = { person: { id: string; name: string; avatarUpdatedAt: Date | null }; tasks: DailyTaskView[]; done: number; planned: number };

// For leads: everyone's list for the day, and a form to add to it.
export function DailyPlanner({ date, board, options }: { date: string; board: Group[]; options: Options }) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function remove(id: string) {
    if (!window.confirm("Remove this from the list?")) return;
    startTransition(async () => {
      const r = await removeDailyTaskAction(id);
      setError(r?.error ?? null);
    });
  }
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold">Team lists for this day</h2>
      <p className="-mt-2 text-sm text-muted">Off-page work is split into each person&apos;s day automatically from the clients&apos; monthly plans. Add extra work here.</p>
      <AddForm date={date} options={options} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {board.length === 0 ? (
        <div className="card text-sm text-muted">Nobody has a list for this day yet.</div>
      ) : (
        board.map((g) => (
          <div key={g.person.id} className="space-y-3 rounded-2xl bg-surface/60 p-3 ring-1 ring-border/70">
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <span className="flex items-center gap-2 font-semibold"><Avatar person={g.person} size="sm" />{g.person.name}</span>
              <div className="w-56"><ProgressBar label="Done" done={g.done} planned={g.planned} /></div>
            </div>
            {groupByClient(g.tasks).map(([client, lines]) => (
              <div key={client.id} className="space-y-2">
                <div className="px-1 text-sm font-bold">{client.name}</div>
                {lines.map((t) => <DailyLine key={t.id} line={t} canWork={false} onRemove={() => remove(t.id)} />)}
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function groupByClient(tasks: DailyTaskView[]) {
  const map = new Map<string, [DailyTaskView["client"], DailyTaskView[]]>();
  for (const t of tasks) {
    const g = map.get(t.client.id) ?? [t.client, []];
    g[1].push(t);
    map.set(t.client.id, g);
  }
  return [...map.values()];
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
    <form action={action} className="card space-y-3">
      <h3 className="flex items-center gap-2 font-bold"><Plus className="h-4 w-4 text-brand" />Add a task to someone&apos;s day</h3>
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
