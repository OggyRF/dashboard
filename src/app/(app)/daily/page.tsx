import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { addDays, formatDayKey, istDateKey, isValidKey } from "@/lib/dates";
import { dayBoard, myDay, planningOptions } from "@/services/daily";
import { DailyCard } from "./daily-card";
import { DailyPlanner } from "./planner";

export const metadata: Metadata = { title: "Daily tasks" };

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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Daily tasks</h1>
          <p className="text-sm text-muted">{date === today ? `Today, ${label}` : label}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`?date=${addDays(date, -1)}`} className="btn-secondary px-3 py-1" aria-label="Previous day">‹</Link>
          {date !== today && <Link href="/daily" className="btn-secondary py-1">Today</Link>}
          <Link href={`?date=${addDays(date, 1)}`} className="btn-secondary px-3 py-1" aria-label="Next day">›</Link>
        </div>
      </div>

      {mine && (mine.tasks.length > 0 || mine.leftOver.length > 0 || !assign) && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-bold">My list</h2>
            {mine.progress.planned > 0 && (
              <div className="w-64"><ProgressBar label={date === today ? "Today" : "This day"} done={mine.progress.done} planned={mine.progress.planned} /></div>
            )}
          </div>
          {mine.leftOver.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-danger"><AlertTriangle className="h-4 w-4" />Still open from earlier days</p>
              {mine.leftOver.map((t) => <DailyCard key={t.id} task={t} canTick showDate />)}
            </div>
          )}
          {mine.tasks.length === 0 ? (
            <div className="card text-sm text-muted">Nothing on your list for this day yet.</div>
          ) : (
            mine.tasks.map((t) => <DailyCard key={t.id} task={t} canTick={date <= today} />)
          )}
          <p className="text-xs text-muted">Tick each piece as you finish it. Uploads need the live link and are ticked in the client&apos;s off-page checklist too.</p>
        </section>
      )}

      {board && options && <DailyPlanner date={date} board={board} options={options} />}
    </div>
  );
}
