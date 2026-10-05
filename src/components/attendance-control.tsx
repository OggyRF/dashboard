"use client";

import { useState, useTransition } from "react";
import { Coffee, LogIn, LogOut, Play, type LucideIcon } from "lucide-react";
import { useNowSecond } from "@/components/clock";
import { STATE_LABELS, type EventType } from "@/lib/attendance/compute";
import { formatMinutes } from "@/lib/dates";
import type { TodayView } from "@/services/attendance";
import { pressAttendanceButton } from "@/server/actions/attendance";

const BUTTONS: Record<EventType, { label: string; style: string; icon: LucideIcon }> = {
  LOGIN: { label: "Log in", style: "btn-primary", icon: LogIn },
  BREAK_START: { label: "Start break", style: "btn-secondary", icon: Coffee },
  BREAK_END: { label: "End break", style: "btn-primary", icon: Play },
  LOGOUT: { label: "Log out", style: "btn-danger", icon: LogOut },
};

const STATE_PILL = {
  NOT_STARTED: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  WORKING: { pill: "bg-success/10 text-success", dot: "bg-success animate-pulse" },
  ON_BREAK: { pill: "bg-warning/10 text-warning", dot: "bg-warning" },
  LOGGED_OUT: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
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

  const buttons = today.allowed.map((type) => {
    const Icon = BUTTONS[type].icon;
    return (
      <button key={type} type="button" disabled={pending} onClick={() => press(type)} className={`${BUTTONS[type].style} ${size === "compact" ? "py-1.5" : "px-6 py-3 text-base"}`}>
        <Icon className={size === "compact" ? "h-4 w-4" : "h-5 w-5"} />
        {BUTTONS[type].label}
      </button>
    );
  });
  const pill = STATE_PILL[summary.state];

  if (size === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`chip ${pill.pill}`}>
            <span className={`h-2 w-2 rounded-full ${pill.dot}`} />
            {STATE_LABELS[summary.state]}
          </span>
          {summary.firstLoginAt && <span className="font-medium text-muted tabular-nums">{formatMinutes(worked)} worked</span>}
        </div>
        {buttons}
        {error && <span role="alert" className="text-sm text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <span className={`chip px-3 py-1 text-sm ${pill.pill}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${pill.dot}`} />
        {STATE_LABELS[summary.state]}
      </span>
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
    <div className="rounded-xl bg-background px-4 py-3.5">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function time(d: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
