import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { istDateKey } from "@/lib/dates";
import { listHolidays } from "@/services/leave";
import { AddHolidayForm, HolidayRow } from "./holiday-forms";

export const metadata: Metadata = { title: "Holidays" };

export default async function HolidaysPage() {
  await requirePermission("settings.manage");
  const holidays = await listHolidays(istDateKey(new Date()).slice(0, 4) + "-01-01");

  return (
    <div className="max-w-2xl space-y-5">
      <Link href="/settings" className="text-sm text-muted hover:underline">← Settings</Link>
      <div>
        <h1 className="page-title">Holidays</h1>
        <p className="text-sm text-muted">Major Indian holidays are already added. Edit or remove any of them, or add your own. Holidays are not counted as working days in leave requests.</p>
      </div>
      <AddHolidayForm />
      <div className="card p-0">
        {holidays.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No holidays added yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {holidays.map((h) => <HolidayRow key={h.id} holiday={h} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
