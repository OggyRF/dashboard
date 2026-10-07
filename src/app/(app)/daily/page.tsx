import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, PartyPopper } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { addDays, formatDayKey, istDateKey, isValidKey } from "@/lib/dates";
import { LeadCard, PersonCard } from "@/components/team-cards";
import { myDay, planningOptions } from "@/services/daily";
import { teamBoard } from "@/services/team";
import { DailyLine } from "./daily-line";
import { AddDailyTask } from "./planner";

export const metadata: Metadata = { title: "Daily task" };

export default async function DailyPage({ searchParams }: PageProps<"/daily">) {
  const user = await requireUser();
  const own = can(user.role, "daily.own");
  const assign = can(user.role, "daily.assign");
  if (!own && !assign) notFound();
  const sp = await searchParams;
  const today = istDateKey(new Date());
  const date = typeof sp.date === "string" && isValidKey(sp.date) ? sp.date : today;
  const lead = can(user.role, "team.overview");
  const [mine, board, options] = await Promise.all([
    own ? myDay(user, date) : null,
    lead ? teamBoard(user, date) : null,
    assign ? planningOptions(user) : null,
  ]);
  const label = formatDayKey(date, { weekday: "long", day: "numeric", month: "long" });
  const firstName = user.name.split(" ")[0];
  const when = date === today ? "today" : date < today ? `on ${label}` : `for ${label}`;
  const showMine = mine && (mine.clients.length > 0 || !assign);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Daily task</h1>
          <p className="mt-1 text-base">
            Hey <span className="font-semibold">{firstName}</span>, {showMine ? <>here is your list {when}.</> : <>here is the team&apos;s list {when}.</>}
          </p>
          <p className="text-sm text-muted">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`?date=${addDays(date, -1)}`} className="btn-secondary px-3 py-1" aria-label="Previous day">‹</Link>
          {date !== today && <Link href="/daily" className="btn-secondary py-1">Today</Link>}
          <Link href={`?date=${addDays(date, 1)}`} className="btn-secondary px-3 py-1" aria-label="Next day">›</Link>
        </div>
      </div>

      {showMine && (
        <section className="space-y-4">
          {mine.progress.planned > 0 && (
            <div className="card flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-48 flex-1"><ProgressBar label={date === today ? "Done today" : "Done this day"} done={mine.progress.done} planned={mine.progress.planned} /></div>
              {mine.progress.done >= mine.progress.planned && (
                <span className="flex items-center gap-2 text-sm font-semibold text-success"><PartyPopper className="h-4 w-4" />All done. Great work!</span>
              )}
            </div>
          )}
          {mine.clients.length === 0 ? (
            <div className="card text-sm text-muted">
              Nothing on your list {when}. {date > today ? "The plan for a day is made on the morning of that day." : "Your off-page plan may be finished, or today is a day off."}
            </div>
          ) : (
            mine.clients.map((g) => (
              <section key={g.client.id} className="card space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link href={`/clients/${g.client.id}/off-page`} className="group flex items-center gap-2 text-lg font-bold hover:text-brand">
                    {g.client.name}
                    <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />
                  </Link>
                  <div className="w-44"><ProgressBar label="" done={g.done} planned={g.planned} size="sm" /></div>
                </div>
                <div className="space-y-3">
                  {g.lines.map((l) => <DailyLine key={l.id} line={l} canWork={date <= today} />)}
                </div>
              </section>
            ))
          )}
          <p className="text-xs text-muted">
            Start a piece with Mark working and finish it with Mark completed. Uploads ask for the live link and tick the client&apos;s off-page checklist by themselves.
          </p>
        </section>
      )}

      {board && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-6">
            <div>
              <h2 className="text-xl font-bold">Team today</h2>
              <p className="text-sm text-muted">Click a name to see everything about their work: daily list, off-page, tasks, clients and attendance.</p>
            </div>
            <div className="w-64"><ProgressBar label="Everyone's daily lists" done={board.everyone.done} planned={board.everyone.planned} /></div>
          </div>
          {options && <AddDailyTask date={date} options={options} />}

          {board.leads.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold tracking-wide text-muted uppercase">Strategists and managers</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {board.leads.map((l) => <LeadCard key={l.person.id} lead={l} date={date === today ? undefined : date} />)}
              </div>
            </div>
          )}

          {board.teams.map((t) => (
            <div key={t.lead.id} className={`space-y-3 rounded-3xl p-3 sm:p-4 ${t.mine ? "bg-brand/[0.04] ring-1 ring-brand/20" : "bg-surface/60 ring-1 ring-border/70"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <h3 className="flex items-center gap-2 text-lg font-bold">
                  {t.lead.name.split(" ")[0]}&apos;s team
                  {t.mine && <span className="chip bg-brand/10 text-brand">Your team</span>}
                  <span className="text-sm font-normal text-muted">{t.members.length} {t.members.length === 1 ? "person" : "people"}</span>
                </h3>
                <div className="w-56"><ProgressBar label="Team" done={t.total.done} planned={t.total.planned} size="sm" /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {t.members.map((p) => <PersonCard key={p.id} person={p} inTeam={t.lead.id} date={date === today ? undefined : date} />)}
              </div>
            </div>
          ))}

          {board.others.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold tracking-wide text-muted uppercase">Not in a manager&apos;s team yet</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {board.others.map((p) => <PersonCard key={p.id} person={p} date={date === today ? undefined : date} />)}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
