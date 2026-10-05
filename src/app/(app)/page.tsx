import Link from "next/link";
import { ArrowRight, CalendarDays, Coffee, Mail, Moon, Plane, Sparkles, UserCheck, type LucideIcon } from "lucide-react";
import { AttendanceControl } from "@/components/attendance-control";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { formatDayKey, istDateKey, keyFromDbDate } from "@/lib/dates";
import { NAV_ITEMS } from "@/lib/nav";
import { getToday, teamToday } from "@/services/attendance";
import { LEAVE_TYPE_LABELS, myLeave, pendingLeave } from "@/services/leave";
import { listThreads } from "@/services/messages";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const params = await searchParams;
  const owner = can(user.role, "attendance.viewAll");
  const todayKey = istDateKey(new Date());

  const [today, leave, threads, team, pending] = await Promise.all([
    getToday(user),
    myLeave(user),
    listThreads(user),
    owner ? teamToday(user) : Promise.resolve([]),
    owner ? pendingLeave(user) : Promise.resolve([]),
  ]);

  const upcomingLeave = leave.filter((l) => keyFromDbDate(l.toDate) >= todayKey && (l.status === "APPROVED" || l.status === "PENDING"));
  const unreadThreads = threads.filter((t) => t.unread);
  const upcomingSections = NAV_ITEMS.filter((i) => i.phase > 1 && can(user.role, i.permission));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {params.password === "changed" && (
        <p className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-success">Your password was changed.</p>
      )}
      {params.denied === "1" && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">You do not have access to that page.</p>
      )}
      <section className="brand-gradient relative overflow-hidden rounded-3xl p-7 text-brand-ink shadow-[0_20px_40px_-20px_var(--brand)]">
        <div className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 right-32 h-40 w-40 rounded-full bg-white/10" />
        <p className="text-sm font-medium text-white/80">{greeting()}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{user.name.split(" ")[0]} 👋</h1>
        <p className="mt-2 text-sm text-white/80">Signed in as {ROLE_LABELS[user.role]} · {formatDayKey(todayKey)}</p>
      </section>

      <section className="card">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">Today</h2>
          <CardLink href="/attendance">My attendance</CardLink>
        </div>
        <AttendanceControl key={today.asOf} initial={today} size="large" />
      </section>

      {owner && (
        <section className="card">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-bold">Team right now</h2>
            <CardLink href="/attendance/team">Team board</CardLink>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Working" icon={UserCheck} tone="bg-success/10 text-success" value={team.filter((m) => m.summary.state === "WORKING").length} />
            <Tile label="On break" icon={Coffee} tone="bg-warning/10 text-warning" value={team.filter((m) => m.summary.state === "ON_BREAK").length} />
            <Tile label="Not logged in" icon={Moon} tone="bg-slate-100 text-slate-500" value={team.filter((m) => m.summary.state === "NOT_STARTED" && !m.onLeave).length} />
            <Tile label="On leave" icon={Plane} tone="bg-brand/10 text-brand" value={team.filter((m) => m.onLeave).length} />
          </div>
          {pending.length > 0 && (
            <Link href="/leave" className="mt-5 flex items-center justify-between rounded-xl bg-warning/10 px-4 py-3 text-sm font-semibold text-warning transition hover:bg-warning/15">
              {pending.length} leave request{pending.length === 1 ? "" : "s"} waiting for approval
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold"><IconBadge icon={CalendarDays} />My leave</h2>
            <CardLink href="/leave">Apply</CardLink>
          </div>
          {upcomingLeave.length === 0 ? (
            <p className="text-sm text-muted">No upcoming leave.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {upcomingLeave.slice(0, 4).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>{formatDayKey(keyFromDbDate(l.fromDate))}{keyFromDbDate(l.fromDate) !== keyFromDbDate(l.toDate) ? ` – ${formatDayKey(keyFromDbDate(l.toDate))}` : ""} · {LEAVE_TYPE_LABELS[l.type]}</span>
                  <span className={`chip ${l.status === "APPROVED" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{l.status === "APPROVED" ? "Approved" : "Pending"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold"><IconBadge icon={Mail} />Messages</h2>
            <CardLink href="/messages">Open</CardLink>
          </div>
          {threads.length === 0 ? (
            <p className="text-sm text-muted">{owner ? "No messages from the team yet." : "Write privately to the owners."}</p>
          ) : (
            <p className="text-sm">
              {unreadThreads.length > 0 ? (
                <Link href="/messages" className="font-semibold text-brand hover:underline">{unreadThreads.length} unread conversation{unreadThreads.length === 1 ? "" : "s"}</Link>
              ) : (
                <span className="text-muted">All caught up. {threads.length} conversation{threads.length === 1 ? "" : "s"}.</span>
              )}
            </p>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="flex items-center gap-2 text-lg font-bold"><IconBadge icon={Sparkles} />What is coming</h2>
        <p className="mt-1 text-sm text-muted">These sections appear as each phase is built.</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {upcomingSections.map((i) => (
            <li key={i.href} className="flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-sm">
              <span className="font-semibold">{i.label}</span>
              <span className="chip bg-brand/10 text-brand">Phase {i.phase}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border/70 p-4">
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl leading-none font-extrabold tabular-nums">{value}</div>
        <div className="mt-1 text-xs font-medium text-muted">{label}</div>
      </div>
    </div>
  );
}

function IconBadge({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-sm font-semibold text-brand">
      {children}
      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
