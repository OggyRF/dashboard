import type { Metadata } from "next";
import Link from "next/link";
import { AttendanceSheet } from "@/components/attendance-sheet";
import { MonthNav } from "@/components/month-nav";
import { requirePermission } from "@/lib/auth/current-user";
import { istDateKey, isValidMonth } from "@/lib/dates";
import { monthSheet } from "@/services/attendance";
import { AttendanceTabs } from "../../tabs";

export const metadata: Metadata = { title: "Monthly sheet" };

export default async function PersonSheetPage({ params, searchParams }: PageProps<"/attendance/people/[userId]">) {
  const actor = await requirePermission("attendance.viewAll");
  const { userId } = await params;
  const todayKey = istDateKey(new Date());
  const requested = String((await searchParams).month ?? "");
  const month = isValidMonth(requested) ? requested : todayKey.slice(0, 7);
  const sheet = await monthSheet(actor, userId, month);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="page-title">Attendance</h1>
      <AttendanceTabs active="/attendance/team" owner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{sheet.person.name}</h2>
        <div className="flex items-center gap-3">
          <MonthNav month={month} />
          <Link href={`/api/attendance/export?userId=${userId}&month=${month}`} className="btn-secondary py-1">Download CSV</Link>
        </div>
      </div>
      <AttendanceSheet rows={sheet.rows} totals={sheet.totals} todayKey={todayKey} correctFor={userId} />
    </div>
  );
}
