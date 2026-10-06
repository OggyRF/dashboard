"use client";

import { useActionState } from "react";
import { createClientAction, updateClientAction } from "@/server/actions/clients";

type Person = { id: string; name: string; role: string };
export type ClientValues = {
  id?: string;
  name: string;
  website: string;
  type: string;
  status: string;
  industry: string;
  location: string;
  startDate: string;
  goals: string;
  notes: string;
  strategicOwnerId: string;
  executionOwnerId: string;
};

export const EMPTY_CLIENT: ClientValues = {
  name: "",
  website: "",
  type: "SEO",
  status: "ACTIVE",
  industry: "",
  location: "",
  startDate: "",
  goals: "",
  notes: "",
  strategicOwnerId: "",
  executionOwnerId: "",
};

export function ClientForm({ values, people }: { values: ClientValues; people: Person[] }) {
  const editing = !!values.id;
  const [state, action, pending] = useActionState(editing ? updateClientAction : createClientAction, undefined);
  const strategists = people.filter((p) => p.role === "OWNER" || p.role === "STRATEGY");
  const executors = people.filter((p) => p.role !== "OFFPAGE");
  return (
    <form action={action} className="space-y-5">
      {editing && <input type="hidden" name="clientId" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className="label">Client name</label>
          <input id="name" name="name" required maxLength={120} defaultValue={values.name} placeholder="e.g. IITB WashU" className="field" />
        </div>
        <div>
          <label htmlFor="website" className="label">Website</label>
          <input id="website" name="website" defaultValue={values.website} placeholder="example.com" className="field" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="type" className="label">Service</label>
            <select id="type" name="type" defaultValue={values.type} className="field">
              <option value="SEO">SEO</option>
              <option value="GMB">GMB</option>
              <option value="BOTH">SEO + GMB</option>
            </select>
          </div>
          <div>
            <label htmlFor="status" className="label">Status</label>
            <select id="status" name="status" defaultValue={values.status} className="field">
              <option value="ONBOARDING">Onboarding</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="CHURNED">Churned</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="strategicOwnerId" className="label">Strategy owner</label>
          <select id="strategicOwnerId" name="strategicOwnerId" defaultValue={values.strategicOwnerId} className="field">
            <option value="">Not set</option>
            {strategists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="executionOwnerId" className="label">Execution lead</label>
          <select id="executionOwnerId" name="executionOwnerId" defaultValue={values.executionOwnerId} className="field">
            <option value="">Not set</option>
            {executors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">Checks this client&apos;s off-page work.</p>
        </div>
        <div>
          <label htmlFor="industry" className="label">Industry</label>
          <input id="industry" name="industry" defaultValue={values.industry} placeholder="e.g. Education" className="field" />
        </div>
        <div>
          <label htmlFor="location" className="label">Location</label>
          <input id="location" name="location" defaultValue={values.location} placeholder="e.g. Mumbai" className="field" />
        </div>
        <div>
          <label htmlFor="startDate" className="label">Start date</label>
          <input id="startDate" name="startDate" type="date" defaultValue={values.startDate} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="goals" className="label">Business goals</label>
          <textarea id="goals" name="goals" rows={3} maxLength={2000} defaultValue={values.goals} placeholder="What the client wants from us" className="field" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="notes" className="label">Notes</label>
          <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={values.notes} className="field" />
        </div>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">{state.ok}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : editing ? "Save changes" : "Add client"}</button>
    </form>
  );
}
