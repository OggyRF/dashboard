import type { Metadata } from "next";
import { MonthNav } from "@/components/month-nav";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { WEEKLY_OFF_DAYS, formatDayKey, istDateKey, isValidMonth, keyFromDbDate } from "@/lib/dates";
import { LEAVE_TYPE_LABELS, leaveCalendar, myLeave, pendingLeave, recentDecisions } from "@/services/leave";
import { ApplyForLeave, CancelLeave, DecideLeave } from "./leave-forms";

export const metadata: Metadata = { title: "Leave" };

const STATUS_STYLE = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-success/10 text-success",
  REJECTED: "bg-danger/10 text-danger",
  CANCELLED: "bg-background text-muted",
} as const;

function range(r: { fromDate: Date; toDate: Date; halfDay: boolean }) {
  const from = keyFromDbDate(r.fromDate);
  const to = keyFromDbDate(r.toDate);
  return from === to ? `${formatDayKey(from)}${r.halfDay ? " (half day)" : ""}` : `${formatDayKey(from)} – ${formatDayKey(to)}`;
}

export default async function LeavePage({ searchParams }: PageProps<"/leave">) {
  const user = await requirePermission("leave.apply");
  const todayKey = istDateKey(new Date());
  const requested = String((await searchParams).month ?? "");
  const month = isValidMonth(requested) ? requested : todayKey.slice(0, 7);
  const owner = can(user.role, "leave.approve");

  const [calendar, mine, pending, decided] = await Promise.all([
    leaveCalendar(user, month),
    myLeave(user),
    owner ? pendingLeave(user) : Promise.resolve([]),
    owner ? recentDecisions(user) : Promise.resolve([]),
  ]);
  const calendarProps = { month, todayKey, entries: calendar.entries, holidays: calendar.holidays, weeklyOff: WEEKLY_OFF_DAYS };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Leave</h1>
        <MonthNav month={month} />
      </div>

      {owner && (
        <section className="card p-0">
          <h2 className="border-b border-border px-4 py-3 font-semibold">Waiting for approval ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">Nothing waiting.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((r) => (
                <li key={r.id} className="space-y-2 px-4 py-3">
                  <div className="text-sm">
                    <span className="font-medium">{r.user.name}</span> · {LEAVE_TYPE_LABELS[r.type]} · {range(r)} ·{" "}
                    <span className="text-muted">{Number(r.days)} working day{Number(r.days) === 1 ? "" : "s"}</span>
                    <div className="text-muted">“{r.reason}”</div>
                  </div>
                  {r.userId === user.id ? <p className="text-xs text-muted">Your own request: the other owner decides it.</p> : <DecideLeave id={r.id} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {owner && <p className="text-sm text-muted">The calendar shows everyone&apos;s leave. Owners can also apply below.</p>}
      <ApplyForLeave calendar={calendarProps} />

      <section className="card p-0">
        <h2 className="border-b border-border px-4 py-3 font-semibold">My requests</h2>
        <RequestTable rows={mine} showCancel />
      </section>

      {owner && decided.length > 0 && (
        <section className="card p-0">
          <h2 className="border-b border-border px-4 py-3 font-semibold">Recently decided</h2>
          <RequestTable rows={decided} showName />
        </section>
      )}
    </div>
  );
}

type Row = Awaited<ReturnType<typeof myLeave>>[number];

function RequestTable({ rows, showCancel, showName }: { rows: Row[]; showCancel?: boolean; showName?: boolean }) {
  if (!rows.length) return <p className="px-4 py-4 text-sm text-muted">No requests yet.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border last:border-0">
            {showName && <td className="px-4 py-2 font-medium">{r.user.name}</td>}
            <td className="px-4 py-2">{range(r)}</td>
            <td className="px-4 py-2">{LEAVE_TYPE_LABELS[r.type]}</td>
            <td className="px-4 py-2 tabular-nums">{Number(r.days)} d</td>
            <td className="px-4 py-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span>
              {r.decidedBy && <span className="ml-2 text-xs text-muted">by {r.decidedBy.name}{r.decisionNote ? `: “${r.decisionNote}”` : ""}</span>}
            </td>
            <td className="px-4 py-2 text-right">{showCancel && r.status === "PENDING" && <CancelLeave id={r.id} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
