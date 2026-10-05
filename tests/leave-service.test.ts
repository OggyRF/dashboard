import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dateFromKey } from "@/lib/dates";
import {
  addHoliday,
  applyForLeave,
  cancelLeave,
  decideLeave,
  leaveCalendar,
  listHolidays,
  myLeave,
  pendingLeave,
  updateHoliday,
} from "@/services/leave";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

// Monday 5 October 2026; 11 October is a Sunday.
const now = new Date("2026-10-05T06:00:00Z");

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function person(role: "OWNER" | "EXECUTION" | "OFFPAGE" = "EXECUTION", name?: string) {
  const { user } = await makeUser({ role, name });
  return asSessionUser(user);
}

const request = { fromDate: "2026-10-07", toDate: "2026-10-09", halfDay: false, type: "CASUAL" as const, reason: "family function" };

describe("applying for leave", () => {
  it("counts working days and notifies both owners", async () => {
    const a = await person("OWNER", "Aarif");
    const s = await person("OWNER", "Salman");
    const u = await person("EXECUTION", "Saad");

    const created = await applyForLeave(u, request, null, now);
    expect(Number(created.days)).toBe(3);
    expect(created.status).toBe("PENDING");

    const notified = await db.notification.findMany();
    expect(notified.map((n) => n.userId).sort()).toEqual([a.id, s.id].sort());
    expect(notified[0].title).toContain("Saad");
  });

  it("skips Sundays and holidays when counting days", async () => {
    const owner = await person("OWNER");
    const u = await person();
    await addHoliday(owner, { date: "2026-10-08", name: "Festival" }, null);
    // Wed 7 Oct to Mon 12 Oct: 6 calendar days, minus Thursday's holiday and Sunday = 4.
    const created = await applyForLeave(u, { ...request, toDate: "2026-10-12" }, null, now);
    expect(Number(created.days)).toBe(4);
  });

  it("records half a day", async () => {
    const u = await person();
    const created = await applyForLeave(u, { ...request, fromDate: "2026-10-07", toDate: "2026-10-07", halfDay: true }, null, now);
    expect(Number(created.days)).toBe(0.5);
  });

  it("refuses bad dates, all-holiday ranges and overlaps", async () => {
    const u = await person();
    await expect(applyForLeave(u, { ...request, fromDate: "2026-10-09", toDate: "2026-10-07" }, null, now)).rejects.toThrow(/end date is before/i);
    await expect(applyForLeave(u, { ...request, fromDate: "2026-10-11", toDate: "2026-10-11" }, null, now)).rejects.toThrow(/weekly offs or holidays/i);
    await expect(applyForLeave(u, { ...request, fromDate: "2026-08-01", toDate: "2026-08-02" }, null, now)).rejects.toThrow(/days back/i);
    await expect(applyForLeave(u, { ...request, reason: "x" }, null, now)).rejects.toThrow(/reason/i);

    await applyForLeave(u, request, null, now);
    await expect(applyForLeave(u, { ...request, fromDate: "2026-10-09", toDate: "2026-10-13" }, null, now)).rejects.toThrow(/already have leave/i);
  });

  it("lets a pending request be cancelled by its owner only", async () => {
    const u = await person();
    const other = await person();
    const r = await applyForLeave(u, request, null, now);
    await expect(cancelLeave(other, r.id, null)).rejects.toThrow(/not found/i);
    await cancelLeave(u, r.id, null);
    expect((await myLeave(u))[0].status).toBe("CANCELLED");
    // The dates are free again.
    await expect(applyForLeave(u, request, null, now)).resolves.toBeTruthy();
  });
});

