"use client";

import { useActionState } from "react";
import { createTaskAction, updateTaskAction } from "@/server/actions/tasks";
import { TASK_CATEGORY_LABELS, TASK_PRIORITY_LABELS } from "@/lib/task-labels";

type Person = { id: string; name: string; role: string };
export type TaskValues = {
  number?: number;
  clientId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  assigneeId: string;
  followUpId: string;
  dueDate: string;
  sourceMessageId?: string;
};

export function TaskForm({ values, people, clients }: { values: TaskValues; people: Person[]; clients?: { id: string; name: string }[] }) {
  const editing = values.number !== undefined;
  const [state, action, pending] = useActionState(editing ? updateTaskAction : createTaskAction, undefined);
  const workers = people.filter((p) => p.role !== "OFFPAGE");
  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="number" value={values.number} />}
      {values.sourceMessageId && <input type="hidden" name="sourceMessageId" value={values.sourceMessageId} />}
      {clients && (
        <div>
          <label htmlFor="clientId" className="label">Client</label>
          <select id="clientId" name="clientId" required defaultValue={values.clientId} className="field">
            <option value="" disabled>Pick a client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="title" className="label">Task</label>
        <input id="title" name="title" required maxLength={200} defaultValue={values.title} placeholder="e.g. Fix canonical tags on blog pages" className="field" />
      </div>
      <div>
        <label htmlFor="description" className="label">Details</label>
        <textarea id="description" name="description" rows={4} maxLength={5000} defaultValue={values.description} className="field" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="assigneeId" className="label">Who does it</label>
          <select id="assigneeId" name="assigneeId" defaultValue={values.assigneeId} className="field">
            <option value="">Nobody yet</option>
            {workers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="followUpId" className="label">Who follows up</label>
          <select id="followUpId" name="followUpId" defaultValue={values.followUpId} className="field">
            <option value="">Nobody</option>
            {workers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dueDate" className="label">Due date</label>
          <input id="dueDate" name="dueDate" type="date" defaultValue={values.dueDate} className="field" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="priority" className="label">Priority</label>
            <select id="priority" name="priority" defaultValue={values.priority} className="field">
              {Object.entries(TASK_PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="category" className="label">Type</label>
            <select id="category" name="category" defaultValue={values.category} className="field">
              {Object.entries(TASK_CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : editing ? "Save changes" : "Create task"}</button>
    </form>
  );
}
