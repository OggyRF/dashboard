import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { createClient, getClient, listClients } from "@/services/clients";
import { addDailyTask, completeUnit, dayBoard, ensureDailyPlan, myDay, removeDailyTask, startUnit, undoUnit } from "@/services/daily";
import { applyForLeave, cancelLeave, decideLeave } from "@/services/leave";
import { addActivity, rejectItem, teamOverview } from "@/services/offpage";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const on = (day: string, time = "11:00") => istDateTime(day, time);

async function person(role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name = role.toLowerCase()) {
  return asSessionUser((await makeUser({ role, name })).user);
}

describe("cancelling leave", () => {
  it("lets people cancel a waiting request, or approved leave that has not started", async () => {
    const aarif = await person("OWNER", "Aarif");
    const salman = await person("OWNER", "Salman");
    const uzma = await person("OFFPAGE", "Uzma");
    const now = on("2026-10-06");
    const waiting = await applyForLeave(uzma, { fromDate: "2026-10-12", toDate: "2026-10-12", halfDay: false, type: "CASUAL", reason: "Family function" }, null, now);
    await cancelLeave(uzma, waiting.id, null, now);
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("CANCELLED");

    const approved = await applyForLeave(uzma, { fromDate: "2026-10-14", toDate: "2026-10-15", halfDay: false, type: "CASUAL", reason: "Trip home" }, null, now);
    await decideLeave(aarif, approved.id, { approve: true }, null);
    await expect(cancelLeave(salman, approved.id, null, now)).rejects.toThrow(/not found/i);
    // Once it has started it stays.
    await expect(cancelLeave(uzma, approved.id, null, on("2026-10-15"))).rejects.toThrow(/already started/);
    const r = await cancelLeave(uzma, approved.id, null, now);
    expect(r.wasApproved).toBe(true);
    expect(await db.notification.count({ where: { title: { contains: "Uzma cancelled approved leave" } } })).toBe(2);
    await expect(cancelLeave(uzma, approved.id, null, now)).rejects.toThrow(/already closed/);
  });
});

