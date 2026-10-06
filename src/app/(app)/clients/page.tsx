import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Plus, Search, Upload } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { listClients } from "@/services/clients";
import { StatusChip, TypeChip } from "./badges";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const user = await requirePermission("clients.viewAssigned");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const filters = { q: one(sp.q), type: one(sp.type) as "SEO" | undefined, status: one(sp.status) as "ALL" | undefined };
  const clients = await listClients(user, filters);
  const canAdd = can(user.role, "clients.edit");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="text-sm text-muted">
            {can(user.role, "clients.viewAll") ? "Every client of the agency." : "The clients you work on."} {clients.length} shown.
          </p>
        </div>
        {canAdd && (
          <div className="flex gap-2">
            <Link href="/clients/import" className="btn-secondary"><Upload className="h-4 w-4" />Add many</Link>
            <Link href="/clients/new" className="btn-primary"><Plus className="h-4 w-4" />Add client</Link>
          </div>
        )}
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="label">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input id="q" name="q" defaultValue={filters.q} placeholder="Name or website" className="field pl-9" />
          </div>
        </div>
        <div>
          <label htmlFor="type" className="label">Service</label>
          <select id="type" name="type" defaultValue={filters.type ?? ""} className="field">
            <option value="">All</option>
            <option value="SEO">SEO</option>
            <option value="GMB">GMB</option>
          </select>
        </div>
        <div>
          <label htmlFor="status" className="label">Status</label>
          <select id="status" name="status" defaultValue={filters.status ?? ""} className="field">
            <option value="">Current (not churned)</option>
            <option value="ONBOARDING">Onboarding</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="CHURNED">Churned</option>
            <option value="ALL">All</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>

      {clients.length === 0 ? (
        <div className="card text-center">
          <p className="font-semibold">No clients here yet.</p>
          {canAdd && <p className="mt-1 text-sm text-muted">Use Add client for one, or Add many to paste your list from a spreadsheet.</p>}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="card block h-full p-5 transition hover:-translate-y-0.5 hover:border-brand/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold">{c.name}</div>
                    <div className="truncate text-xs text-muted">{c.website?.replace(/^https?:\/\//, "") ?? "No website"}</div>
                  </div>
                  <StatusChip status={c.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <TypeChip type={c.type} />
                  {c.overdueTasks > 0 && (
                    <span className="chip bg-danger/10 text-danger"><AlertTriangle className="h-3 w-3" />{c.overdueTasks} overdue</span>
                  )}
                  <span className="text-xs text-muted">{c.openTasks} open task{c.openTasks === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs text-muted">
                  <Owner label="Strategist" person={c.strategicOwner} />
                  <Owner label="Project manager" person={c.executionOwner} />
                  <Owner label="Off-page" person={c.offpageOwner} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Owner({ label, person }: { label: string; person: { id: string; name: string; avatarUpdatedAt: Date | null } | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {person ? <Avatar person={person} size="xs" /> : <span className="h-6 w-6 rounded-full border border-dashed border-border" />}
      <span className="truncate">
        <span className="block text-[10px] tracking-wide uppercase">{label}</span>
        <span className="font-medium text-foreground">{person?.name.split(" ")[0] ?? "–"}</span>
      </span>
    </span>
  );
}
