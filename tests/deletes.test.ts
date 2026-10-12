import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { createClient, deleteClient } from "@/services/clients";
import { completeUnit, ensureDailyPlan, removeDailyTask, startUnit } from "@/services/daily";
import { addActivity, deleteActivity, tickItem } from "@/services/offpage";
import { addTaskComment, createTask, deleteTask } from "@/services/tasks";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const on = (day: string) => istDateTime(day, "11:00");
const person = async (role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name: string) => asSessionUser((await makeUser({ role, name })).user);

async function setup() {
  const owner = await person("OWNER", "Aarif");
  const saad = await person("EXECUTION", "Saad");
  const huzaif = await person("OFFPAGE", "Huzaif");
  const client = await createClient(owner, { name: "IITB WashU", type: "SEO", executionOwnerId: saad.id }, null);
  return { owner, saad, huzaif, client };
}

describe("deleting", () => {
  it("lets owners delete a client with everything under it, once its name is typed", async () => {
    const { owner, saad, huzaif, client } = await setup();
    await addActivity(owner, client.id, { name: "Guest Posting", monthlyQty: 8, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-12"));
    await createTask(saad, { clientId: client.id, title: "Fix canonical tags", assigneeId: saad.id }, null);
    await expect(deleteClient(saad, client.id, "IITB WashU", null)).rejects.toThrow(/permission/);
    await expect(deleteClient(owner, client.id, "IITB", null)).rejects.toThrow(/Type the client's name/);
    await deleteClient(owner, client.id, " iitb washu ", null);
    expect(await db.client.count()).toBe(0);
    expect(await db.task.count()).toBe(0);
    expect(await db.offpageItem.count()).toBe(0);
    expect(await db.channel.count({ where: { clientId: { not: null } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "client.delete" } })).toBe(1);
  });

  it("lets owners delete an off-page activity with its boxes, ticked work and daily lines", async () => {
    const { owner, saad, huzaif, client } = await setup();
    const a = await addActivity(owner, client.id, { name: "Bookmarking", monthlyQty: 20, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-12"));
    const box = await db.offpageItem.findFirstOrThrow({ where: { activityId: a.id } });
    await tickItem(huzaif, box.id, "https://site.com/a", null, on("2026-10-12"));
    await ensureDailyPlan(huzaif.id, on("2026-10-13"));
    expect(await db.dailyTask.count({ where: { activityId: a.id } })).toBeGreaterThan(0);
    await expect(deleteActivity(saad, a.id, null)).rejects.toThrow(/permission/);
    await deleteActivity(owner, a.id, null);
    expect(await db.offpageActivity.count()).toBe(0);
    expect(await db.offpageItem.count()).toBe(0);
    expect(await db.dailyTask.count()).toBe(0);
  });

  it("lets owners and the task's creator delete a task with its chat", async () => {
    const { owner, saad, client } = await setup();
    const sohail = await person("EXECUTION", "Sohail");
    await db.clientAssignment.create({ data: { clientId: client.id, userId: sohail.id, responsibility: "EXECUTION" } });
    const t1 = await createTask(saad, { clientId: client.id, title: "Fix canonical tags", assigneeId: sohail.id }, null);
    await addTaskComment(sohail, t1.number, "On it");
    await expect(deleteTask(sohail, t1.number, null)).rejects.toThrow(/permission/);
    await deleteTask(saad, t1.number, null);
    const t2 = await createTask(saad, { clientId: client.id, title: "Write blog", assigneeId: sohail.id }, null);
    await deleteTask(owner, t2.number, null);
    expect(await db.task.count()).toBe(0);
    expect(await db.taskComment.count()).toBe(0);
  });

  it("lets owners remove a daily line even after work started", async () => {
    const { owner, saad, huzaif, client } = await setup();
    await addActivity(owner, client.id, { name: "Bookmarking", monthlyQty: 20, assigneeId: huzaif.id, applyNow: true }, null, on("2026-10-12"));
    await ensureDailyPlan(huzaif.id, on("2026-10-13"));
    const line = await db.dailyTask.findFirstOrThrow({ where: { assigneeId: huzaif.id } });
    await startUnit(huzaif, line.id, 1, null, on("2026-10-13"));
    await completeUnit(huzaif, line.id, 1, "https://bm.com/x", null, on("2026-10-13"));
    await expect(removeDailyTask(saad, line.id, null)).rejects.toThrow(/already started/);
    await removeDailyTask(owner, line.id, null);
    expect(await db.dailyTask.count({ where: { id: line.id } })).toBe(0);
  });
});
