import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { accessTo, createClient } from "@/services/clients";
import { addTaskComment, changeTaskStatus, createTask, getTask, listTasks, taskCounts, updateTask } from "@/services/tasks";
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
  it("runs the full workflow with QA by someone else", async () => {
    const { sameer, saad, sohail, client } = await setup();
    const t = await createTask(sameer, { clientId: client.id, title: "Fix canonical tags", category: "TECHNICAL", assigneeId: saad.id, reviewerId: sohail.id, dueDate: "2026-10-10" }, null);
    expect(t.number).toBe(1);
    // Saad was added to the client so he can see it.
    expect(await accessTo(saad, client.id)).toBe("full");
    expect(await db.notification.count({ where: { userId: saad.id } })).toBe(1);

    expect((await getTask(saad, 1)).actions).toEqual(["start", "block"]);
    await changeTaskStatus(saad, 1, "start", "", null);
    await expect(changeTaskStatus(saad, 1, "submit", "", null)).rejects.toThrow(/note or proof/);
    await changeTaskStatus(saad, 1, "submit", "Done, see https://site.com/page", null);
    // The assignee can't QA their own work.
    expect((await getTask(saad, 1)).actions).toEqual([]);
    expect((await getTask(sohail, 1)).actions).toEqual(["pickUp", "approve", "reject"]);
    await changeTaskStatus(sohail, 1, "pickUp", "", null);
    await expect(changeTaskStatus(sohail, 1, "reject", "", null)).rejects.toThrow(/needs fixing/);
    await changeTaskStatus(sohail, 1, "reject", "Two pages still wrong", null);
    let task = await db.task.findUniqueOrThrow({ where: { number: 1 } });
    expect(task).toMatchObject({ status: "IN_PROGRESS", rejectionReason: "Two pages still wrong" });
    await changeTaskStatus(saad, 1, "submit", "Fixed both", null);
    await changeTaskStatus(sohail, 1, "approve", "", null);
    await changeTaskStatus(saad, 1, "complete", "", null);
    task = await db.task.findUniqueOrThrow({ where: { number: 1 } });
    expect(task.status).toBe("COMPLETED");
    expect(task.completedAt).not.toBeNull();
    const { history } = await getTask(sameer, 1);
    expect(history.map((h) => h.type)).toEqual(["task.created", "task.start", "task.submit", "task.pickUp", "task.reject", "task.submit", "task.approve", "task.complete"]);
  });

  it("blocks with a reason and goes back to where it was", async () => {
    const { sameer, saad, client } = await setup();
    await createTask(sameer, { clientId: client.id, title: "Write blog", assigneeId: saad.id }, null);
    await changeTaskStatus(saad, 1, "start", "", null);
    await expect(changeTaskStatus(saad, 1, "block", "", null)).rejects.toThrow(/blocking/);
    await changeTaskStatus(saad, 1, "block", "Waiting for client login", null);
    expect(await db.notification.count({ where: { userId: sameer.id, title: { contains: "blocked" } } })).toBe(1);
    await changeTaskStatus(saad, 1, "unblock", "", null);
    expect((await db.task.findUniqueOrThrow({ where: { number: 1 } })).status).toBe("IN_PROGRESS");
  });

  it("lets owners and strategy do QA when nobody is named, but never on their own task", async () => {
    const { owner, sameer, client } = await setup();
    await createTask(owner, { clientId: client.id, title: "Audit homepage", assigneeId: sameer.id }, null);
    await changeTaskStatus(sameer, 1, "start", "", null);
    await changeTaskStatus(sameer, 1, "submit", "Audit doc linked", null);
    expect((await getTask(sameer, 1)).actions).toEqual([]);
    await changeTaskStatus(owner, 1, "approve", "", null);
    expect((await db.task.findUniqueOrThrow({ where: { number: 1 } })).reviewerId).toBe(owner.id);
  });

  it("refuses the same person as doer and reviewer, and off-page staff as either", async () => {
    const { sameer, saad, client } = await setup();
    const offpage = await person("OFFPAGE");
    await expect(createTask(sameer, { clientId: client.id, title: "Xyz task", assigneeId: saad.id, reviewerId: saad.id }, null)).rejects.toThrow(/someone other/);
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

  it("lists my, to-review and overdue tasks", async () => {
    const { sameer, saad, sohail, client } = await setup();
    const now = istDateTime("2026-10-12", "10:00");
    await createTask(sameer, { clientId: client.id, title: "Late one", assigneeId: saad.id, dueDate: "2026-10-10" }, null);
    await createTask(sameer, { clientId: client.id, title: "Future one", assigneeId: saad.id, reviewerId: sohail.id, dueDate: "2026-10-20" }, null);
    expect((await listTasks(saad, { view: "mine" }, now)).map((t) => [t.title, t.overdue])).toEqual([["Late one", true], ["Future one", false]]);
    expect((await listTasks(saad, { view: "mine", status: "overdue" }, now)).map((t) => t.title)).toEqual(["Late one"]);
    await changeTaskStatus(saad, 2, "start", "", null);
    await changeTaskStatus(saad, 2, "submit", "ok done", null);
    expect((await listTasks(sohail, { view: "review" }, now)).map((t) => t.title)).toEqual(["Future one"]);
    expect(await taskCounts(saad, now)).toEqual({ mine: 2, overdue: 1, review: 0 });
  });

  it("edits a task, notifies a new assignee, and takes comments", async () => {
    const { sameer, saad, sohail, client } = await setup();
    await createTask(sameer, { clientId: client.id, title: "Old title", assigneeId: saad.id }, null);
    await updateTask(sameer, 1, { title: "New title", assigneeId: sohail.id, priority: "HIGH" }, null);
    expect(await db.notification.count({ where: { userId: sohail.id } })).toBe(1);
    await addTaskComment(sohail, 1, "On it");
    expect((await getTask(sameer, 1)).comments.map((c) => c.body)).toEqual(["On it"]);
    expect(await db.notification.count({ where: { userId: sameer.id, title: { contains: "commented" } } })).toBe(1);
  });
});
