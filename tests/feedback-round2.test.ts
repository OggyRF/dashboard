import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dateFromKey, istDateTime } from "@/lib/dates";
import { recordEvent, saveWorkNote, workNotes } from "@/services/attendance";
import { login } from "@/services/auth";
import { channelView, getChatImage, postMessage } from "@/services/chat";
import { createClient } from "@/services/clients";
import { addActivity, addMonthActivity, clientMonth, monthPlan, setMonthQty } from "@/services/offpage";
import { updateOwnEmail } from "@/services/profile";
import { updateUser } from "@/services/users";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

// These tests jump hours between presses; keep the laptop-quiet stop out of the way.
vi.mock("@/lib/attendance/presence", async (original) => ({
  ...(await original<typeof import("@/lib/attendance/presence")>()),
  IDLE_STOP_MINUTES: 24 * 60,
}));

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const on = (day: string, time = "11:00") => istDateTime(day, time);

async function person(role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name = role.toLowerCase(), email?: string) {
  return asSessionUser((await makeUser({ role, name, email })).user);
}

async function setup() {
  const owner = await person("OWNER", "Aarif");
  const saad = await person("EXECUTION", "Saad");
  const huzaif = await person("OFFPAGE", "Huzaif");
  const client = await createClient(owner, { name: "IITB WashU", type: "SEO", executionOwnerId: saad.id, offpageOwnerId: huzaif.id }, null);
  return { owner, saad, huzaif, client };
}

describe("login email changes", () => {
  it("lets an owner fix a mistyped email, which then works for signing in", async () => {
    const owner = await person("OWNER");
    const itesh = await person("OFFPAGE", "Itesh", "itesh@gmial.com");
    await makeUser({ email: "taken@example.com" });
    await expect(updateUser(owner, itesh.id, { email: "Taken@Example.com" }, null)).rejects.toThrow(/already uses/);
    await updateUser(owner, itesh.id, { email: " Itesh@Gmail.com " }, null);
    expect((await db.user.findUniqueOrThrow({ where: { id: itesh.id } })).email).toBe("itesh@gmail.com");
    const r = await login({ email: "itesh@gmail.com", password: "correct horse battery", ip: null, userAgent: null });
    expect(r.ok).toBe(true);
    expect(await db.auditLog.count({ where: { action: "user.updated", entityId: itesh.id } })).toBe(1);
  });

  it("lets people change their own email with their password", async () => {
    const me = await person("EXECUTION", "Saad", "saad@old.com");
    await expect(updateOwnEmail(me, { email: "saad@new.com", password: "wrong password" }, null)).rejects.toThrow(/not correct/);
    await updateOwnEmail(me, { email: "saad@new.com", password: "correct horse battery" }, null);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).email).toBe("saad@new.com");
  });
});

describe("one month's off-page plan", () => {
  it("changes one month without touching the usual plan", async () => {
    const { owner, huzaif, client } = await setup();
    const now = on("2026-10-02");
    const a = await addActivity(owner, client.id, { name: "Image Submission", monthlyQty: 8, assigneeId: huzaif.id, applyNow: true }, null, now);
    // December gets 12, planned in October.
    await setMonthQty(owner, a.id, "2026-12", 12, null, now);
    expect((await monthPlan(owner, client.id, "2026-12")).map((r) => [r.name, r.usual, r.qty])).toEqual([["Image Submission", 8, 12]]);
    expect((await monthPlan(owner, client.id, "2026-11"))[0]!.qty).toBe(8);
    await expect(setMonthQty(owner, a.id, "2026-09", 3, null, now)).rejects.toThrow(/Past months/);
    // When December starts, its checklist has 12 boxes; January is back to 8.
    expect((await clientMonth(owner, client.id, "2026-12", on("2026-12-01"))).total.planned).toBe(12);
    expect((await clientMonth(owner, client.id, "2027-01", on("2027-01-01"))).total.planned).toBe(8);
  });

  it("changes the current month from this week on, keeping ticked boxes", async () => {
    const { owner, huzaif, client } = await setup();
    const a = await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 10, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-02"));
    const before = await clientMonth(owner, client.id, "2026-10", on("2026-10-09"));
    expect(before.weeks.map((w) => w.planned)).toEqual([3, 3, 2, 2]);
    // In week 2, cut October to 6: week 1 keeps its 3, the other 3 spread over weeks 2 to 4.
    await setMonthQty(owner, a.id, "2026-10", 6, null, on("2026-10-09"));
    const after = await clientMonth(owner, client.id, "2026-10", on("2026-10-09"));
    expect(after.weeks.map((w) => w.planned)).toEqual([3, 1, 1, 1]);
    expect(await db.offpageActivity.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ monthlyQty: 10 });
  });

  it("adds an extra activity to one month only", async () => {
    const { owner, huzaif, client } = await setup();
    await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 4, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-02"));
    await addMonthActivity(owner, client.id, "2026-10", { name: "Press Release", monthlyQty: 2, assigneeId: huzaif.id }, null, on("2026-10-02"));
    expect((await clientMonth(owner, client.id, "2026-10", on("2026-10-02"))).rows.map((r) => [r.activity.name, r.planned])).toEqual([["Guest Posting", 4], ["Press Release", 2]]);
    expect((await clientMonth(owner, client.id, "2026-11", on("2026-11-01"))).rows.map((r) => r.activity.name)).toEqual(["Guest Posting"]);
  });
});