describe("deciding leave", () => {
  it("approves, notifies the person and writes an audit row", async () => {
    const owner = await person("OWNER", "Aarif");
    const u = await person("EXECUTION", "Sohail");
    const r = await applyForLeave(u, request, null, now);
    await db.notification.deleteMany();

    await decideLeave(owner, r.id, { approve: true }, null);

    const updated = await db.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(updated).toMatchObject({ status: "APPROVED", decidedById: owner.id });
    const note = await db.notification.findFirstOrThrow();
    expect(note).toMatchObject({ userId: u.id });
    expect(note.title).toContain("approved");
    await expect(db.auditLog.findFirstOrThrow({ where: { action: "leave.approved" } })).resolves.toBeTruthy();
  });

  it("needs a note to reject", async () => {
    const owner = await person("OWNER");
    const u = await person();
    const r = await applyForLeave(u, request, null, now);
    await expect(decideLeave(owner, r.id, { approve: false }, null)).rejects.toThrow(/why it is rejected/i);
    await decideLeave(owner, r.id, { approve: false, note: "too many people away" }, null);
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: r.id } })).decisionNote).toBe("too many people away");
  });

  it("is refused for non-owners, for your own leave, and twice", async () => {
    const owner = await person("OWNER");
    const other = await person("OWNER");
    const u = await person();
    const r = await applyForLeave(u, request, null, now);

    await expect(decideLeave(u, r.id, { approve: true }, null)).rejects.toThrow(/permission/);
    const own = await applyForLeave(owner, { ...request, fromDate: "2026-10-14", toDate: "2026-10-14" }, null, now);
    await expect(decideLeave(owner, own.id, { approve: true }, null)).rejects.toThrow(/other owner/i);

    await decideLeave(owner, r.id, { approve: true }, null);
    await expect(decideLeave(other, r.id, { approve: false, note: "changed mind" }, null)).rejects.toThrow(/already been decided/i);
  });

  it("shows owners the queue and members only their own", async () => {
    const owner = await person("OWNER");
    const u = await person();
    await applyForLeave(u, request, null, now);
    expect(await pendingLeave(owner)).toHaveLength(1);
    await expect(pendingLeave(u)).rejects.toThrow(/permission/);
    expect(await myLeave(owner)).toHaveLength(0);
  });
});

describe("the calendar", () => {
  it("gives owners everyone's leave and members only their own", async () => {
    const owner = await person("OWNER");
    const u = await person("EXECUTION", "Huzaif");
    await applyForLeave(u, request, null, now);
    await addHoliday(owner, { date: "2026-10-20", name: "Diwali" }, null);

    const ownerView = await leaveCalendar(owner, "2026-10");
    expect(ownerView.entries.map((e) => e.key)).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(ownerView.entries[0]).toMatchObject({ name: "Huzaif", status: "PENDING", mine: false });
    expect(ownerView.holidays).toEqual([{ key: "2026-10-20", name: "Diwali" }]);

    const otherMember = await person();
    expect((await leaveCalendar(otherMember, "2026-10")).entries).toHaveLength(0);
    expect((await leaveCalendar(u, "2026-10")).entries[0]).toMatchObject({ mine: true });
  });

  it("shows only the days of a range that fall in the month", async () => {
    const u = await person();
    await db.leaveRequest.create({
      data: {
        userId: u.id,
        fromDate: dateFromKey("2026-09-29"),
        toDate: dateFromKey("2026-10-02"),
        days: 3,
        type: "CASUAL",
        reason: "trip",
        status: "APPROVED",
      },
    });
    const october = await leaveCalendar(u, "2026-10");
    expect(october.entries.map((e) => e.key)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("holidays", () => {
  it("lets owners edit a holiday's date and name, without clashing", async () => {
    const { user } = await makeUser({ role: "OWNER" });
    const owner = asSessionUser(user);
    await addHoliday(owner, { date: "2026-11-08", name: "Diwali" }, null);
    await addHoliday(owner, { date: "2026-11-24", name: "Guru Nanak Jayanti" }, null);
    const diwali = await db.holiday.findFirstOrThrow({ where: { name: "Diwali" } });

    await updateHoliday(owner, diwali.id, { date: "2026-11-09", name: "Diwali (Govardhan Puja)" }, null);
    expect(await listHolidays("2026-01-01")).toEqual([
      { id: diwali.id, key: "2026-11-09", name: "Diwali (Govardhan Puja)" },
      expect.objectContaining({ key: "2026-11-24" }),
    ]);
    await expect(updateHoliday(owner, diwali.id, { date: "2026-11-24", name: "Clash" }, null)).rejects.toMatchObject({ code: "CONFLICT" });
    const member = asSessionUser((await makeUser({ role: "EXECUTION" })).user);
    await expect(updateHoliday(member, diwali.id, { date: "2026-11-10", name: "x y" }, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
