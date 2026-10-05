import type { Metadata } from "next";
import { AttendanceControl } from "@/components/attendance-control";
import { AttendanceSheet } from "@/components/attendance-sheet";
import { MonthNav } from "@/components/month-nav";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { istDateKey, isValidMonth } from "@/lib/dates";
import { getToday, monthSheet } from "@/services/attendance";
import { AttendanceTabs } from "./tabs";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requirePermission("attendance.own");
  const todayKey = istDateKey(new Date());
  const requested = String((await searchParams).month ?? "");
  const month = isValidMonth(requested) ? requested : todayKey.slice(0, 7);
  const [today, sheet] = await Promise.all([getToday(user), monthSheet(user, user.id, month)]);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <AttendanceTabs active="/attendance" owner={can(user.role, "attendance.viewAll")} />
      <section className="card">
        <h2 className="mb-4 font-semibold">Today</h2>
        <AttendanceControl key={today.asOf} initial={today} size="large" />
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">My record</h2>
          <MonthNav month={month} />
        </div>
        <p className="text-sm text-muted">Your record is read-only. If something is wrong, message the owners.</p>
        <AttendanceSheet rows={sheet.rows} totals={sheet.totals} todayKey={todayKey} />
      </section>
    </div>
  );
}
