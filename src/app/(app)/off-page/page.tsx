import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProgressBar } from "@/components/progress-bar";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { formatMonth } from "@/lib/dates";
import { WEEK_RANGES, myWeek, teamOverview } from "@/services/offpage";
import { MyWeek } from "./my-week";

export const metadata: Metadata = { title: "Off-page" };

export default async function OffpagePage() {
  const user = await requirePermission("offpage.tick");
  const [mine, team] = await Promise.all([myWeek(user), can(user.role, "offpage.review") ? teamOverview(user) : Promise.resolve(null)]);
  const showMine = mine.groups.length > 0 || !team;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="page-title">Off-page</h1>
        <p className="text-sm text-muted">{formatMonth(mine.month)}, week {mine.week} (days {WEEK_RANGES[mine.week]}).</p>
      </div>

      {showMine && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-bold">My work this week</h2>
            {mine.progress.planned > 0 && (
              <div className="w-64"><ProgressBar label="This week" done={mine.progress.done} planned={mine.progress.planned} /></div>
            )}
          </div>
          {mine.leftOver > 0 && (
            <p className="flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" />{mine.leftOver} item{mine.leftOver === 1 ? "" : "s"} from earlier weeks still open (red edge).
            </p>
          )}
          {mine.groups.length === 0 ? (
            <div className="card text-sm text-muted">Nothing assigned to you this week.</div>
          ) : (
            <MyWeek groups={mine.groups} />
          )}
        </section>
      )}

      {team && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">All clients this month</h2>
          {team.clients.length === 0 ? (
            <div className="card text-sm text-muted">No client has an off-page plan yet. Open a client and use its Off-page tab to set one.</div>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-background/60 text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Client</th>
                    {[1, 2, 3, 4].map((w) => (
                      <th key={w} className={`min-w-28 px-3 py-3 font-semibold ${w === team.week ? "text-brand" : ""}`}>Week {w}</th>
                    ))}
                    <th className="min-w-28 px-4 py-3 font-semibold">Month</th>
                  </tr>
                </thead>
                <tbody>
                  {team.clients.map((c) => (
                    <tr key={c.client.id} className={`border-b border-border last:border-0 ${c.behind.length ? "bg-danger/[0.03]" : ""}`}>
                      <td className="px-4 py-3">
                        <Link href={`/clients/${c.client.id}/off-page`} className="font-semibold hover:text-brand">{c.client.name}</Link>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          {c.client.executionOwner && <><Avatar person={c.client.executionOwner} size="xs" />{c.client.executionOwner.name.split(" ")[0]}</>}
                          {c.behind.length > 0 && (
                            <span className="chip bg-danger/10 text-danger"><AlertTriangle className="h-3 w-3" />Behind: {c.behind.map((b) => `wk ${b.week} −${b.missing}`).join(", ")}</span>
                          )}
                        </div>
                      </td>
                      {c.weeks.map((w) => (
                        <td key={w.week} className="px-3 py-3">
                          <ProgressBar label="" done={w.done} planned={w.planned} short={w.week < team.week} size="sm" />
                        </td>
                      ))}
                      <td className="px-4 py-3"><ProgressBar label="" done={c.month.done} planned={c.month.planned} size="sm" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">A client is flagged when a finished week of this month did not reach its plan.</p>
        </section>
      )}
    </div>
  );
}
