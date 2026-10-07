import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import {
  closeOpenDays,
  correctDay,
  dayDetail,
  ensureDay,
  getToday,
  monthSheet,
  recordEvent,
  teamToday,
} from "@/services/attendance";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

// These tests jump hours between presses without the laptop's check-ins, so
// the auto-stop for a quiet laptop is switched off here (tests/presence.test.ts
// covers it).
vi.mock("@/lib/attendance/presence", async (original) => ({
  ...(await original<typeof import("@/lib/attendance/presence")>()),
  IDLE_STOP_MINUTES: 24 * 60,
}));

const day = "2026-10-05"; // a Monday
const at = (hhmm: string) => istDateTime(day, hhmm);

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function person(role: "OWNER" | "EXECUTION" | "OFFPAGE" = "EXECUTION") {
  const { user } = await makeUser({ role });
  return asSessionUser(user);
}

describe("pressing the buttons", () => {
  it("refuses a new break once the day's hour is used, but always allows Resume", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await recordEvent(u, "BREAK_START", null, at("11:00"));
    await recordEvent(u, "BREAK_END", null, at("11:40"));
    await recordEvent(u, "BREAK_START", null, at("13:00"));
    const back = await recordEvent(u, "BREAK_END", null, at("13:25"));
    expect(back.allowed).toEqual(["LOGOUT"]);
    expect(back.summary.breaks).toHaveLength(2);
    await expect(recordEvent(u, "BREAK_START", null, at("15:00"))).rejects.toThrow(/break allowance/i);
    expect(await db.attendanceEvent.count({ where: { type: "BREAK_START" } })).toBe(2);
  });

  it("is not available to owners, who do not track their own attendance", async () => {
    const owner = await person("OWNER");
    await expect(recordEvent(owner, "LOGIN", null, at("09:30"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.attendanceEvent.count()).toBe(0);
  });

  it("records a full day and totals it", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:30"));
    await recordEvent(u, "BREAK_START", null, at("13:00"));
    await recordEvent(u, "BREAK_END", null, at("13:45"));
    const after = await recordEvent(u, "LOGOUT", null, at("18:30"), undefined, "Worked on client tasks today");

    expect(after.summary).toMatchObject({ state: "LOGGED_OUT", breakMinutes: 45, breakCount: 1, workedMinutes: 8 * 60 + 15 });
    const stored = await db.attendanceDay.findFirstOrThrow({ where: { userId: u.id } });
    expect(stored.workedMinutes).toBe(8 * 60 + 15);
    expect(stored.lastLogoutAt).toEqual(at("18:30"));
  });

  it("uses the server clock, never a time from the browser", async () => {
    const u = await person();
    const serverNow = at("10:00");
    await recordEvent(u, "LOGIN", null, serverNow);
    const event = await db.attendanceEvent.findFirstOrThrow({ where: { userId: u.id } });
    expect(event.at).toEqual(serverNow);
    expect(event.source).toBe("USER");
  });

  it("refuses an action that does not follow the current state", async () => {
    const u = await person();
    await expect(recordEvent(u, "BREAK_START", null, at("09:00"))).rejects.toThrow(/cannot do/i);
    await recordEvent(u, "LOGIN", null, at("09:30"));
    await expect(recordEvent(u, "LOGIN", null, at("09:31"))).rejects.toThrow(/cannot do/i);
    await recordEvent(u, "BREAK_START", null, at("13:00"));
    await expect(recordEvent(u, "BREAK_START", null, at("13:01"))).rejects.toThrow(/cannot do/i);
  });

  it("ends an open break when the person logs out", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await recordEvent(u, "BREAK_START", null, at("17:00"));
    const after = await recordEvent(u, "LOGOUT", null, at("17:30"), undefined, "Worked on client tasks today");
    expect(after.summary).toMatchObject({ state: "LOGGED_OUT", breakMinutes: 30, workedMinutes: 8 * 60 });
  });

  it("keeps each India-time day separate", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, new Date("2026-10-05T18:00:00Z")); // 11:30 pm IST, 5 Oct
    await recordEvent(u, "LOGOUT", null, new Date("2026-10-05T18:20:00Z"), undefined, "Worked on client tasks today");
    await recordEvent(u, "LOGIN", null, new Date("2026-10-05T19:00:00Z")); // 00:30 am IST, 6 Oct
    const days = await db.attendanceDay.findMany({ where: { userId: u.id }, orderBy: { date: "asc" } });
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("lets off-page staff use attendance", async () => {
    const u = await person("OFFPAGE");
    const after = await recordEvent(u, "LOGIN", null, at("10:00"));
    expect(after.summary.state).toBe("WORKING");
  });
});