describe("automatic daily plan", () => {
  async function setup() {
    const owner = await person("OWNER", "Aarif");
    const sohail = await person("EXECUTION", "Sohail");
    const uzma = await person("OFFPAGE", "Uzma");
    const now = on("2026-10-06");
    const iitb = await createClient(owner, { name: "IIT Bombay", type: "SEO", executionOwnerId: sohail.id, offpageOwnerId: uzma.id }, null);
    const printery = await createClient(owner, { name: "Printery", type: "SEO", executionOwnerId: sohail.id, offpageOwnerId: uzma.id }, null);
    const gp = await addActivity(owner, iitb.id, { name: "Guest Posting", monthlyQty: 8, assigneeId: uzma.id, applyNow: true }, null, now);
    await addActivity(owner, printery.id, { name: "Guest Posting", monthlyQty: 8, assigneeId: uzma.id, applyNow: true }, null, now);
    const bookmarks = await addActivity(owner, iitb.id, { name: "Social Bookmarking", monthlyQty: 12, assigneeId: uzma.id, applyNow: true }, null, now);
    return { owner, sohail, uzma, iitb, printery, gp, bookmarks, now };
  }
  const summary = (day: Awaited<ReturnType<typeof myDay>>) =>
    day.clients.map((g) => [g.client.name, g.lines.map((l) => `${l.heading} ×${l.qty}${l.carried ? " (carried)" : ""}`)]);

  it("splits each client's monthly off-page work into today's list, writing before uploading", async () => {
    const { uzma, sohail, now } = await setup();
    const day = await myDay(uzma, "2026-10-06", now);
    // Week 1 (1st to 7th) has 2 guest posts and 3 bookmarks; the 6th is its 5th working day of 6.
    expect(summary(day)).toEqual([
      ["IIT Bombay", ["Guest Posting · Writing ×2", "Guest Posting · Uploading ×2", "Social Bookmarking · Uploading ×3"]],
      ["Printery", ["Guest Posting · Writing ×2", "Guest Posting · Uploading ×2"]],
    ]);
    expect(day.clients[0]!.lines.every((l) => l.auto && l.followUp?.id === sohail.id)).toBe(true);
    // Made once a day: opening the page again changes nothing.
    expect(await ensureDailyPlan(uzma.id, now)).toBe(false);
    expect(summary(await myDay(uzma, "2026-10-06", now))).toEqual(summary(day));
  });

  it("folds unstarted work into the next day, keeping pieces already being worked on", async () => {
    const { uzma } = await setup();
    const day = await myDay(uzma, "2026-10-06", on("2026-10-06"));
    const write = day.clients[0]!.lines.find((l) => l.heading === "Guest Posting · Writing")!;
    await startUnit(uzma, write.id, 1, null, on("2026-10-06"));
    await completeUnit(uzma, write.id, 2, "", null, on("2026-10-06"));
    const next = await myDay(uzma, "2026-10-07", on("2026-10-07"));
    // Yesterday's writing line keeps its two started pieces (one done, one in progress); the uploads, never started, are re-planned today.
    expect(summary(next)[0]).toEqual([
      "IIT Bombay",
      ["Guest Posting · Writing ×2 (carried)", "Guest Posting · Writing ×1", "Guest Posting · Uploading ×2", "Social Bookmarking · Uploading ×3"],
    ]);
    expect(await db.dailyTask.count({ where: { date: new Date("2026-10-06"), work: "UPLOADING" } })).toBe(0);
  });

  it("skips Sundays and days on leave", async () => {
    const { uzma, owner } = await setup();
    expect((await myDay(uzma, "2026-10-11", on("2026-10-11"))).clients).toEqual([]);
    const leave = await applyForLeave(uzma, { fromDate: "2026-10-13", toDate: "2026-10-13", halfDay: false, type: "SICK", reason: "Doctor visit" }, null, on("2026-10-06"));
    await decideLeave(owner, leave.id, { approve: true }, null);
    expect((await myDay(uzma, "2026-10-13", on("2026-10-13"))).clients).toEqual([]);
  });
});

