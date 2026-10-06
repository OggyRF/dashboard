"use client";

import { useState, useTransition } from "react";
import { Coffee, Info, Laptop, LogIn, LogOut, NotebookPen, Pencil, Play, Timer, type LucideIcon } from "lucide-react";
import { useNowSecond } from "@/components/clock";
import { useIsDesktop } from "@/components/presence";
import { IDLE_STOP_MINUTES } from "@/lib/attendance/presence";
import { BREAK_ALLOWANCE_MINUTES, STATE_LABELS, type EventType } from "@/lib/attendance/compute";
import type { TodayView } from "@/services/attendance";
import { pressAttendanceButton, saveWorkNoteAction } from "@/server/actions/attendance";

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
  const [askNote, setAskNote] = useState(false);
  const second = useNowSecond();
  const desktop = useIsDesktop();

  const { summary } = today;
  const since = second === null ? 0 : Math.max(0, second - Math.floor(Date.parse(today.asOf) / 1000));
  const live = summary.state === "WORKING" || summary.state === "ON_BREAK";
  const worked = summary.workedSeconds + (summary.state === "WORKING" ? since : 0);
  const onBreak = summary.breakSeconds + (summary.state === "ON_BREAK" ? since : 0);
  const breakLeft = ALLOWANCE_SECONDS - onBreak;
  const sessionStart = summary.sessionStartedAt ? Math.floor(Date.parse(String(summary.sessionStartedAt)) / 1000) : null;
  const sinceLogin = live && sessionStart !== null && second !== null ? Math.max(0, second - sessionStart) : 0;

  function press(type: EventType, note?: string) {
    // Log out first asks what was done today.
    if (type === "LOGOUT" && note === undefined) return setAskNote(true);
    setError(null);
    startTransition(async () => {
      const result = await pressAttendanceButton(type, note);
      if (result.error) setError(result.error);
      if (result.today) {
        setToday(result.today);
        setAskNote(false);
      }
    });
  }

  const noteDialog = askNote && (
    <WorkNoteDialog
      initial={today.workNote ?? ""}
      pending={pending}
      error={error}
      onCancel={() => { setAskNote(false); setError(null); }}
      onSubmit={(note) => press("LOGOUT", note)}
    />
  );

  // Phones can see the timer but not clock in or out.
  const buttons = !desktop ? [] : today.allowed.map((type) => {
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
        {desktop === false && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Laptop className="h-4 w-4" />
            Use your laptop to clock in
          </span>
        )}
        {error && !askNote && <span role="alert" className="text-sm text-danger">{error}</span>}
        {noteDialog}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <span className={`chip px-3 py-1 text-sm ${pill.pill}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${pill.dot}`} />
        {STATE_LABELS[summary.state]}
      </span>

      {summary.state === "LOGGED_OUT" && today.stoppedAt && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4 text-sm">
          <div className="font-semibold text-warning">Your timer stopped at {time(today.stoppedAt)}</div>
          <div className="mt-1 text-foreground/80">
            Your laptop stopped responding (lid closed, asleep, switched off, or the dashboard was closed), so that time is not counted as work. Press Log in to start again.
          </div>
        </div>
      )}

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

      {desktop === false ? (
        <div className="flex items-start gap-3 rounded-2xl bg-background px-5 py-4 text-sm">
          <Laptop className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div>
            <div className="font-semibold">Open the dashboard on your laptop or desktop to start work.</div>
            <div className="mt-1 text-muted">Log in, breaks and log out only work there. You can still check your time, leave and messages on your phone.</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">{buttons}</div>
      )}
      {error && !askNote && <p role="alert" className="text-sm text-danger">{error}</p>}
      {noteDialog}

      {summary.state === "LOGGED_OUT" && <TodayNote dayKey={today.dayKey} note={today.workNote} onSaved={setToday} />}

      <p className="flex items-start gap-2 border-t border-border pt-4 text-xs text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong className="font-semibold text-foreground">Keep this dashboard open on your laptop while you work.</strong> If the laptop lid is closed, it goes to sleep, it is switched off or the dashboard is closed, your work timer stops within {IDLE_STOP_MINUTES} minutes and that time counts as not working. Press Log in again when you are back.
        </span>
      </p>
    </div>
  );
}

export const WORK_NOTE_MIN = 10;

// Shown when Log out is pressed: today's work must be written down first.
function WorkNoteDialog({ initial, pending, error, onCancel, onSubmit }: { initial: string; pending: boolean; error: string | null; onCancel: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState(initial);
  const short = note.trim().length < WORK_NOTE_MIN;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="work-note-title">
      <form
        className="w-full max-w-lg space-y-3 rounded-2xl bg-surface p-5 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (!short) onSubmit(note.trim());
        }}
      >
        <h2 id="work-note-title" className="flex items-center gap-2 text-lg font-bold"><NotebookPen className="h-5 w-5 text-brand" />What did you work on today?</h2>
        <p className="text-sm text-muted">Write a short note before logging out. The owners can see it in your attendance.</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={6}
          maxLength={3000}
          autoFocus
          placeholder={"e.g.\n- IIT Bombay: 2 guest posts uploaded\n- Printery Dubai: keyword research for the blog\n- Fixed meta titles on Cafe Bloom"}
          aria-label="Today's work"
          className="field"
        />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted">{short ? `At least ${WORK_NOTE_MIN} characters.` : "You can log in again later if needed."}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={pending || short} className="btn-danger"><LogOut className="h-4 w-4" />Save and log out</button>
          </div>
        </div>
      </form>
    </div>
  );
}

// Today's note after logging out, with a way to add or fix it.
function TodayNote({ dayKey, note, onSaved }: { dayKey: string; note: string | null; onSaved: (t: TodayView) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!editing) {
    return (
      <div className="rounded-2xl bg-background px-5 py-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">Today&apos;s work note</span>
          <button type="button" onClick={() => { setDraft(note ?? ""); setEditing(true); }} className="inline-flex items-center gap-1 text-xs font-semibold text-brand"><Pencil className="h-3.5 w-3.5" />{note ? "Edit" : "Add"}</button>
        </div>
        <p className={`mt-1 whitespace-pre-wrap ${note ? "" : "text-warning"}`}>{note ?? "No note yet. Your timer stopped without a Log out; please add what you worked on."}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-2xl bg-background px-5 py-4">
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} maxLength={3000} aria-label="Today's work" className="field" autoFocus />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || draft.trim().length < WORK_NOTE_MIN}
          onClick={() =>
            startTransition(async () => {
              const r = await saveWorkNoteAction(dayKey, draft);
              if (r.error) return setError(r.error);
              setEditing(false);
              setError(null);
              if (r.today) onSaved(r.today);
            })
          }
          className="btn-primary"
        >
          Save note
        </button>
        <button type="button" onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
      </div>
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