describe("the end-of-day job", () => {
  it("closes days nobody logged out of and flags them", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:30"));
    const closed = await closeOpenDays(at("23:59"));
    expect(closed).toBe(1);

    const stored = await db.attendanceDay.findFirstOrThrow({ where: { userId: u.id } });
    expect(stored.autoClosed).toBe(true);
    expect(stored.lastLogoutAt).toEqual(at("23:59"));
    const logout = await db.attendanceEvent.findFirstOrThrow({ where: { userId: u.id, type: "LOGOUT" } });
    expect(logout.source).toBe("SYSTEM");
  });

  it("leaves finished days alone and runs safely twice", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:30"));
    await recordEvent(u, "LOGOUT", null, at("18:00"), undefined, "Worked on client tasks today");
    expect(await closeOpenDays(at("23:59"))).toBe(0);
    expect(await closeOpenDays(at("23:59"))).toBe(0);
    expect(await db.attendanceEvent.count({ where: { userId: u.id, type: "LOGOUT" } })).toBe(1);
  });

  it("ends an open break when closing the day", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await recordEvent(u, "BREAK_START", null, at("22:00"));
    await closeOpenDays(at("23:00"));
    const today = await getToday(u, at("23:30"));
    expect(today.summary).toMatchObject({ state: "LOGGED_OUT", breakMinutes: 60, workedMinutes: 13 * 60 });
  });
});

describe("who can see what", () => {
  it("off-page members see only their own record; leads see everyone's", async () => {
    const owner = await person("OWNER");
    const a = await person("OFFPAGE");
    const b = await person("OFFPAGE");
    await recordEvent(a, "LOGIN", null, at("09:30"));

    await expect(monthSheet(b, a.id, "2026-10")).rejects.toThrow(/permission/);
    await expect(teamToday(a)).rejects.toThrow(/permission/);
    await expect(monthSheet(await person("EXECUTION"), a.id, "2026-10")).resolves.toBeTruthy();
    await expect(monthSheet(a, a.id, "2026-10")).resolves.toBeTruthy();
    await expect(monthSheet(owner, a.id, "2026-10")).resolves.toBeTruthy();

    const dayId = (await db.attendanceDay.findFirstOrThrow({ where: { userId: a.id } })).id;
    await expect(dayDetail(b, dayId)).rejects.toThrow(/permission/);
  });

  it("shows the owner everyone's status except the owners', with people on leave marked", async () => {
    const owner = await person("OWNER");
    const working = await person();
    const onLeave = await person();
    await recordEvent(working, "LOGIN", null, at("09:30"));
    await db.leaveRequest.create({
      data: {
        userId: onLeave.id,
        fromDate: new Date(`${day}T00:00:00Z`),
        toDate: new Date(`${day}T00:00:00Z`),
        days: 1,
        type: "CASUAL",
        reason: "family",
        status: "APPROVED",
      },
    });

    const board = await teamToday(owner, at("11:00"));
    expect(board).toHaveLength(2);
    expect(board.some((m) => m.userId === owner.id)).toBe(false);
    expect(board.find((m) => m.userId === working.id)).toMatchObject({ summary: { state: "WORKING" }, onLeave: false });
    expect(board.find((m) => m.userId === onLeave.id)).toMatchObject({ summary: { state: "NOT_STARTED" }, onLeave: true });
  });

  it("totals a month for one person", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, istDateTime("2026-10-05", "09:00"));
    await recordEvent(u, "LOGOUT", null, istDateTime("2026-10-05", "17:00"), undefined, "Worked on client tasks today");
    await recordEvent(u, "LOGIN", null, istDateTime("2026-10-06", "10:00"));
    await recordEvent(u, "LOGOUT", null, istDateTime("2026-10-06", "15:00"), undefined, "Worked on client tasks today");

    const sheet = await monthSheet(u, u.id, "2026-10", istDateTime("2026-10-31", "23:59"));
    expect(sheet.rows).toHaveLength(31);
    expect(sheet.totals).toMatchObject({ daysPresent: 2, workedMinutes: 13 * 60 });
  });
});