describe("chat pictures and replies", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

  it("posts pictures, quotes a message and tells its author", async () => {
    const { owner, saad, client } = await setup();
    const channel = await db.channel.findUniqueOrThrow({ where: { clientId: client.id } });
    const first = await postMessage(saad, channel.id, "Draft for the guest post");
    await postMessage(owner, channel.id, "", null, new Date(), { replyToId: first.id, images: [{ bytes: jpeg, width: 800, height: 600 }] });
    await expect(postMessage(owner, channel.id, "", null)).rejects.toThrow(/Write a message/);
    await expect(postMessage(owner, channel.id, "x", null, new Date(), { images: [{ bytes: new Uint8Array([1, 2, 3, 4]) }] })).rejects.toThrow(/JPG, PNG or WebP/);
    const view = await channelView(saad, channel.id);
    const reply = view.messages.at(-1)!;
    expect(reply.images).toHaveLength(1);
    expect(reply.replyTo).toMatchObject({ id: first.id, author: "Saad", text: "Draft for the guest post" });
    expect(await db.notification.count({ where: { userId: saad.id, title: { contains: "replied to your message" } } })).toBe(1);
    // Only people on the channel can open the picture.
    const outsider = await person("EXECUTION", "Outsider");
    await expect(getChatImage(outsider, reply.images[0]!.id)).rejects.toThrow(/not found/);
    expect((await getChatImage(saad, reply.images[0]!.id)).contentType).toBe("image/jpeg");
  });

  it("offers the channel's tasks for # suggestions", async () => {
    const { owner, client } = await setup();
    const channel = await db.channel.findUniqueOrThrow({ where: { clientId: client.id } });
    await db.task.create({ data: { clientId: client.id, title: "AEO GEO" } });
    expect((await channelView(owner, channel.id)).tasks.map((t) => t.title)).toEqual(["AEO GEO"]);
  });
});

describe("work note at log out", () => {
  it("needs a note to log out and shows it to owners", async () => {
    const owner = await person("OWNER");
    const u = await person("OFFPAGE", "Huzaif");
    await recordEvent(u, "LOGIN", null, on("2026-10-06", "09:30"));
    await expect(recordEvent(u, "LOGOUT", null, on("2026-10-06", "18:00"))).rejects.toThrow(/few words/);
    await expect(recordEvent(u, "LOGOUT", null, on("2026-10-06", "18:00"), undefined, "done")).rejects.toThrow(/few words/);
    await recordEvent(u, "LOGOUT", null, on("2026-10-06", "18:00"), undefined, "3 guest posts for IITB, 2 web 2.0 for Printery");
    const notes = await workNotes(owner, "2026-10-06");
    expect(notes.find((n) => n.person.id === u.id)).toMatchObject({ present: true, note: "3 guest posts for IITB, 2 web 2.0 for Printery" });
    await expect(workNotes(u, "2026-10-06")).rejects.toThrow(/permission/);
  });

  it("lets people add a note later for a day the timer stopped on its own", async () => {
    const u = await person("EXECUTION");
    await db.attendanceDay.create({ data: { userId: u.id, date: dateFromKey("2026-10-05"), firstLoginAt: on("2026-10-05", "09:00") } });
    await saveWorkNote(u, "2026-10-05", "Keyword research for Cafe Bloom", null, on("2026-10-06"));
    expect((await db.attendanceDay.findFirstOrThrow({ where: { userId: u.id } })).workNote).toBe("Keyword research for Cafe Bloom");
    await expect(saveWorkNote(u, "2026-09-01", "Keyword research", null, on("2026-10-06"))).rejects.toThrow(/last 7 days/);
  });
});
