"use client";

import { useState, useTransition } from "react";
import { Coffee, LogIn, LogOut, Play, Timer, type LucideIcon } from "lucide-react";
import { useNowSecond } from "@/components/clock";
import { BREAK_ALLOWANCE_MINUTES, STATE_LABELS, type EventType } from "@/lib/attendance/compute";
import type { TodayView } from "@/services/attendance";
import { pressAttendanceButton } from "@/server/actions/attendance";

const BUTTONS: Record<EventType, { label: string; style: string; icon: LucideIcon }> = {
  LOGIN: { label: "Log in", style: "btn-primary", icon: LogIn },
  BREAK_START: { label: "Start break", style: "btn-secondary", icon: Coffee },
  BREAK_END: { label: "Resume", style: "btn-primary", icon: Play },
  LOGOUT: { label: "Log out", style: "btn-danger", icon: LogOut },
};

const STATE_PILL = {
  NOT_STARTED: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  WORKING: { pill: "bg-success/10 text-success", dot: "bg-success animate-pulse" },
  ON_BREAK: { pill: "bg-warning/10 text-warning", dot: "bg-warning animate-pulse" },
  LOGGED_OUT: { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
} as const;

const ALLOWANCE_SECONDS = BREAK_ALLOWANCE_MINUTES * 60;

// Attendance buttons and live timers. Times come from the server; the browser
// only counts on from the server's last answer, second by second.
export function AttendanceControl({ initial, size = "compact" }: { initial: TodayView; size?: "compact" | "large" }) {
  const [today, setToday] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const second = useNowSecond();

  const { summary } = today;
  const since = second === null ? 0 : Math.max(0, second - Math.floor(Date.parse(today.asOf) / 1000));
  const live = summary.state === "WORKING" || summary.state === "ON_BREAK";
  const worked = summary.workedSeconds + (summary.state === "WORKING" ? since : 0);
  const onBreak = summary.breakSeconds + (summary.state === "ON_BREAK" ? since : 0);
  const breakLeft = ALLOWANCE_SECONDS - onBreak;
  const sessionStart = summary.sessionStartedAt ? Math.floor(Date.parse(String(summary.sessionStartedAt)) / 1000) : null;
  const sinceLogin = live && sessionStart !== null && second !== null ? Math.max(0, second - sessionStart) : 0;

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
  const allowanceUsed = summary.state === "WORKING" && !today.allowed.includes("BREAK_START");
  const pill = STATE_PILL[summary.state];

  if (size === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className={`chip ${pill.pill}`}>
          <span className={`h-2 w-2 rounded-full ${pill.dot}`} />
          {STATE_LABELS[summary.state]}
        </span>
        {summary.state === "WORKING" && (
          <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums" title="Time since log in">
            <Timer className="h-4 w-4 text-brand" />
            {hms(sinceLogin)}
          </span>
        )}
        {summary.state === "ON_BREAK" && (
          <span className={`flex items-center gap-1.5 text-sm font-semibold tabular-nums ${breakLeft < 0 ? "text-danger" : "text-warning"}`} title="Break time left today">
            <Coffee className="h-4 w-4" />
            {breakLeft < 0 ? `Over by ${ms(-breakLeft)}` : `${ms(breakLeft)} left`}
          </span>
        )}
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

      {summary.state === "WORKING" && (
        <div className="rounded-2xl bg-success/8 px-6 py-5">
          <div className="text-sm font-medium text-success">Time since log in</div>
          <div className="mt-1 text-5xl font-extrabold tracking-tight tabular-nums">{hms(sinceLogin)}</div>
          <div className="mt-2 text-sm text-muted">
            {allowanceUsed ? "Today's break hour is used up." : `${ms(Math.max(0, breakLeft))} of break time left today.`}
          </div>
        </div>
      )}

      {summary.state === "ON_BREAK" && (
        <div className={`rounded-2xl px-6 py-5 ${breakLeft < 0 ? "bg-danger/8" : "bg-warning/10"}`}>
          <div className={`text-sm font-medium ${breakLeft < 0 ? "text-danger" : "text-warning"}`}>
            {breakLeft < 0 ? "Break hour used up, over by" : "Break time left"}
          </div>
          <div className={`mt-1 text-5xl font-extrabold tracking-tight tabular-nums ${breakLeft < 0 ? "text-danger" : ""}`}>
            {ms(Math.abs(breakLeft))}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div
              className={`h-full rounded-full transition-[width] ${breakLeft < 0 ? "bg-danger" : "bg-warning"}`}
              style={{ width: `${Math.min(100, (onBreak / ALLOWANCE_SECONDS) * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-sm text-muted">Press Resume when you are back.</div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Logged in at" value={summary.firstLoginAt ? time(summary.firstLoginAt) : "–"} />
        <Stat label="Worked today" value={hms(worked)} />
        <Stat label={`Break used (of ${BREAK_ALLOWANCE_MINUTES}m)`} value={ms(onBreak)} />
        <Stat label="Logged out at" value={summary.state === "LOGGED_OUT" && summary.lastLogoutAt ? time(summary.lastLogoutAt) : "–"} />
      </dl>

      {summary.breaks.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Breaks today</div>
          <ul className="flex flex-wrap gap-2">
            {summary.breaks.map((b) => (
              <li key={String(b.start)} className="chip bg-background px-3 py-1 text-sm font-medium tabular-nums">
                {time(b.start)} – {b.end ? time(b.end) : "now"}
                <span className="text-muted">· {ms(b.end ? secondsBetween(b.start, b.end) : Math.max(0, (second ?? 0) - Math.floor(Date.parse(String(b.start)) / 1000)))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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

const pad = (n: number) => String(n).padStart(2, "0");

// 01:05:09
function hms(total: number) {
  const s = Math.max(0, Math.floor(total));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// 45:09, or 1:05:09 past an hour
function ms(total: number) {
  const s = Math.max(0, Math.floor(total));
  return s >= 3600 ? hms(s).replace(/^0/, "") : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function secondsBetween(a: Date | string, b: Date | string) {
  return Math.max(0, Math.floor((Date.parse(String(b)) - Date.parse(String(a))) / 1000));
}

function time(d: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
