import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { EVENT_LABELS, STATE_LABELS } from "@/lib/attendance/compute";
import { formatDateTime } from "@/lib/time";
import { formatDayKey, formatMinutes, istTimeOfDay } from "@/lib/dates";
import { dayDetail } from "@/services/attendance";
import { CorrectionForms } from "./correction-forms";

export const metadata: Metadata = { title: "Attendance day" };

const SOURCE = { USER: "Button", SYSTEM: "Closed automatically", OWNER: "Added by owner" } as const;

export default async function DayPage({ params }: PageProps<"/attendance/days/[dayId]">) {
  const user = await requireUser();
  const { dayId } = await params;
  const { day, effective, events, summary, corrections } = await dayDetail(user, dayId);
  const canCorrect = can(user.role, "attendance.correct");
  const sourceOf = new Map(events.map((e) => [e.id, e.source]));
  const noteOf = new Map(events.map((e) => [e.id, e.note]));
  const back = canCorrect ? `/attendance/people/${day.user.id}?month=${day.key.slice(0, 7)}` : `/attendance?month=${day.key.slice(0, 7)}`;

  return (
    <div className="max-w-4xl space-y-6">
      <Link href={back} className="text-sm text-muted hover:underline">← Back to monthly sheet</Link>
      <div>
        <h1 className="page-title">{day.user.name}</h1>
        <p className="text-muted">{formatDayKey(day.key, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Status" value={STATE_LABELS[summary.state]} />
        <Stat label="Worked" value={formatMinutes(summary.workedMinutes)} />
        <Stat label={`Breaks (${summary.breakCount})`} value={formatMinutes(summary.breakMinutes)} />
        <Stat label="Logged out" value={summary.state === "LOGGED_OUT" && summary.lastLogoutAt ? istTimeOfDay(summary.lastLogoutAt) : "–"} />
      </div>
      <section className="card p-0">
        <h2 className="border-b border-border px-4 py-3 font-semibold">Entries</h2>
        <table className="w-full text-sm">
          <tbody>
            {effective.length === 0 && <tr><td className="px-4 py-4 text-muted">No entries for this day.</td></tr>}
            {effective.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0 transition hover:bg-background/60">
                <td className="w-24 px-4 py-2 font-medium tabular-nums">{istTimeOfDay(e.at)}</td>
                <td className="px-4 py-2">{EVENT_LABELS[e.type]}</td>
                <td className="px-4 py-2 text-muted">
                  {SOURCE[sourceOf.get(e.id) ?? "USER"]}
                  {noteOf.get(e.id) && <div className="text-xs text-warning">Laptop went quiet (closed, asleep or off)</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {corrections.length > 0 && (
        <section className="card p-0">
          <h2 className="border-b border-border px-4 py-3 font-semibold">Corrections</h2>
          <ul className="divide-y divide-border text-sm">
            {corrections.map((c) => (
              <li key={c.id} className="px-4 py-2">
                <span className="font-medium">{c.correctedByName}</span>{" "}
                {c.kind === "CHANGE_TIME" && <>changed {c.oldAt ? istTimeOfDay(c.oldAt) : ""} to {c.newAt ? istTimeOfDay(c.newAt) : ""}</>}
                {c.kind === "ADD_EVENT" && <>added an entry at {c.newAt ? istTimeOfDay(c.newAt) : ""}</>}
                {c.kind === "REMOVE_EVENT" && <>removed the entry at {c.oldAt ? istTimeOfDay(c.oldAt) : ""}</>}
                <span className="text-muted"> · “{c.reason}” · {formatDateTime(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canCorrect && (
        <CorrectionForms
          dayId={day.id}
          events={effective.map((e) => ({ id: e.id, label: `${istTimeOfDay(e.at)} ${EVENT_LABELS[e.type]}` }))}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
