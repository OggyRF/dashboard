import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, PartyPopper } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { addDays, formatDayKey, istDateKey, isValidKey } from "@/lib/dates";
import { dayBoard, myDay, planningOptions } from "@/services/daily";
import { DailyLine } from "./daily-line";
import { DailyPlanner } from "./planner";

export const metadata: Metadata = { title: "Daily task" };

export default async function DailyPage({ searchParams }: PageProps<"/daily">) {
  const user = await requireUser();
  const own = can(user.role, "daily.own");
  const assign = can(user.role, "daily.assign");
  if (!own && !assign) notFound();
  const sp = await searchParams;
  const today = istDateKey(new Date());
  const date = typeof sp.date === "string" && isValidKey(sp.date) ? sp.date : today;
  const [mine, board, options] = await Promise.all([
    own ? myDay(user, date) : null,
    assign ? dayBoard(user, date) : null,
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

      {board && options && <DailyPlanner date={date} board={board} options={options} />}
    </div>
  );
}