describe("owner corrections", () => {
  it("changes a time, keeps the original entry and records the reason", async () => {
    const owner = await person("OWNER");
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:30"));
    await closeOpenDays(at("23:59"));
    const dayId = (await db.attendanceDay.findFirstOrThrow({ where: { userId: u.id } })).id;
    const logout = await db.attendanceEvent.findFirstOrThrow({ where: { dayId, type: "LOGOUT" } });

    await correctDay(owner, dayId, { kind: "CHANGE_TIME", eventId: logout.id, time: "18:30", reason: "forgot to log out" }, null, at("23:59"));

    const detail = await dayDetail(owner, dayId, at("23:59"));
    expect(detail.summary.workedMinutes).toBe(9 * 60);
    expect(detail.corrections[0]).toMatchObject({ kind: "CHANGE_TIME", reason: "forgot to log out", correctedByName: owner.name });
    // The recorded entry itself is untouched.
    expect((await db.attendanceEvent.findUniqueOrThrow({ where: { id: logout.id } })).at).toEqual(at("23:59"));
    expect((await db.attendanceDay.findUniqueOrThrow({ where: { id: dayId } })).corrected).toBe(true);
    await expect(db.auditLog.findFirstOrThrow({ where: { action: "attendance.corrected" } })).resolves.toMatchObject({ actorId: owner.id });
  });

  it("adds a missing entry on a day with no record", async () => {
    const owner = await person("OWNER");
    const u = await person();
    const dayId = await ensureDay(owner, u.id, day);
    await correctDay(owner, dayId, { kind: "ADD_EVENT", type: "LOGIN", time: "09:00", reason: "worked from home" }, null, at("23:00"));
    await correctDay(owner, dayId, { kind: "ADD_EVENT", type: "LOGOUT", time: "17:00", reason: "worked from home" }, null, at("23:00"));

    const detail = await dayDetail(owner, dayId, at("23:00"));
    expect(detail.summary).toMatchObject({ state: "LOGGED_OUT", workedMinutes: 8 * 60 });
    expect(detail.events.every((e) => e.source === "OWNER")).toBe(true);
  });

  it("refuses a correction that puts the day out of order, or lies in the future", async () => {
    const owner = await person("OWNER");
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:30"));
    await recordEvent(u, "BREAK_START", null, at("13:00"));
    const dayId = (await db.attendanceDay.findFirstOrThrow({ where: { userId: u.id } })).id;
    const breakStart = await db.attendanceEvent.findFirstOrThrow({ where: { dayId, type: "BREAK_START" } });

    await expect(
      correctDay(owner, dayId, { kind: "CHANGE_TIME", eventId: breakStart.id, time: "08:00", reason: "wrong time" }, null, at("14:00")),
    ).rejects.toThrow(/out of order/i);
    await expect(
      correctDay(owner, dayId, { kind: "ADD_EVENT", type: "LOGOUT", time: "23:00", reason: "later" }, null, at("14:00")),
    ).rejects.toThrow(/future/i);
    // Nothing was saved by the refused attempts.
    expect(await db.attendanceCorrection.count({ where: { dayId } })).toBe(0);
  });

  it("is refused for everyone but owners, and needs a reason", async () => {
    const owner = await person("OWNER");
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:30"));
    const dayId = (await db.attendanceDay.findFirstOrThrow({ where: { userId: u.id } })).id;
    const login = await db.attendanceEvent.findFirstOrThrow({ where: { dayId } });

    await expect(correctDay(u, dayId, { kind: "CHANGE_TIME", eventId: login.id, time: "09:00", reason: "mine" }, null, at("12:00"))).rejects.toThrow(/permission/);
    await expect(correctDay(owner, dayId, { kind: "CHANGE_TIME", eventId: login.id, time: "09:00", reason: "" }, null, at("12:00"))).rejects.toThrow(/reason/i);
  });
});
