"use client";

import { useState, useTransition } from "react";
import { useNowSecond } from "@/components/clock";
import { STATE_LABELS, type EventType } from "@/lib/attendance/compute";
import { formatMinutes } from "@/lib/dates";
import type { TodayView } from "@/services/attendance";
import { pressAttendanceButton } from "@/server/actions/attendance";

const BUTTONS: Record<EventType, { label: string; style: string }> = {
  LOGIN: { label: "Log in", style: "btn-primary" },
  BREAK_START: { label: "Start break", style: "btn-secondary" },
  BREAK_END: { label: "End break", style: "btn-primary" },
  LOGOUT: { label: "Log out", style: "btn-danger" },
};

const STATE_DOT = {
  NOT_STARTED: "bg-muted",
  WORKING: "bg-success",
  ON_BREAK: "bg-amber-500",
  LOGGED_OUT: "bg-muted",
} as const;

// Attendance buttons. Times come from the server; the browser only counts on
// from the server's last answer so the running totals tick live.
export function AttendanceControl({ initial, size = "compact" }: { initial: TodayView; size?: "compact" | "large" }) {
  const [today, setToday] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const second = useNowSecond();

  const { summary } = today;
  const elapsed = second === null ? 0 : Math.max(0, Math.floor((second * 1000 - Date.parse(today.asOf)) / 60_000));
  const worked = summary.workedMinutes + (summary.state === "WORKING" ? elapsed : 0);
  const onBreak = summary.breakMinutes + (summary.state === "ON_BREAK" ? elapsed : 0);

  function press(type: EventType) {
    if (type === "LOGOUT" && !window.confirm("Log out for the day? You can log in again later if needed.")) return;
    setError(null);
    startTransition(async () => {
      const result = await pressAttendanceButton(type);
      if (result.error) setError(result.error);
      if (result.today) setToday(result.today);
    });
  }

  const buttons = today.allowed.map((type) => (
    <button key={type} type="button" disabled={pending} onClick={() => press(type)} className={`${BUTTONS[type].style} ${size === "compact" ? "py-1.5" : "px-6 py-3 text-base"}`}>
      {BUTTONS[type].label}
    </button>
  ));

  if (size === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${STATE_DOT[summary.state]}`} />
          <span className="font-medium">{STATE_LABELS[summary.state]}</span>
          {summary.firstLoginAt && <span className="text-muted">· {formatMinutes(worked)} worked</span>}
        </div>
        {buttons}
        {error && <span role="alert" className="text-sm text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${STATE_DOT[summary.state]}`} />
        <span className="text-lg font-semibold">{STATE_LABELS[summary.state]}</span>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Logged in at" value={summary.firstLoginAt ? time(summary.firstLoginAt) : "–"} />
        <Stat label="Worked today" value={formatMinutes(worked)} />
        <Stat label={`Breaks (${summary.breakCount})`} value={formatMinutes(onBreak)} />
        <Stat label="Logged out at" value={summary.state === "LOGGED_OUT" && summary.lastLogoutAt ? time(summary.lastLogoutAt) : "–"} />
      </dl>
      <div className="flex flex-wrap gap-3">{buttons}</div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function time(d: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
