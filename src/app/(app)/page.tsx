import Link from "next/link";
import { AttendanceControl } from "@/components/attendance-control";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { formatDayKey, formatMinutes, istDateKey, keyFromDbDate } from "@/lib/dates";
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
    <div className="max-w-5xl space-y-6">
      {params.password === "changed" && (
        <p className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-success">Your password was changed.</p>
      )}
      {params.denied === "1" && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">You do not have access to that page.</p>
      )}
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.name.split(" ")[0]}</h1>
        <p className="text-sm text-muted">Signed in as {ROLE_LABELS[user.role]}.</p>
      </div>

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Today</h2>
          <Link href="/attendance" className="text-sm text-brand hover:underline">My attendance</Link>
        </div>
        <AttendanceControl key={today.asOf} initial={today} size="large" />
      </section>

      {owner && (
        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Team right now</h2>
            <Link href="/attendance/team" className="text-sm text-brand hover:underline">Team board</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Working" value={team.filter((m) => m.summary.state === "WORKING").length} />
            <Tile label="On break" value={team.filter((m) => m.summary.state === "ON_BREAK").length} />
            <Tile label="Not logged in" value={team.filter((m) => m.summary.state === "NOT_STARTED" && !m.onLeave).length} />
            <Tile label="On leave" value={team.filter((m) => m.onLeave).length} />
          </div>
          {pending.length > 0 && (
            <p className="mt-4 text-sm">
              <Link href="/leave" className="text-brand hover:underline">
                {pending.length} leave request{pending.length === 1 ? "" : "s"} waiting for approval
              </Link>
            </p>
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">My leave</h2>
            <Link href="/leave" className="text-sm text-brand hover:underline">Apply</Link>
          </div>
          {upcomingLeave.length === 0 ? (
            <p className="text-sm text-muted">No upcoming leave.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {upcomingLeave.slice(0, 4).map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span>{formatDayKey(keyFromDbDate(l.fromDate))}{keyFromDbDate(l.fromDate) !== keyFromDbDate(l.toDate) ? ` – ${formatDayKey(keyFromDbDate(l.toDate))}` : ""} · {LEAVE_TYPE_LABELS[l.type]}</span>
                  <span className={l.status === "APPROVED" ? "text-success" : "text-amber-700"}>{l.status === "APPROVED" ? "Approved" : "Pending"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Messages</h2>
            <Link href="/messages" className="text-sm text-brand hover:underline">Open</Link>
          </div>
          {threads.length === 0 ? (
            <p className="text-sm text-muted">{owner ? "No messages from the team yet." : "Write privately to the owners."}</p>
          ) : (
            <p className="text-sm">
              {unreadThreads.length > 0 ? (
                <Link href="/messages" className="text-brand hover:underline">{unreadThreads.length} unread conversation{unreadThreads.length === 1 ? "" : "s"}</Link>
              ) : (
                <span className="text-muted">All caught up. {threads.length} conversation{threads.length === 1 ? "" : "s"}.</span>
              )}
            </p>
          )}
        </section>
      </div>

      {today.summary.firstLoginAt && (
        <p className="text-sm text-muted">
          Worked today: {formatMinutes(today.summary.workedMinutes)} · breaks {formatMinutes(today.summary.breakMinutes)}.
        </p>
      )}

      <section className="card">
        <h2 className="font-semibold">What is coming</h2>
        <p className="mt-1 text-sm text-muted">These sections appear as each phase is built.</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {upcomingSections.map((i) => (
            <li key={i.href} className="flex justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span>{i.label}</span>
              <span className="text-muted">Phase {i.phase}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
