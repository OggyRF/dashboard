"use client";

import { useActionState, useState } from "react";
import { RefreshCw } from "lucide-react";
import { checkWebsiteAction, saveWebsiteMetricsAction } from "@/server/actions/insights";

function Result({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-success">{state.ok}</p>;
  return null;
}

export function CheckWebsiteButton({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(checkWebsiteAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <button type="submit" disabled={pending} className="btn-secondary inline-flex items-center gap-2">
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Checking (up to a minute)…" : "Check now"}
      </button>
      <Result state={state} />
    </form>
  );
}

type Saved = { month: string; label: string; da: number | null; pa: number | null; backlinks: number | null; refDomains: number | null; spamScore: number | null; mobileSpeed: number | null; desktopSpeed: number | null };

const FIELDS: [keyof Omit<Saved, "month" | "label">, string][] = [
  ["da", "DA"],
  ["pa", "PA"],
  ["backlinks", "Backlinks"],
  ["refDomains", "Ref domains"],
  ["spamScore", "Spam score"],
  ["mobileSpeed", "Mobile speed"],
  ["desktopSpeed", "Desktop speed"],
];

// Typing a month's figures by hand, e.g. older months from the old sheet.
export function MonthFiguresForm({ clientId, months }: { clientId: string; months: Saved[] }) {
  const [state, action, pending] = useActionState(saveWebsiteMetricsAction, undefined);
  const [month, setMonth] = useState(months[0]?.month ?? "");
  const current = months.find((m) => m.month === month);
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">Type in a month&apos;s figures</summary>
      <p className="mt-1 text-sm text-muted">For older months, or numbers from another tool. Leave a box empty to keep it blank.</p>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="clientId" value={clientId} />
        <div>
          <label className="label" htmlFor="figures-month">Month</label>
          <select id="figures-month" name="month" value={month} onChange={(e) => setMonth(e.target.value)} className="field w-auto">
            {months.map((o) => <option key={o.month} value={o.month}>{o.label}</option>)}
          </select>
        </div>
        <div key={month} className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {FIELDS.map(([name, label]) => (
            <div key={name}>
              <label className="label" htmlFor={`fig-${name}`}>{label}</label>
              <input id={`fig-${name}`} name={name} inputMode="numeric" defaultValue={current?.[name] ?? ""} className="field" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
          <Result state={state} />
        </div>
      </form>
    </details>
  );
}
