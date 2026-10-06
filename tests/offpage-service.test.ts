import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { createClient } from "@/services/clients";
import {
  addActivity,
  clientMonth,
  copyActivities,
  myWeek,
  rejectItem,
  removeActivity,
  splitQuantity,
  teamOverview,
  tickItem,
  untickItem,
  updateActivity,
  weekOfDay,
} from "@/services/offpage";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const on = (day: string) => istDateTime(day, "11:00");

async function person(role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name = role.toLowerCase()) {
  return asSessionUser((await makeUser({ role, name })).user);
}

async function setup() {
  const owner = await person("OWNER", "Aarif");
  const saad = await person("EXECUTION", "Saad");
  const huzaif = await person("OFFPAGE", "Huzaif");
  const client = await createClient(owner, { name: "IITB WashU", type: "SEO", executionOwnerId: saad.id }, null);
  return { owner, saad, huzaif, client };
}

describe("week maths", () => {
  it("splits a month's quantity with the remainder in the earliest weeks", () => {
    expect(splitQuantity(10)).toEqual([3, 3, 2, 2]);
    expect(splitQuantity(5)).toEqual([2, 1, 1, 1]);
    expect(splitQuantity(20)).toEqual([5, 5, 5, 5]);
    expect(splitQuantity(1)).toEqual([1, 0, 0, 0]);
  });
  it("puts days into weeks 1-4", () => {
    expect(["2026-10-01", "2026-10-07", "2026-10-08", "2026-10-21", "2026-10-22", "2026-10-31"].map(weekOfDay)).toEqual([1, 1, 2, 3, 4, 4]);
  });
});

