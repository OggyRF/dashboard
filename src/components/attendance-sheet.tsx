import Link from "next/link";
import { STATE_LABELS } from "@/lib/attendance/compute";
import { WEEKLY_OFF_DAYS, formatDayKey, formatMinutes, istTimeOfDay, weekday } from "@/lib/dates";
import type { SheetRow } from "@/services/attendance";
import { openDayAction } from "@/server/actions/attendance";

type Props = {
  rows: SheetRow[];
  totals: { daysPresent: number; workedMinutes: number; breakMinutes: number };
  todayKey: string;
  // Owners can open any day, including days with no record, to correct it.
  correctFor?: string;
};

export function AttendanceSheet({ rows, totals, todayKey, correctFor }: Props) {
  const visible = rows.filter((r) => r.key <= todayKey);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
        <Total label="Days present" value={String(totals.daysPresent)} />
        <Total label="Worked" value={formatMinutes(totals.workedMinutes)} />
        <Total label="Breaks" value={formatMinutes(totals.breakMinutes)} />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/60 text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Logged in</th>
              <th className="px-4 py-3 font-semibold">Logged out</th>
              <th className="px-4 py-3 font-semibold">Breaks</th>
              <th className="px-4 py-3 font-semibold">Worked</th>
              <th className="px-4 py-3 font-semibold">Notes</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No days yet this month.</td></tr>
            )}
            {[...visible].reverse().map((r) => {
              const s = r.summary;
              const off = WEEKLY_OFF_DAYS.includes(weekday(r.key));
              return (
                <tr key={r.key} className={`border-b border-border last:border-0 transition hover:bg-background/60 ${off ? "text-muted" : ""}`}>
                  <td className="whitespace-nowrap px-4 py-2">{formatDayKey(r.key)}</td>
                  <td className="px-4 py-2 tabular-nums">{s?.firstLoginAt ? istTimeOfDay(s.firstLoginAt) : off ? "Weekly off" : "–"}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {s?.state === "LOGGED_OUT" && s.lastLogoutAt ? istTimeOfDay(s.lastLogoutAt) : s && s.firstLoginAt ? STATE_LABELS[s.state] : "–"}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{s?.firstLoginAt ? `${formatMinutes(s.breakMinutes)} (${s.breakCount})` : ""}</td>
                  <td className="px-4 py-2 font-medium tabular-nums">{s?.firstLoginAt ? formatMinutes(s.workedMinutes) : ""}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.autoClosed && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">No logout, closed automatically</span>}
                    {r.corrected && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">Corrected by owner</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.dayId ? (
                      <Link href={`/attendance/days/${r.dayId}`} className="text-brand hover:underline">Details</Link>
                    ) : correctFor ? (
                      <form action={openDayAction}>
                        <input type="hidden" name="userId" value={correctFor} />
                        <input type="hidden" name="key" value={r.key} />
                        <button type="submit" className="text-brand hover:underline">Add entries</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
