import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Briefcase, CalendarDays, Clock, ListChecks, Mail, Target } from "lucide-react";
import { AttendanceSheet } from "@/components/attendance-sheet";
import { Avatar } from "@/components/avatar";
import { MonthNav } from "@/components/month-nav";
import { ProgressBar } from "@/components/progress-bar";
import { TaskTable } from "@/components/task-bits";
import { Presence } from "@/components/team-cards";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { addDays, formatDayKey, formatMinutes, formatMonth, istDateKey, isValidKey, isValidMonth } from "@/lib/dates";
import { monthSheet, teamToday } from "@/services/attendance";
import { personDay } from "@/services/daily";
import { LEAVE_TYPE_LABELS } from "@/services/leave";
import { openTasksOf } from "@/services/tasks";
import { personProfile } from "@/services/team";
import { LeadLine } from "../../daily/daily-line";

export const metadata: Metadata = { title: "Team member" };

const possessive = (name: string) => `${name.split(" ")[0]}${name.split(" ")[0]!.endsWith("s") ? "'" : "'s"}`;

// Everything about one person's work, for owners and team leads: today's
// list, off-page month, tasks, clients, leave and attendance.
export default async function PersonPage({ params, searchParams }: PageProps<"/people/[userId]">) {
  const actor = await requireUser();
  const { userId } = await params;
  if (actor.id !== userId && !can(actor.role, "team.overview")) notFound();
  const sp = await searchParams;
  const now = new Date();
  const todayKey = istDateKey(now);
  const date = typeof sp.date === "string" && isValidKey(sp.date) ? sp.date : todayKey;
  const month = typeof sp.month === "string" && isValidMonth(sp.month) ? sp.month : todayKey.slice(0, 7);

  const profile = await personProfile(actor, userId, now).catch(() => null);
  if (!profile) notFound();
  const { person } = profile;
  const isOwner = person.role === "OWNER";
  const [day, tasks, sheet, presence] = await Promise.all([
    isOwner ? null : personDay(actor, userId, date, now),
    openTasksOf(actor, userId, now),
    isOwner ? null : monthSheet(actor, userId, month, now),
    isOwner ? [] : teamToday(actor, now),
  ]);
  const today = presence.find((p) => p.userId === userId);
  const attendance = today ? { state: today.summary.state, workedMinutes: today.summary.workedMinutes, onLeave: today.onLeave } : null;
  const overdue = tasks.filter((t) => t.overdue).length;
  const name = possessive(person.name);
  const dayLabel = date === todayKey ? "Today" : formatDayKey(date, { weekday: "long", day: "numeric", month: "short" });
  const canRemove = can(actor.role, "daily.assign");
  const backTo = can(actor.role, "team.overview") ? "/daily" : "/";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href={backTo} className="text-sm text-muted hover:text-brand">← Team today</Link>

      {/* Header */}
      <section className="card relative overflow-hidden p-5 sm:p-6">
        <div className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
        <div className="flex flex-wrap items-center gap-5">
          <Avatar person={person} size="xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="page-title">{name} work</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="chip bg-background font-semibold text-foreground">{profile.leads?.label ?? ROLE_LABELS[person.role]}</span>
              <Presence attendance={attendance} />
              <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{person.email}</span>
            </div>
            {profile.teams.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted">In</span>
                {profile.teams.map((t) => (
                  <Link key={t.id} href={`/people/${t.id}`} className="chip bg-brand/10 text-brand hover:bg-brand/20">{possessive(t.name)} team</Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<ListChecks className="h-4 w-4" />} label={`${dayLabel}'s list`} value={day ? `${day.progress.done}/${day.progress.planned}` : "–"} bar={day?.progress} />
        <Stat icon={<Target className="h-4 w-4" />} label={`Off-page, ${formatMonth(profile.month).split(" ")[0]}`} value={`${profile.offpageTotal.done}/${profile.offpageTotal.planned}`} bar={profile.offpageTotal} />
        <Stat
          icon={<Briefcase className="h-4 w-4" />}
          label="Open tasks"
          value={String(tasks.length)}
          note={overdue ? <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle className="h-3 w-3" />{overdue} overdue</span> : "None overdue"}
        />
        <Stat
          icon={<Clock className="h-4 w-4" />}
          label={`Hours, ${formatMonth(month).split(" ")[0]}`}
          value={sheet ? formatMinutes(sheet.totals.workedMinutes) : "–"}
          note={sheet ? `${sheet.totals.daysPresent} day${sheet.totals.daysPresent === 1 ? "" : "s"} present` : "Owners do not clock in"}
        />
      </section>

      {/* What a lead oversees */}
      {profile.leads && (
        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-bold">What {person.name.split(" ")[0]} oversees</h2>
          <div className="flex flex-wrap gap-2">
            {profile.leads.members.map((m) => (
              <Link key={m.id} href={`/people/${m.id}`} className="flex items-center gap-2 rounded-full bg-background py-1 pr-3 pl-1 text-sm font-medium ring-1 ring-border hover:ring-brand/40">
                <Avatar person={m} size="xs" />{m.name}
              </Link>
            ))}
            {profile.leads.members.length === 0 && <p className="text-sm text-muted">Nobody on their clients yet.</p>}
          </div>
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {profile.leads.clients.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/clients/${c.id}`} className="truncate font-semibold hover:text-brand">{c.name}</Link>
                  <span className="shrink-0 text-xs text-muted">{c.manager ? "Project manager" : "Strategist"}</span>
                </div>
                <ProgressBar done={c.offpage.done} planned={c.offpage.planned} size="sm" />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Bars show each client&apos;s off-page checklist this month.</p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Daily list */}
          {day && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">{dayLabel === "Today" ? "Today's list" : `List for ${dayLabel}`}</h2>
                <div className="flex items-center gap-2">
                  <Link href={`?date=${addDays(date, -1)}`} className="btn-secondary px-3 py-1" aria-label="Previous day">‹</Link>
                  {date !== todayKey && <Link href="?" className="btn-secondary py-1">Today</Link>}
                  <Link href={`?date=${addDays(date, 1)}`} className="btn-secondary px-3 py-1" aria-label="Next day">›</Link>
                </div>
              </div>
              {day.clients.length === 0 ? (
                <div className="card text-sm text-muted">Nothing on the list for this day.</div>
              ) : (
                day.clients.map((g) => (
                  <div key={g.client.id} className="card space-y-3 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/clients/${g.client.id}/off-page`} className="font-bold hover:text-brand">{g.client.name}</Link>
                      <span className="text-xs text-muted tabular-nums">{g.done}/{g.planned} done</span>
                    </div>
                    {g.lines.map((l) => <LeadLine key={l.id} line={l} canRemove={canRemove && actor.id !== userId} />)}
                  </div>
                ))
              )}
            </section>
          )}

          {/* Tasks */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold">Open tasks</h2>
            <TaskTable tasks={tasks} empty="No open tasks." />
          </section>
        </div>

        <div className="space-y-6">
          <section className="card space-y-3 p-5">
            <h2 className="font-bold">Clients ({profile.clients.length})</h2>
            {profile.clients.length === 0 ? (
              <p className="text-sm text-muted">Not on any client yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {profile.clients.map((c) => (
                  <li key={c.client.id} className="leading-tight">
                    <Link href={`/clients/${c.client.id}`} className="font-medium hover:text-brand">{c.client.name}</Link>
                    <div className="text-xs text-muted">{c.roles.join(", ")}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="font-bold">Off-page this month</h2>
            {profile.offpage.length === 0 ? (
              <p className="text-sm text-muted">No off-page work assigned this month.</p>
            ) : (
              profile.offpage.map((g) => (
                <div key={g.client.id} className="space-y-2">
                  <Link href={`/clients/${g.client.id}/off-page`} className="flex justify-between gap-2 text-sm font-semibold hover:text-brand">
                    <span className="truncate">{g.client.name}</span>
                    <span className="shrink-0 tabular-nums text-muted">{g.total.done}/{g.total.planned}</span>
                  </Link>
                  {g.activities.map((a) => (
                    <div key={a.name} className="grid grid-cols-[1fr_5rem] items-center gap-2 text-xs">
                      <span className="truncate text-muted">{a.name} · {a.done}/{a.planned}</span>
                      <ProgressBar done={a.done} planned={a.planned} size="sm" />
                    </div>
                  ))}
                </div>
              ))
            )}
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-bold"><CalendarDays className="h-4 w-4 text-brand" />Upcoming leave</h2>
            {profile.leave.length === 0 ? (
              <p className="text-sm text-muted">None planned.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {profile.leave.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span>{l.from === l.to ? `${formatDayKey(l.from)}${l.halfDay ? " (half)" : ""}` : `${formatDayKey(l.from)} – ${formatDayKey(l.to)}`}</span>
                    <span className={`chip ${l.status === "APPROVED" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{LEAVE_TYPE_LABELS[l.type]} · {l.status === "APPROVED" ? "Approved" : "Waiting"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Attendance */}
      {sheet && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Attendance and login hours</h2>
            <MonthNav month={month} params={date !== todayKey ? { date } : {}} />
          </div>
          <AttendanceSheet rows={sheet.rows} totals={sheet.totals} todayKey={todayKey} correctFor={can(actor.role, "attendance.correct") ? userId : undefined} showDetails={can(actor.role, "attendance.viewAll") || actor.id === userId} />
        </section>
      )}
    </div>
  );
}

function Stat({ icon, label, value, note, bar }: { icon: React.ReactNode; label: string; value: string; note?: React.ReactNode; bar?: { done: number; planned: number } }) {
  return (
    <div className="card space-y-2 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/10 text-brand">{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {bar && <ProgressBar done={bar.done} planned={bar.planned} size="sm" />}
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}
