import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { requirePermission } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { addDays, formatDayKey, formatMinutes, istDateKey, isValidKey } from "@/lib/dates";
import { workNotes } from "@/services/attendance";
import { AttendanceTabs } from "../tabs";

export const metadata: Metadata = { title: "Work notes" };

// What each person wrote about their work on a day, written at Log out.
export default async function WorkNotesPage({ searchParams }: PageProps<"/attendance/notes">) {
  const actor = await requirePermission("attendance.viewAll");
  const sp = await searchParams;
  const today = istDateKey(new Date());
  const date = typeof sp.date === "string" && isValidKey(sp.date) && sp.date <= today ? sp.date : today;
  const rows = await workNotes(actor, date);
  const present = rows.filter((r) => r.present || r.note);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="page-title">Attendance</h1>
      <AttendanceTabs active="/attendance/notes" owner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">{formatDayKey(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <div className="flex items-center gap-2">
          <Link href={`?date=${addDays(date, -1)}`} className="btn-secondary px-3 py-1" aria-label="Previous day">‹</Link>
          {date !== today && <Link href="/attendance/notes" className="btn-secondary py-1">Today</Link>}
          {date < today && <Link href={`?date=${addDays(date, 1)}`} className="btn-secondary px-3 py-1" aria-label="Next day">›</Link>}
        </div>
      </div>
      {present.length === 0 ? (
        <div className="card text-sm text-muted">Nobody worked on this day.</div>
      ) : (
        <ul className="space-y-3">
          {present.map((r) => (
            <li key={r.person.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold">
                  <Avatar person={r.person} size="sm" />
                  {r.person.name}
                  <span className="text-xs font-normal text-muted">{ROLE_LABELS[r.person.role]}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  {r.present && <span>Worked {formatMinutes(r.workedMinutes)}</span>}
                  {r.dayId && <Link href={`/attendance/days/${r.dayId}`} className="font-semibold text-brand hover:underline">Day details</Link>}
                </span>
              </div>
              <p className={`mt-2 text-sm whitespace-pre-wrap ${r.note ? "" : "text-warning"}`}>{r.note ?? "No note yet (still working, or the timer stopped without a Log out)."}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