describe("off-page checklist", () => {
  it("turns the plan into weekly boxes and tracks progress", async () => {
    const { owner, huzaif, client } = await setup();
    const now = on("2026-10-06");
    await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 10, assigneeId: huzaif.id, reviewerId: "", applyNow: true }, null, now);
    await addActivity(owner, client.id, { name: "Reddit Post", monthlyQty: 5, assigneeId: huzaif.id, applyNow: true }, null, now);
    let view = await clientMonth(owner, client.id, "2026-10", now);
    expect(view.weeks.map((w) => w.planned)).toEqual([5, 4, 3, 3]);
    expect(view.total).toEqual({ done: 0, planned: 15 });
    // Huzaif was added to the client's team and sees his week.
    const week = await myWeek(huzaif, now);
    expect(week.progress).toEqual({ done: 0, planned: 5 });
    const first = week.groups[0]!.thisWeek[0]!;
    await tickItem(huzaif, first.id, "example.com/post", null, now);
    view = await clientMonth(huzaif, client.id, "2026-10", now);
    expect(view.weeks[0]).toMatchObject({ done: 1, planned: 5 });
    const ticked = view.rows.flatMap((r) => r.weeks.flat()).find((i) => i.id === first.id)!;
    expect(ticked.proofUrl).toBe("https://example.com/post");
    expect(ticked.doneBy?.id).toBe(huzaif.id);
  });

  it("makes a month's plan only once, and a mid-month plan starts from the current week", async () => {
    const { owner, huzaif, client } = await setup();
    await addActivity(owner, client.id, { name: "Web 2.0", monthlyQty: 10, assigneeId: huzaif.id }, null, on("2026-10-16"));
    const view = await clientMonth(owner, client.id, "2026-10", on("2026-10-16"));
    expect(view.weeks.map((w) => w.planned)).toEqual([0, 0, 2, 2]);
    await clientMonth(owner, client.id, "2026-10", on("2026-10-17"));
    expect(await db.offpageItem.count()).toBe(4);
    // Next month starts in full.
    const nov = await clientMonth(owner, client.id, "2026-11", on("2026-11-02"));
    expect(nov.weeks.map((w) => w.planned)).toEqual([3, 3, 2, 2]);
  });

  it("applies plan changes to this month only when asked, from the current week on", async () => {
    const { owner, huzaif, client } = await setup();
    const a = await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 8, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-02"));
    // Tick one week-2 box, then cut the quantity during week 2.
    const wk2 = await db.offpageItem.findFirstOrThrow({ where: { activityId: a.id, week: 2 } });
    await tickItem(huzaif, wk2.id, "", null, on("2026-10-09"));
    await updateActivity(owner, a.id, { name: "Guest Posting", monthlyQty: 4, assigneeId: huzaif.id }, null, on("2026-10-09"));
    expect((await clientMonth(owner, client.id, "2026-10", on("2026-10-09"))).weeks.map((w) => w.planned)).toEqual([2, 2, 2, 2]);
    await updateActivity(owner, a.id, { name: "Guest Posting", monthlyQty: 4, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-09"));
    const view = await clientMonth(owner, client.id, "2026-10", on("2026-10-09"));
    // Week 1 is history; week 2 keeps its ticked box; weeks 3-4 shrink to 1.
    expect(view.weeks.map((w) => w.planned)).toEqual([2, 1, 1, 1]);
    expect(view.weeks[1]!.done).toBe(1);
    await removeActivity(owner, a.id, true, null, on("2026-10-16"));
    expect((await clientMonth(owner, client.id, "2026-10", on("2026-10-16"))).weeks.map((w) => w.planned)).toEqual([2, 1, 0, 0]);
  });

  it("lets off-page staff tick only their own boxes", async () => {
    const { owner, huzaif, client } = await setup();
    const other = await person("OFFPAGE", "Fareen");
    const now = on("2026-10-06");
    await addActivity(owner, client.id, { name: "Quora Answers", monthlyQty: 4, assigneeId: huzaif.id, applyNow: true }, null, now);
    await addActivity(owner, client.id, { name: "Images", monthlyQty: 4, assigneeId: other.id, applyNow: true }, null, now);
    const fareens = await db.offpageItem.findFirstOrThrow({ where: { assigneeId: other.id } });
    await expect(tickItem(huzaif, fareens.id, "", null, now)).rejects.toThrow(/permission/);
    const outsider = await person("OFFPAGE", "Itesh");
    await expect(tickItem(outsider, fareens.id, "", null, now)).rejects.toThrow(/not found/);
    await expect(clientMonth(outsider, client.id, "2026-10", now)).rejects.toThrow(/not found/);
  });

  it("lets the execution lead send work back with a reason, and tells the doer", async () => {
    const { owner, saad, huzaif, client } = await setup();
    const now = on("2026-10-06");
    await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 4, assigneeId: huzaif.id, applyNow: true }, null, now);
    const item = await db.offpageItem.findFirstOrThrow();
    await tickItem(huzaif, item.id, "https://site.com/a", null, now);
    await expect(rejectItem(huzaif, item.id, "nope", null, now)).rejects.toThrow(/permission/);
    const other = await person("EXECUTION", "Sohail");
    await expect(rejectItem(other, item.id, "Link is nofollow", null, now)).rejects.toThrow(/not found/);
    await rejectItem(saad, item.id, "Link is nofollow", null, now);
    const back = await db.offpageItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(back).toMatchObject({ doneAt: null, rejectReason: "Link is nofollow", rejectedById: saad.id });
    expect((await db.notification.findFirstOrThrow({ where: { userId: huzaif.id } })).title).toMatch(/sent back Guest Posting/);
    // Ticking again clears the rejection.
    await tickItem(huzaif, item.id, "https://site.com/b", null, now);
    expect((await db.offpageItem.findUniqueOrThrow({ where: { id: item.id } })).rejectReason).toBeNull();
    await untickItem(huzaif, item.id, null);
    expect((await db.offpageItem.findUniqueOrThrow({ where: { id: item.id } })).doneAt).toBeNull();
  });

  it("shows left-over boxes from earlier weeks and flags clients behind plan", async () => {
    const { owner, huzaif, client } = await setup();
    await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 8, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-02"));
    const week = await myWeek(huzaif, on("2026-10-10"));
    expect(week.week).toBe(2);
    expect(week.leftOver).toBe(2);
    expect(week.progress.planned).toBe(2);
    const overview = await teamOverview(owner, on("2026-10-10"));
    expect(overview.clients[0]).toMatchObject({ thisWeek: { week: 2, planned: 2, done: 0 }, behind: [{ week: 1, missing: 2 }] });
    // Off-page staff see only their own clients.
    expect((await teamOverview(huzaif, on("2026-10-10"))).clients.map((c) => c.client.id)).toEqual((await db.clientAssignment.findMany({ where: { userId: huzaif.id } })).map((a) => a.clientId));
  });

  it("copies a package of activities from another client", async () => {
    const { owner, huzaif, client } = await setup();
    const now = on("2026-10-06");
    await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 10, assigneeId: huzaif.id }, null, now);
    await addActivity(owner, client.id, { name: "Web 2.0", monthlyQty: 10 }, null, now);
    const other = await createClient(owner, { name: "Second", type: "SEO" }, null);
    expect(await copyActivities(owner, client.id, other.id, null, now)).toBe(2);
    expect((await clientMonth(owner, other.id, "2026-10", now)).total.planned).toBe(20);
  });

  it("does not plan paused clients", async () => {
    const { owner, huzaif, client } = await setup();
    await db.client.update({ where: { id: client.id }, data: { status: "PAUSED" } });
    await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 10, assigneeId: huzaif.id }, null, on("2026-10-06"));
    expect((await clientMonth(owner, client.id, "2026-10", on("2026-10-06"))).total.planned).toBe(0);
  });
});
