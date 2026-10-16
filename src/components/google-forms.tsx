"use client";

import { useActionState, useState } from "react";
import { RefreshCw } from "lucide-react";
import { disconnectGoogleAction, saveClientPropertyAction, savePropertiesAction, syncNowAction } from "@/server/actions/google";

function Result({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-success">{state.ok}</p>;
  return null;
}

export function SyncNowButton({ clientId, label = "Sync now" }: { clientId?: string; label?: string }) {
  const [state, action, pending] = useActionState(syncNowAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {clientId && <input type="hidden" name="clientId" value={clientId} />}
      <button type="submit" disabled={pending} className="btn-secondary inline-flex items-center gap-2">
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Pulling from Google…" : label}
      </button>
      <Result state={state} />
    </form>
  );
}

export function DisconnectButton() {
  const [state, action, pending] = useActionState(disconnectGoogleAction, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Disconnect Google? Saved data stays, but nothing new is pulled until it is connected again.")) e.preventDefault();
      }}
      className="flex items-center gap-3"
    >
      <button type="submit" disabled={pending} className="cursor-pointer text-sm font-medium text-danger hover:underline">Disconnect</button>
      <Result state={state} />
    </form>
  );
}

export type Choice = { value: string; label: string };

function PropertySelect({ name, choices, value, id, label }: { name: string; choices: Choice[]; value: string; id?: string; label?: string }) {
  // Keep a saved property in the list even if the Google account lost access to it.
  const options = value && !choices.some((c) => c.value === value) ? [{ value, label: value }, ...choices] : choices;
  return (
    <select id={id} name={name} defaultValue={value} aria-label={label} className="field">
      <option value="">Not linked</option>
      {options.map((c) => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
  );
}

export function ClientPropertyForm({ clientId, choices, current, suggested, kind = "GSC" }: { clientId: string; choices: Choice[]; current: string; suggested: string | null; kind?: "GSC" | "GA4" }) {
  const [state, action, pending] = useActionState(saveClientPropertyAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="kind" value={kind} />
      <label htmlFor="property" className="label">{kind === "GA4" ? "Google Analytics property" : "Search Console property"}</label>
      <PropertySelect id="property" name="property" choices={choices} value={current || suggested || ""} />
      {!current && suggested && <p className="text-xs text-muted">Picked from the client&apos;s {kind === "GA4" ? "name" : "website"}. Change it if it is wrong.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export type BoardRow = { id: string; name: string; website: string | null; current: string; suggested: string | null; status: string; ga4: string; ga4Suggested: string | null };

export function PropertyBoardForm({ rows, sites, ga4 }: { rows: BoardRow[]; sites: Choice[]; ga4: Choice[] | null }) {
  const [state, action, pending] = useActionState(savePropertiesAction, undefined);
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <form action={action} className="space-y-3">
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a client" aria-label="Find a client" className="field max-w-xs" />
      <div className="card divide-y divide-border p-0">
        <div className={`hidden gap-3 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase lg:grid ${ga4 ? "lg:grid-cols-[minmax(0,1fr)_16rem_16rem]" : "lg:grid-cols-[minmax(0,1fr)_22rem]"}`}>
          <span>Client</span>
          <span>Search Console</span>
          {ga4 && <span>Google Analytics</span>}
        </div>
        {rows.map((r) => (
          <div key={r.id} className={`grid gap-2 px-4 py-3 lg:items-center lg:gap-3 ${ga4 ? "lg:grid-cols-[minmax(0,1fr)_16rem_16rem]" : "lg:grid-cols-[minmax(0,1fr)_22rem]"} ${shown.includes(r) ? "" : "hidden"}`}>
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.name}</div>
              <div className="truncate text-xs text-muted">
                {r.website ? r.website.replace(/^https?:\/\//, "") : "No website saved"}
                {((!r.current && r.suggested) || (!r.ga4 && r.ga4Suggested)) && <span className="ml-2 font-semibold text-brand">Suggested match</span>}
                {r.status && <span className="ml-2">· {r.status}</span>}
              </div>
            </div>
            <PropertySelect name={`p:${r.id}`} label={`Search Console for ${r.name}`} choices={sites} value={r.current || r.suggested || ""} />
            {ga4 && <PropertySelect name={`a:${r.id}`} label={`Google Analytics for ${r.name}`} choices={ga4} value={r.ga4 || r.ga4Suggested || ""} />}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save all"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}
