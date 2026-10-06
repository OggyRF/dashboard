import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProgressBar } from "@/components/progress-bar";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { formatMonth } from "@/lib/dates";
import { WEEK_RANGES, teamOverview } from "@/services/offpage";

export const metadata: Metadata = { title: "Off-page" };

// Every client's off-page month at a glance, one row per client. Clicking a
// client opens its checklist, where the boxes are ticked.
export default async function OffpagePage() {
  const user = await requirePermission("offpage.tick");
  const team = await teamOverview(user);
  const lead = can(user.role, "offpage.plan");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="page-title">Off-page</h1>
        <p className="text-sm text-muted">{formatMonth(team.month)}, week {team.week} (days {WEEK_RANGES[team.week]}). Click a client to open its checklist and tick work off.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{lead ? "All clients this month" : "My clients this month"}</h2>
        {team.clients.length === 0 ? (
          <div className="card text-sm text-muted">
            {lead ? "No client has an off-page plan yet. Open a client and use its Off-page tab to set one." : "None of your clients has an off-page plan this month yet."}
          </div>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden p-0">
            <li className="hidden grid-cols-[minmax(14rem,1.4fr)_repeat(4,minmax(0,1fr))_minmax(0,1fr)_1.5rem] gap-4 bg-background/60 px-4 py-3 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
              <span>Client</span>
              {[1, 2, 3, 4].map((w) => <span key={w} className={w === team.week ? "text-brand" : ""}>Week {w}</span>)}
              <span>Month</span>
              <span />
            </li>
            {team.clients.map((c) => (
              <li key={c.client.id}>
                <Link
                  href={`/clients/${c.client.id}/off-page`}
                  className={`grid items-center gap-x-4 gap-y-2 px-4 py-3.5 transition hover:bg-brand/[0.04] md:grid-cols-[minmax(14rem,1.4fr)_repeat(4,minmax(0,1fr))_minmax(0,1fr)_1.5rem] ${c.behind.length ? "bg-danger/[0.03]" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{c.client.name}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted md:hidden" />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {c.client.offpageOwner && <><Avatar person={c.client.offpageOwner} size="xs" />{c.client.offpageOwner.name.split(" ")[0]}</>}
                      {c.openForMe > 0 && <span className="chip bg-brand/10 text-brand">{c.openForMe} left for you</span>}
                      {c.behind.length > 0 && (
                        <span className="chip bg-danger/10 text-danger"><AlertTriangle className="h-3 w-3" />Behind: {c.behind.map((b) => `wk ${b.week} −${b.missing}`).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  {c.weeks.map((w) => (
                    <div key={w.week} className="hidden md:block">
                      <ProgressBar label="" done={w.done} planned={w.planned} short={w.week < team.week} size="sm" />
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3 md:hidden">
                    <ProgressBar label={`Week ${team.week}`} done={c.thisWeek.done} planned={c.thisWeek.planned} size="sm" />
                    <ProgressBar label="Month" done={c.month.done} planned={c.month.planned} size="sm" />
                  </div>
                  <div className="hidden md:block"><ProgressBar label="" done={c.month.done} planned={c.month.planned} size="sm" /></div>
                  <ChevronRight className="hidden h-4 w-4 text-muted md:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">A client is flagged when a finished week of this month did not reach its plan. Your day-by-day share is on the Daily task page.</p>
      </section>
    </div>
  );
}
