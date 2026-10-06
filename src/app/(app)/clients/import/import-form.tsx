"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importClientsAction } from "@/server/actions/clients";

export function ImportForm() {
  const [state, action, pending] = useActionState(importClientsAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="lines" className="label">One client per line</label>
        <textarea
          id="lines"
          name="lines"
          rows={12}
          required
          className="field font-mono text-xs"
          placeholder={"IITB WashU, iitbwashu.org, SEO\nCafe Bloom, cafebloom.in, GMB\nSharma Dental, sharmadental.com, BOTH"}
        />
        <p className="mt-1 text-xs text-muted">Name, website, service (SEO, GMB or BOTH). Commas or tabs both work, so you can copy columns straight from Google Sheets or Excel. Website and service can be left out.</p>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.added && (
        <div className="rounded-xl bg-success/10 p-4 text-sm text-success">
          Added {state.added.length} client{state.added.length === 1 ? "" : "s"}.{" "}
          <Link href="/clients" className="font-semibold underline">See the list</Link>
        </div>
      )}
      {state?.problems && state.problems.length > 0 && (
        <div className="rounded-xl bg-warning/10 p-4 text-sm text-warning">
          <p className="font-semibold">These lines were skipped:</p>
          <ul className="mt-1 list-disc pl-5">{state.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Adding…" : "Add clients"}</button>
    </form>
  );
}
