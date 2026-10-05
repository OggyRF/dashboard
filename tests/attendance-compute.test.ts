import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  BREAK_ALLOWANCE_MINUTES,
  allowedActions,
  breakAllowanceLeftSeconds,
  effectiveEvents,
  summarizeDay,
  type TimedEvent,
} from "@/lib/attendance/compute";

const day = "2026-10-05";
const at = (hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);
const ev = (id: string, type: TimedEvent["type"], hhmm: string): TimedEvent => ({ id, type, at: at(hhmm) });

describe("day summary", () => {
  it("counts a normal day with two breaks", () => {
    const s = summarizeDay(
      [
        ev("1", "LOGIN", "09:30"),
        ev("2", "BREAK_START", "13:00"),
        ev("3", "BREAK_END", "13:45"),
        ev("4", "BREAK_START", "16:00"),
        ev("5", "BREAK_END", "16:15"),
        ev("6", "LOGOUT", "18:30"),
      ],
      at("23:59"),
    );
    expect(s.state).toBe("LOGGED_OUT");
    expect(s.breakMinutes).toBe(60);
    expect(s.breakCount).toBe(2);
    expect(s.workedMinutes).toBe(9 * 60 - 60); // 09:30 to 18:30 minus breaks
    expect(s.issues).toEqual([]);
  });

  it("counts time still running while working or on a break", () => {
    const working = summarizeDay([ev("1", "LOGIN", "09:00")], at("11:30"));
    expect(working).toMatchObject({ state: "WORKING", workedMinutes: 150, breakMinutes: 0 });

    const onBreak = summarizeDay([ev("1", "LOGIN", "09:00"), ev("2", "BREAK_START", "11:00")], at("11:30"));
    expect(onBreak).toMatchObject({ state: "ON_BREAK", workedMinutes: 120, breakMinutes: 30 });
  });

  it("ends an open break when the person logs out", () => {
    const s = summarizeDay(
      [ev("1", "LOGIN", "09:00"), ev("2", "BREAK_START", "17:00"), ev("3", "LOGOUT", "17:30")],
      at("23:59"),
    );
    expect(s.breakMinutes).toBe(30);
    expect(s.workedMinutes).toBe(8 * 60);
  });

  it("handles a second login after logging out", () => {
    const s = summarizeDay(
      [ev("1", "LOGIN", "09:00"), ev("2", "LOGOUT", "13:00"), ev("3", "LOGIN", "15:00"), ev("4", "LOGOUT", "18:00")],
      at("23:59"),
    );
    expect(s.workedMinutes).toBe(7 * 60);
    expect(s.firstLoginAt).toEqual(at("09:00"));
    expect(s.lastLogoutAt).toEqual(at("18:00"));
  });

  it("only allows sensible next actions", () => {
    expect(ALLOWED.NOT_STARTED).toEqual(["LOGIN"]);
    expect(ALLOWED.WORKING).toContain("BREAK_START");
    expect(ALLOWED.WORKING).not.toContain("BREAK_END");
    expect(ALLOWED.ON_BREAK).toContain("BREAK_END");
  });

  it("reports out-of-order entries instead of counting them", () => {
    const s = summarizeDay([ev("1", "BREAK_START", "10:00"), ev("2", "LOGIN", "11:00")], at("12:00"));
    expect(s.issues).toHaveLength(1);
    expect(s.state).toBe("WORKING");
  });
});

describe("owner corrections", () => {
  const events = [ev("1", "LOGIN", "09:30"), ev("2", "LOGOUT", "23:59")];

  it("applies a changed time without touching the recorded entry", () => {
    const corrected = effectiveEvents(events, [
      { eventId: "2", kind: "CHANGE_TIME", newAt: at("18:30"), createdAt: new Date("2026-10-06T05:00:00Z") },
    ]);
    expect(corrected[1].at).toEqual(at("18:30"));
    expect(events[1].at).toEqual(at("23:59"));
    expect(summarizeDay(corrected, at("23:59")).workedMinutes).toBe(9 * 60);
  });

  it("uses the latest correction and drops removed entries", () => {
    const corrected = effectiveEvents(events, [
      { eventId: "2", kind: "CHANGE_TIME", newAt: at("18:00"), createdAt: new Date("2026-10-06T05:00:00Z") },
      { eventId: "2", kind: "CHANGE_TIME", newAt: at("19:00"), createdAt: new Date("2026-10-06T06:00:00Z") },
    ]);
    expect(corrected[1].at).toEqual(at("19:00"));

    const removed = effectiveEvents(events, [{ eventId: "2", kind: "REMOVE_EVENT", newAt: null, createdAt: new Date() }]);
    expect(removed).toHaveLength(1);
  });

  it("keeps entries in time order after a correction", () => {
    const corrected = effectiveEvents(
      [ev("1", "LOGIN", "09:30"), ev("2", "BREAK_START", "13:00"), ev("3", "BREAK_END", "13:30")],
      [{ eventId: "2", kind: "CHANGE_TIME", newAt: at("08:00"), createdAt: new Date() }],
    );
    expect(corrected.map((e) => e.id)).toEqual(["2", "1", "3"]);
    // A break that now starts before the login leaves both break entries unusable,
    // which is what makes the service refuse such a correction.
    expect(summarizeDay(corrected, at("23:59")).issues).toHaveLength(2);
  });
});

describe("break allowance and live timers", () => {
  it("lists each break with its start and end, to the second", () => {
    const s = summarizeDay(
      [ev("1", "LOGIN", "09:00"), ev("2", "BREAK_START", "13:00"), ev("3", "BREAK_END", "13:30"), ev("4", "BREAK_START", "16:00")],
      new Date(at("16:10").getTime() + 15_000),
    );
    expect(s.breaks).toEqual([
      { start: at("13:00"), end: at("13:30") },
      { start: at("16:00"), end: null },
    ]);
    expect(s.breakSeconds).toBe(40 * 60 + 15);
    expect(s.sessionStartedAt).toEqual(at("09:00"));
  });

  it("starts the login timer from the latest log in", () => {
    const s = summarizeDay([ev("1", "LOGIN", "09:00"), ev("2", "LOGOUT", "12:00"), ev("3", "LOGIN", "14:00")], at("15:00"));
    expect(s.sessionStartedAt).toEqual(at("14:00"));
    expect(s.workedSeconds).toBe(4 * 3600);
  });

  it("offers Start break until an hour of breaks is used, across several breaks", () => {
    const base = [ev("1", "LOGIN", "09:00"), ev("2", "BREAK_START", "11:00"), ev("3", "BREAK_END", "11:30")];
    const half = summarizeDay(base, at("12:00"));
    expect(breakAllowanceLeftSeconds(half)).toBe(30 * 60);
    expect(allowedActions(half)).toEqual(["BREAK_START", "LOGOUT"]);

    const full = summarizeDay([...base, ev("4", "BREAK_START", "13:00"), ev("5", "BREAK_END", "13:30")], at("14:00"));
    expect(full.breakSeconds).toBe(BREAK_ALLOWANCE_MINUTES * 60);
    expect(allowedActions(full)).toEqual(["LOGOUT"]);
  });

  it("always lets someone on an overlong break resume", () => {
    const s = summarizeDay([ev("1", "LOGIN", "09:00"), ev("2", "BREAK_START", "11:00")], at("12:30"));
    expect(breakAllowanceLeftSeconds(s)).toBe(-30 * 60);
    expect(allowedActions(s)).toEqual(["BREAK_END", "LOGOUT"]);
  });
});
