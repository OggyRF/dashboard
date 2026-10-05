"use client";

import { useState } from "react";

type Entry = { key: string; name: string; status: "PENDING" | "APPROVED"; halfDay: boolean; mine: boolean };
type Holiday = { key: string; name: string };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Month grid. Click a start day and an end day to pick the leave dates; the
// choice fills the request form below it.
export function LeaveCalendar({
  month,
  todayKey,
  entries,
  holidays,
  weeklyOff,
  onPick,
  picked,
}: {
  month: string;
  todayKey: string;
  entries: Entry[];
  holidays: Holiday[];
  weeklyOff: number[];
  onPick?: (from: string, to: string) => void;
  picked?: { from: string; to: string };
}) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);

  const holidayName = new Map(holidays.map((h) => [h.key, h.name]));
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) byDay.set(e.key, [...(byDay.get(e.key) ?? []), e]);

  function click(key: string) {
    if (!onPick) return;
    if (!anchor) {
      setAnchor(key);
      onPick(key, key);
    } else {
      const [from, to] = anchor <= key ? [anchor, key] : [key, anchor];
      setAnchor(null);
      onPick(from, to);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-background px-2 py-1 text-center font-medium text-muted">{w}</div>
        ))}
        {cells.map((key, i) => {
          if (!key) return <div key={i} className="min-h-20 bg-background/60" />;
          const weekdayIndex = new Date(`${key}T00:00:00Z`).getUTCDay();
          const off = weeklyOff.includes(weekdayIndex);
          const holiday = holidayName.get(key);
          const inPick = picked && key >= picked.from && key <= picked.to;
          return (
            <button
              key={key}
              type="button"
              onClick={() => click(key)}
              disabled={!onPick}
              className={`min-h-20 bg-surface p-1.5 text-left align-top ${off || holiday ? "bg-background" : ""} ${inPick ? "ring-2 ring-inset ring-brand" : ""} ${onPick ? "hover:bg-brand/5" : "cursor-default"}`}
            >
              <div className={`font-medium ${key === todayKey ? "inline-block rounded bg-brand px-1 text-brand-ink" : off ? "text-muted" : ""}`}>
                {Number(key.slice(8))}
              </div>
              {holiday && <div className="mt-0.5 truncate text-[11px] text-muted">{holiday}</div>}
              {(byDay.get(key) ?? []).map((e, j) => (
                <div
                  key={j}
                  className={`mt-0.5 truncate rounded px-1 text-[11px] ${e.status === "APPROVED" ? "bg-success/15 text-success" : "bg-warning/10 text-warning"}`}
                  title={`${e.name}: ${e.status === "APPROVED" ? "approved" : "pending"}${e.halfDay ? ", half day" : ""}`}
                >
                  {e.mine ? "You" : e.name}{e.halfDay ? " ½" : ""}
                </div>
              ))}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded bg-success/40" />Approved</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded bg-warning" />Pending</span>
        <span>Grey days are weekly offs or holidays</span>
      </div>
    </div>
  );
}