describe("working through a daily list", () => {
  it("marks pieces working then completed, ticks the checklist for uploads and tells the follow-up", async () => {
    const owner = await person("OWNER", "Aarif");
    const sohail = await person("EXECUTION", "Sohail");
    const uzma = await person("OFFPAGE", "Uzma");
    const client = await createClient(owner, { name: "IIT Bombay", type: "SEO", executionOwnerId: sohail.id }, null);
    const now = on("2026-10-06");
    const gp = await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 4, applyNow: true }, null, now);
    const line = await addDailyTask(sohail, { date: "2026-10-06", assigneeId: uzma.id, clientId: client.id, work: "UPLOADING", activityId: gp.id, qty: 2 }, null, now);
    expect(line.followUp?.id).toBe(sohail.id);

    await startUnit(uzma, line.id, 1, null, now);
    await expect(startUnit(uzma, line.id, 1, null, now)).rejects.toThrow(/already started/);
    await expect(completeUnit(uzma, line.id, 1, "", null, now)).rejects.toThrow(/live link/);
    const r = await completeUnit(uzma, line.id, 1, "guestblog.com/a", null, now);
    expect(r.linked).toBe(true);
    expect(await db.offpageItem.count({ where: { doneAt: { not: null }, proofUrl: "https://guestblog.com/a" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: sohail.id, title: { contains: "finished" } } })).toBe(0);
    await completeUnit(uzma, line.id, 2, "https://guestblog.com/b", null, now);
    expect(await db.notification.count({ where: { userId: sohail.id, title: { contains: "Uzma finished Upload 2 Guest Posting for IIT Bombay" } } })).toBe(1);

    // Sending a box back puts its piece back to working.
    const box = await db.offpageItem.findFirstOrThrow({ where: { proofUrl: "https://guestblog.com/b" } });
    await rejectItem(sohail, box.id, "The link is not live", null, now);
    let units = (await dayBoard(sohail, "2026-10-06", now))[0]!.tasks[0]!.units;
    expect(units.map((u) => u.status)).toEqual(["DONE", "WORKING"]);

    // Undo steps back one state at a time and unticks the checklist.
    await undoUnit(uzma, units[0]!.tickId!, null);
    expect(await db.offpageItem.count({ where: { doneAt: { not: null } } })).toBe(0);
    units = (await dayBoard(sohail, "2026-10-06", now))[0]!.tasks[0]!.units;
    expect(units.map((u) => u.status)).toEqual(["WORKING", "WORKING"]);
    await undoUnit(uzma, units[0]!.tickId!, null);
    await expect(removeDailyTask(sohail, line.id, null)).rejects.toThrow(/already started/);
  });

  it("lets leads add extra work for the off-page team with someone to follow up", async () => {
    const owner = await person("OWNER", "Aarif");
    const sameer = await person("STRATEGY", "Sameer");
    const uzma = await person("OFFPAGE", "Uzma");
    const client = await createClient(owner, { name: "Cafe Bloom", type: "GMB" }, null);
    const now = on("2026-10-06");
    const t = await addDailyTask(sameer, { date: "2026-10-06", assigneeId: uzma.id, clientId: client.id, work: "OTHER", qty: 1, details: "Reply to GMB reviews" }, null, now);
    // No project manager on the client, so whoever added it follows up.
    expect(t.followUp?.id).toBe(sameer.id);
    await expect(addDailyTask(sameer, { date: "2026-10-06", assigneeId: uzma.id, clientId: client.id, work: "OTHER", qty: 1, details: "SERP update", followUpId: uzma.id }, null, now)).rejects.toThrow(/follow up/);
    const t2 = await addDailyTask(sameer, { date: "2026-10-06", assigneeId: uzma.id, clientId: client.id, work: "OTHER", qty: 1, details: "SERP update", followUpId: owner.id }, null, now);
    expect(t2.followUp?.id).toBe(owner.id);
    await completeUnit(uzma, t.id, 1, "", null, now);
    const day = await myDay(uzma, "2026-10-06", now);
    expect(day.clients[0]!.lines.map((l) => [l.heading, l.done])).toEqual([["Reply to GMB reviews", 1], ["SERP update", 0]]);
    await expect(addDailyTask(uzma, { date: "2026-10-06", assigneeId: uzma.id, clientId: client.id, work: "OTHER", qty: 1, details: "x" }, null)).rejects.toThrow(/permission/);
  });
});

describe("off-page staff and clients", () => {
  it("shows off-page staff their own clients, read only", async () => {
    const owner = await person("OWNER", "Aarif");
    const uzma = await person("OFFPAGE", "Uzma");
    const mine = await createClient(owner, { name: "IIT Bombay", type: "SEO", offpageOwnerId: uzma.id }, null);
    const other = await createClient(owner, { name: "Printery", type: "SEO" }, null);
    expect((await listClients(uzma)).map((c) => c.name)).toEqual(["IIT Bombay"]);
    expect((await getClient(uzma, mine.id)).access).toBe("offpage");
    await expect(getClient(uzma, other.id)).rejects.toThrow(/not found/i);
    const now = on("2026-10-06");
    await addActivity(owner, mine.id, { name: "Guest Posting", monthlyQty: 4, assigneeId: uzma.id, applyNow: true }, null, now);
    await addActivity(owner, other.id, { name: "Guest Posting", monthlyQty: 4, applyNow: true }, null, now);
    const overview = await teamOverview(uzma, now);
    expect(overview.clients.map((c) => [c.client.name, c.openForMe])).toEqual([["IIT Bombay", 4]]);
    expect((await teamOverview(owner, now)).clients).toHaveLength(2);
  });
});
