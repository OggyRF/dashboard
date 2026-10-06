import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { isMobileUserAgent } from "@/lib/attendance/presence";
import { closeOpenDays, getToday, heartbeat, recordEvent, teamToday } from "@/services/attendance";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

const day = "2026-10-06";
const at = (hhmm: string) => istDateTime(day, hhmm);
const laptop = { mobile: false };
const phone = { mobile: true };

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

// The open dashboard checks in every minute; every 3 minutes is the slowest
// pace that still counts as present.
async function beatUntil(u: Awaited<ReturnType<typeof person>>, from: string, to: string) {
  for (let t = at(from).getTime() + 3 * 60_000; t <= at(to).getTime(); t += 3 * 60_000) await heartbeat(u, laptop, new Date(t));
  await heartbeat(u, laptop, at(to));
}

async function person(role: "OWNER" | "EXECUTION" = "EXECUTION") {
  return asSessionUser((await makeUser({ role })).user);
}

describe("phones", () => {
  it("recognises phones and tablets but not laptops", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36", "?1")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "?0")).toBe(false);
    expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15")).toBe(false);
  });

  it("cannot log in, take a break or log out", async () => {
    const u = await person();
    await expect(recordEvent(u, "LOGIN", null, at("09:30"), phone)).rejects.toThrow(/laptop or desktop/i);
    expect(await db.attendanceEvent.count()).toBe(0);
    await recordEvent(u, "LOGIN", null, at("09:30"), laptop);
    await expect(recordEvent(u, "LOGOUT", null, at("10:00"), phone)).rejects.toThrow(/laptop or desktop/i);
  });
});

describe("laptop closed, asleep or off", () => {
  it("keeps the timer running while the laptop keeps checking in", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    for (const t of ["09:01", "09:02", "09:03", "09:04", "09:05"]) await heartbeat(u, laptop, at(t));
    const today = await getToday(u, at("09:06"));
    expect(today.summary.state).toBe("WORKING");
    expect(today.stoppedAt).toBeNull();
  });

  it("stops at the last check-in once the laptop goes quiet, and only that time counts", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await beatUntil(u, "09:00", "11:00");
    // Lid closed after 11:00; the laptop wakes at 12:30.
    const back = await heartbeat(u, laptop, at("12:30"));
    expect(back?.summary.state).toBe("LOGGED_OUT");
    expect(back?.summary.workedMinutes).toBe(120);
    expect(back?.stoppedAt).toEqual(at("11:00"));
    const stop = await db.attendanceEvent.findFirstOrThrow({ where: { type: "LOGOUT" } });
    expect(stop).toMatchObject({ source: "SYSTEM", at: at("11:00") });
    expect(stop.note).toMatch(/lid closed/);

    // Logging in again starts a new stretch and clears the notice.
    const again = await recordEvent(u, "LOGIN", null, at("12:31"));
    expect(again.summary.state).toBe("WORKING");
    expect(again.stoppedAt).toBeNull();
  });

  it("is noticed by the owners' board even if the laptop never comes back", async () => {
    const owner = await person("OWNER");
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await beatUntil(u, "09:00", "10:00");
    const board = await teamToday(owner, at("15:00"));
    expect(board.find((m) => m.userId === u.id)?.summary).toMatchObject({ state: "LOGGED_OUT", workedMinutes: 60 });
  });

  it("allows up to the grace period without stopping", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    const today = await getToday(u, new Date(at("09:00").getTime() + 3 * 60_000));
    expect(today.summary.state).toBe("WORKING");
    expect((await getToday(u, at("09:04"))).summary.state).toBe("LOGGED_OUT");
  });

  it("does not stop anyone during a break, and Resume restarts the clock", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await beatUntil(u, "09:00", "13:00");
    await recordEvent(u, "BREAK_START", null, at("13:00"));
    // Laptop shut over lunch.
    expect((await getToday(u, at("13:45"))).summary.state).toBe("ON_BREAK");
    const resumed = await recordEvent(u, "BREAK_END", null, at("13:50"));
    expect(resumed.summary.state).toBe("WORKING");
    expect((await getToday(u, at("13:52"))).summary.state).toBe("WORKING");
  });

  it("ignores check-ins from a phone", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await heartbeat(u, phone, at("09:02"));
    await heartbeat(u, phone, at("09:30"));
    expect((await getToday(u, at("09:31"))).summary).toMatchObject({ state: "LOGGED_OUT", workedMinutes: 0 });
  });

  it("ends a forgotten day at the last check-in, not at midnight", async () => {
    const u = await person();
    await recordEvent(u, "LOGIN", null, at("09:00"));
    await beatUntil(u, "09:00", "18:10");
    await closeOpenDays(at("23:59"));
    const logout = await db.attendanceEvent.findFirstOrThrow({ where: { type: "LOGOUT" } });
    expect(logout.at).toEqual(at("18:10"));
  });
});
