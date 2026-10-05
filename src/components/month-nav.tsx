import Link from "next/link";
import { formatMonth, shiftMonth } from "@/lib/dates";

// Previous / next month links that keep other query parameters.
export function MonthNav({ month, params = {} }: { month: string; params?: Record<string, string> }) {
  const href = (m: string) => `?${new URLSearchParams({ ...params, month: m }).toString()}`;
  return (
    <div className="flex items-center gap-2">
      <Link href={href(shiftMonth(month, -1))} className="btn-secondary px-3 py-1" aria-label="Previous month">‹</Link>
      <span className="min-w-36 text-center font-medium">{formatMonth(month)}</span>
      <Link href={href(shiftMonth(month, 1))} className="btn-secondary px-3 py-1" aria-label="Next month">›</Link>
    </div>
  );
}
