import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { STATE_LABELS } from "@/lib/attendance/compute";
import { formatMinutes, istDateKey, istTimeOfDay } from "@/lib/dates";
import { teamToday } from "@/services/attendance";
import { AttendanceTabs } from "../tabs";

export const metadata: Metadata = { title: "Team attendance" };

const BADGE = {
  WORKING: "bg-success/10 text-success",
  ON_BREAK: "bg-amber-100 text-amber-800",
  LOGGED_OUT: "bg-background text-muted",
  NOT_STARTED: "bg-background text-muted",
} as const;

export default async function TeamAttendancePage() {
  const actor = await requirePermission("attendance.viewAll");
  const team = await teamToday(actor);
  const month = istDateKey(new Date()).slice(0, 7);
  const counts = {
    working: team.filter((m) => m.summary.state === "WORKING").length,
    onBreak: team.filter((m) => m.summary.state === "ON_BREAK").length,
    notIn: team.filter((m) => m.summary.state === "NOT_STARTED" && !m.onLeave).length,
    onLeave: team.filter((m) => m.onLeave).length,
  };

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <AttendanceTabs active="/attendance/team" owner />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Working now" value={counts.working} />
        <Count label="On break" value={counts.onBreak} />
        <Count label="Not logged in yet" value={counts.notIn} />
        <Count label="On leave today" value={counts.onLeave} />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Logged in</th>
              <th className="px-4 py-3 font-medium">Breaks</th>
              <th className="px-4 py-3 font-medium">Worked so far</th>
              <th className="px-4 py-3 font-medium">Logged out</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.userId} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted">{ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]}</div>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[m.summary.state]}`}>
                    {m.onLeave && m.summary.state === "NOT_STARTED" ? "On leave" : STATE_LABELS[m.summary.state]}
                  </span>
                </td>
                <td className="px-4 py-2 tabular-nums">{m.summary.firstLoginAt ? istTimeOfDay(m.summary.firstLoginAt) : "–"}</td>
                <td className="px-4 py-2 tabular-nums">{m.summary.firstLoginAt ? `${formatMinutes(m.summary.breakMinutes)} (${m.summary.breakCount})` : ""}</td>
                <td className="px-4 py-2 font-medium tabular-nums">{m.summary.firstLoginAt ? formatMinutes(m.summary.workedMinutes) : ""}</td>
                <td className="px-4 py-2 tabular-nums">{m.summary.state === "LOGGED_OUT" && m.summary.lastLogoutAt ? istTimeOfDay(m.summary.lastLogoutAt) : ""}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/attendance/people/${m.userId}?month=${month}`} className="text-brand hover:underline">Monthly sheet</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
