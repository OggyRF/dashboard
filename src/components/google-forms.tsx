"use client";

import { useActionState, useState } from "react";
import { RefreshCw } from "lucide-react";
import { siteLabel } from "@/lib/gsc-labels";
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

type Site = { siteUrl: string };

function PropertySelect({ name, sites, value, id }: { name: string; sites: Site[]; value: string; id?: string }) {
  // Keep a saved property in the list even if the Google account lost access to it.
  const options = value && !sites.some((s) => s.siteUrl === value) ? [{ siteUrl: value }, ...sites] : sites;
  return (
    <select id={id} name={name} defaultValue={value} className="field">
      <option value="">Not linked</option>
      {options.map((s) => (
        <option key={s.siteUrl} value={s.siteUrl}>{siteLabel(s.siteUrl)}</option>
      ))}
    </select>
  );
}

export function ClientPropertyForm({ clientId, sites, current, suggested }: { clientId: string; sites: Site[]; current: string; suggested: string | null }) {
  const [state, action, pending] = useActionState(saveClientPropertyAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <label htmlFor="property" className="label">Search Console property</label>
      <PropertySelect id="property" name="property" sites={sites} value={current || suggested || ""} />
      {!current && suggested && <p className="text-xs text-muted">Picked from the client&apos;s website. Change it if it is wrong.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export type BoardRow = { id: string; name: string; website: string | null; current: string; suggested: string | null; status: string };

export function PropertyBoardForm({ rows, sites }: { rows: BoardRow[]; sites: Site[] }) {
  const [state, action, pending] = useActionState(savePropertiesAction, undefined);
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <form action={action} className="space-y-3">
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a client" aria-label="Find a client" className="field max-w-xs" />
      <div className="card divide-y divide-border p-0">
        {rows.map((r) => (
          <div key={r.id} className={`grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center ${shown.includes(r) ? "" : "hidden"}`}>
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.name}</div>
              <div className="truncate text-xs text-muted">
                {r.website ? r.website.replace(/^https?:\/\//, "") : "No website saved"}
                {!r.current && r.suggested && <span className="ml-2 font-semibold text-brand">Suggested match</span>}
                {r.status && <span className="ml-2">· {r.status}</span>}
              </div>
            </div>
            <PropertySelect name={`p:${r.id}`} sites={sites} value={r.current || r.suggested || ""} />
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
