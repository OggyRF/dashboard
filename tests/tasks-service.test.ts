import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { accessTo, createClient } from "@/services/clients";
import { addTaskComment, changeTaskStatus, createTask, getTask, listTasks, notifyOverdueTasks, taskCounts, taskSuggestions, updateTask } from "@/services/tasks";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function person(role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name = role.toLowerCase()) {
  return asSessionUser((await makeUser({ role, name })).user);
}

async function setup() {
  const owner = await person("OWNER", "Aarif");
  const sameer = await person("STRATEGY", "Sameer");
  const saad = await person("EXECUTION", "Saad");
  const sohail = await person("EXECUTION", "Sohail");
  const client = await createClient(owner, { name: "IITB WashU", type: "SEO", strategicOwnerId: sameer.id }, null);
  return { owner, sameer, saad, sohail, client };
}

describe("tasks", () => {
  it("goes Not started → Under process → Completed, moved by the doer", async () => {
    const { sameer, saad, sohail, client } = await setup();
    const t = await createTask(sameer, { clientId: client.id, title: "Fix canonical tags", category: "RESEARCH", assigneeId: saad.id, followUpId: sohail.id, dueDate: "2026-10-10" }, null);
    expect(t.number).toBe(1);
    // Saad was added to the client so he can see it.
    expect(await accessTo(saad, client.id)).toBe("full");
    expect(await db.notification.count({ where: { userId: saad.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: sohail.id, title: { contains: "follow up" } } })).toBe(1);

    expect((await getTask(saad, 1)).actions).toEqual(["progress", "complete"]);
    // The follow-up person can mark it done but not move it along.
    expect((await getTask(sohail, 1)).actions).toEqual(["complete"]);
    await changeTaskStatus(saad, 1, "progress", "", null);
    expect((await getTask(saad, 1)).actions).toEqual(["complete"]);
    await changeTaskStatus(saad, 1, "complete", "", null);
    const task = await db.task.findUniqueOrThrow({ where: { number: 1 } });
    expect(task.status).toBe("COMPLETED");
    expect(task.completedAt).not.toBeNull();
    // The follow-up person and the creator hear it is done.
    expect(await db.notification.count({ where: { userId: sohail.id, title: { contains: "completed" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: sameer.id, title: { contains: "completed" } } })).toBe(1);
    expect((await getTask(sohail, 1)).actions).toEqual(["reopen"]);
    await changeTaskStatus(sohail, 1, "reopen", "", null);
    expect((await db.task.findUniqueOrThrow({ where: { number: 1 } })).status).toBe("IN_PROGRESS");
    const { history } = await getTask(sameer, 1);
    expect(history.map((h) => h.type)).toEqual(["task.created", "task.progress", "task.complete", "task.reopen"]);
  });

  it("gives other people no buttons", async () => {
    const { sameer, saad, sohail, client } = await setup();
    await createTask(sameer, { clientId: client.id, title: "Write blog", assigneeId: saad.id }, null);
    await db.clientAssignment.create({ data: { clientId: client.id, userId: sohail.id, responsibility: "EXECUTION" } });
    expect((await getTask(sohail, 1)).actions).toEqual([]);
    await expect(changeTaskStatus(sohail, 1, "complete", "", null)).rejects.toThrow(/not available/);
  });

  it("refuses the same person as doer and follow-up, and off-page staff as either", async () => {
    const { sameer, saad, client } = await setup();
    const offpage = await person("OFFPAGE");
    await expect(createTask(sameer, { clientId: client.id, title: "Xyz task", assigneeId: saad.id, followUpId: saad.id }, null)).rejects.toThrow(/someone other/);
    await expect(createTask(sameer, { clientId: client.id, title: "Xyz task", assigneeId: offpage.id }, null)).rejects.toThrow(/owner, strategy or execution/);
    await expect(createTask(offpage, { clientId: client.id, title: "Xyz task" }, null)).rejects.toThrow(/permission/);
  });

  it("keeps tasks of other clients hidden from execution staff", async () => {
    const { owner, saad, client } = await setup();
    await createTask(owner, { clientId: client.id, title: "Hidden task" }, null);
    await expect(getTask(saad, 1)).rejects.toThrow(/not found/);
    await expect(createTask(saad, { clientId: client.id, title: "Sneaky" }, null)).rejects.toThrow(/not found/);
    expect(await listTasks(saad, { view: "all" })).toHaveLength(0);
  });

  it("lists my, follow-up and overdue tasks", async () => {
    const { sameer, saad, sohail, client } = await setup();
    const now = istDateTime("2026-10-12", "10:00");
    await createTask(sameer, { clientId: client.id, title: "Late one", assigneeId: saad.id, dueDate: "2026-10-10" }, null);
    await createTask(sameer, { clientId: client.id, title: "Future one", assigneeId: saad.id, followUpId: sohail.id, dueDate: "2026-10-20" }, null);
    expect((await listTasks(saad, { view: "mine" }, now)).map((t) => [t.title, t.overdue])).toEqual([["Late one", true], ["Future one", false]]);
    expect((await listTasks(saad, { view: "mine", status: "overdue" }, now)).map((t) => t.title)).toEqual(["Late one"]);
    expect((await listTasks(sohail, { view: "followup" }, now)).map((t) => t.title)).toEqual(["Future one"]);
    expect(await taskCounts(saad, now)).toEqual({ mine: 2, overdue: 1, followUp: 0 });
    expect(await taskCounts(sohail, now)).toEqual({ mine: 0, overdue: 0, followUp: 1 });
  });

  it("alerts the client's team and the owners once when a task goes past its due date", async () => {
    const { owner, sameer, saad, sohail, client } = await setup();
    const other = await person("EXECUTION", "Afroz");
    await createTask(sameer, { clientId: client.id, title: "Keyword research", assigneeId: saad.id, followUpId: sohail.id, dueDate: "2026-10-10" }, null);
    await createTask(sameer, { clientId: client.id, title: "Not due yet", assigneeId: saad.id, dueDate: "2026-10-11" }, null);
    await db.notification.deleteMany();
    expect(await notifyOverdueTasks(istDateTime("2026-10-10", "20:00"))).toBe(0);
    expect(await notifyOverdueTasks(istDateTime("2026-10-11", "01:00"))).toBe(1);
    const told = (await db.notification.findMany({ where: { title: { startsWith: "Overdue" } } })).map((n) => n.userId).sort();
    expect(told).toEqual([owner.id, sameer.id, saad.id, sohail.id].sort());
    expect(told).not.toContain(other.id);
    // Only once, until the due date changes.
    expect(await notifyOverdueTasks(istDateTime("2026-10-11", "09:00"))).toBe(0);
    await updateTask(sameer, 1, { title: "Keyword research", assigneeId: saad.id, followUpId: sohail.id, dueDate: "2026-10-10" }, null);
    expect(await notifyOverdueTasks(istDateTime("2026-10-11", "10:00"))).toBe(0);
    await updateTask(sameer, 1, { title: "Keyword research", assigneeId: saad.id, followUpId: sohail.id, dueDate: "2026-10-11" }, null);
    expect(await notifyOverdueTasks(istDateTime("2026-10-12", "01:00"))).toBe(2);
  });

  it("edits a task, notifies a new assignee, and has a chat owners can join", async () => {
    const { owner, sameer, saad, sohail, client } = await setup();
    await createTask(sameer, { clientId: client.id, title: "Old title", assigneeId: saad.id }, null);
    await updateTask(sameer, 1, { title: "New title", assigneeId: sohail.id, priority: "HIGH" }, null);
    expect(await db.notification.count({ where: { userId: sohail.id } })).toBe(1);
    await addTaskComment(sohail, 1, "On it");
    // The owner is not on the client's team but can still write.
    await addTaskComment(owner, 1, "Please finish by Friday");
    expect((await getTask(sameer, 1)).comments.map((c) => c.body)).toEqual(["On it", "Please finish by Friday"]);
    expect(await db.notification.count({ where: { userId: sameer.id, title: { contains: "on #1" } } })).toBe(2);
    expect(await db.notification.count({ where: { userId: sohail.id, title: { contains: "Please finish" } } })).toBe(1);
    // Execution staff not on the client cannot.
    const outsider = await person("EXECUTION", "Outsider");
    await expect(addTaskComment(outsider, 1, "hi")).rejects.toThrow(/not found/);
  });

  it("suggests tasks for # in chat, latest change first", async () => {
    const { sameer, client } = await setup();
    await createTask(sameer, { clientId: client.id, title: "AEO GEO" }, null);
    await createTask(sameer, { clientId: client.id, title: "Keyword research" }, null);
    await addTaskComment(sameer, 1, "update");
    expect((await taskSuggestions(sameer, client.id)).map((t) => t.number)).toEqual([1, 2]);
  });
});
