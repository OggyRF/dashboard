// Pure attendance arithmetic, shared by the server, the worker and tests.

export type EventType = "LOGIN" | "BREAK_START" | "BREAK_END" | "LOGOUT";
export type AttendanceState = "NOT_STARTED" | "WORKING" | "ON_BREAK" | "LOGGED_OUT";

export type TimedEvent = { id: string; type: EventType; at: Date };

export type Correction = {
  eventId: string;
  kind: "CHANGE_TIME" | "ADD_EVENT" | "REMOVE_EVENT";
  newAt: Date | null;
  createdAt: Date;
};

// Daily break allowance (Aarif, 5 Oct 2026): breaks can be split up, but a
// new one cannot start once an hour has been used.
export const BREAK_ALLOWANCE_MINUTES = 60;

export type BreakSpan = { start: Date; end: Date | null };

export type DaySummary = {
  state: AttendanceState;
  firstLoginAt: Date | null;
  lastLogoutAt: Date | null;
  // Start of the current (or last) logged-in stretch, for the live timer.
  sessionStartedAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  // Second-precision totals, so the live timers start exactly right.
  workedSeconds: number;
  breakSeconds: number;
  breakCount: number;
  breaks: BreakSpan[];
  // Present only when events are out of order, e.g. after a bad correction.
  issues: string[];
};

// Applies owner corrections on top of the recorded events: the latest time
// change wins, removed events are dropped. Recorded rows are never edited.
export function effectiveEvents(events: TimedEvent[], corrections: Correction[]): TimedEvent[] {
  const ordered = [...corrections].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const removed = new Set<string>();
  const newTime = new Map<string, Date>();
  for (const c of ordered) {
    if (c.kind === "REMOVE_EVENT") removed.add(c.eventId);
    if (c.kind === "CHANGE_TIME" && c.newAt) newTime.set(c.eventId, c.newAt);
  }
  return events
    .filter((e) => !removed.has(e.id))
    .map((e) => ({ ...e, at: newTime.get(e.id) ?? e.at }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || order(a.type) - order(b.type));
}

// Same-second events keep a sensible order (a break ends before the logout).
function order(type: EventType): number {
  return { LOGIN: 0, BREAK_START: 1, BREAK_END: 2, LOGOUT: 3 }[type];
}

export function breakAllowanceLeftSeconds(summary: Pick<DaySummary, "breakSeconds">): number {
  return BREAK_ALLOWANCE_MINUTES * 60 - summary.breakSeconds;
}

// Next allowed buttons for a state.
export const ALLOWED: Record<AttendanceState, EventType[]> = {
  NOT_STARTED: ["LOGIN"],
  LOGGED_OUT: ["LOGIN"],
  WORKING: ["BREAK_START", "LOGOUT"],
  ON_BREAK: ["BREAK_END", "LOGOUT"],
};

// Walks the day's events in time order. Open spans (still working or on a
// break) are counted up to `asOf`. Worked time excludes breaks.
export function summarizeDay(events: TimedEvent[], asOf: Date): DaySummary {
  let state: AttendanceState = "NOT_STARTED";
  let sessionStart = 0;
  let breakStart = 0;
  let sessionMs = 0;
  let breakMs = 0;
  let breakCount = 0;
  let firstLoginAt: Date | null = null;
  let lastLogoutAt: Date | null = null;
  let sessionStartedAt: Date | null = null;
  const breaks: BreakSpan[] = [];
  const issues: string[] = [];

  for (const e of events) {
    const t = e.at.getTime();
    if (!ALLOWED[state].includes(e.type)) {
      issues.push(`${e.type} at ${e.at.toISOString()} while ${state}`);
      continue;
    }
    switch (e.type) {
      case "LOGIN":
        state = "WORKING";
        sessionStart = t;
        sessionStartedAt = e.at;
        firstLoginAt ??= e.at;
        break;
      case "BREAK_START":
        state = "ON_BREAK";
        breakStart = t;
        breakCount++;
        breaks.push({ start: e.at, end: null });
        break;
      case "BREAK_END":
        state = "WORKING";
        breakMs += t - breakStart;
        breaks[breaks.length - 1].end = e.at;
        break;
      case "LOGOUT":
        if (state === "ON_BREAK") {
          breakMs += t - breakStart;
          breaks[breaks.length - 1].end = e.at;
        }
        sessionMs += t - sessionStart;
        lastLogoutAt = e.at;
        state = "LOGGED_OUT";
        break;
    }
  }

  const now = asOf.getTime();
  if (state === "WORKING" || state === "ON_BREAK") {
    sessionMs += Math.max(0, now - sessionStart);
    if (state === "ON_BREAK") breakMs += Math.max(0, now - breakStart);
  }

  const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));
  const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));
  return {
    state,
    firstLoginAt,
    lastLogoutAt,
    sessionStartedAt,
    workedMinutes: minutes(sessionMs - breakMs),
    breakMinutes: minutes(breakMs),
    workedSeconds: seconds(sessionMs - breakMs),
    breakSeconds: seconds(breakMs),
    breakCount,
    breaks,
    issues,
  };
}

export const EVENT_LABELS: Record<EventType, string> = {
  LOGIN: "Logged in",
  BREAK_START: "Break started",
  BREAK_END: "Break ended",
  LOGOUT: "Logged out",
};

// Buttons a person may press now: the state's buttons, minus Start break
// once the day's break allowance is used up.
export function allowedActions(summary: Pick<DaySummary, "state" | "breakSeconds">): EventType[] {
  const used = breakAllowanceLeftSeconds(summary) <= 0;
  return ALLOWED[summary.state].filter((t) => !(t === "BREAK_START" && used));
}

export const STATE_LABELS: Record<AttendanceState, string> = {
  NOT_STARTED: "Not logged in",
  WORKING: "Working",
  ON_BREAK: "On break",
  LOGGED_OUT: "Logged out",
};
