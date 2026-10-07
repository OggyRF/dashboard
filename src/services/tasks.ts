import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { dateFromKey, istDateKey, isValidKey, keyFromDbDate } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { accessTo, ensureAssigned, logActivity, requireClient, visibleClients } from "@/services/clients";
import { notify } from "@/services/notifications";

type Tx = Prisma.TransactionClient;

// Task workflow: Not started → Under process → Completed. The person doing
// the task moves it along; the follow-up person (and owners) can also mark it
// completed or reopen it. Overdue is worked out from the due date; once a
// task is past due, everyone on the client and the owners get one alert.

export { TASK_CATEGORY_LABELS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/task-labels";

const DONE: TaskStatus[] = ["COMPLETED"];

export function isOverdue(task: { status: TaskStatus; dueDate: Date | null }, now = new Date()) {
  return !!task.dueDate && !DONE.includes(task.status) && task.dueDate < dateFromKey(istDateKey(now));
}

const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null);

export const TASK_CATEGORIES = ["RESEARCH", "PLANNING", "STRATEGY", "TECHNICAL", "ON_PAGE", "CONTENT", "OFF_PAGE", "GMB", "REPORTING", "OTHER"] as const;

export const taskSchema = z.object({
  clientId: z.string().min(1, "Pick a client."),
  title: z.string().trim().min(3, "Give the task a short title.").max(200),
  description: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .transform((v) => v || null),
  category: z.enum(TASK_CATEGORIES).default("OTHER"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assigneeId: optionalId,
  followUpId: optionalId,
  dueDate: z
    .string()
    .optional()
    .refine((v) => !v || isValidKey(v), "Pick a valid due date.")
    .transform((v) => (v ? dateFromKey(v) : null)),
  sourceMessageId: optionalId,
});

async function checkPeople(tx: Tx, assigneeId: string | null, followUpId: string | null) {
  for (const [id, label] of [
    [assigneeId, "do the task"],
    [followUpId, "follow up"],
  ] as const) {
    if (!id) continue;
    const p = await tx.user.findUnique({ where: { id } });
    if (!p || p.status !== "ACTIVE" || p.role === "OFFPAGE") throw invalid(`Pick an owner, strategy or execution person to ${label}.`);
  }
  if (assigneeId && assigneeId === followUpId) throw invalid("The follow-up person should be someone other than the person doing the task.");
}

async function joinClient(tx: Tx, clientId: string, userId: string | null) {
  if (!userId) return;
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  if (u.role === "EXECUTION") await ensureAssigned(tx, clientId, userId, "EXECUTION");
}

export async function createTask(user: SessionUser, input: unknown, ip: string | null) {
  if (!can(user.role, "tasks.manage")) throw forbidden();
  const data = taskSchema.parse(input);
  const { client } = await requireClient(user, data.clientId);
  return db.$transaction(async (tx) => {
    await checkPeople(tx, data.assigneeId, data.followUpId);
    const task = await tx.task.create({ data: { ...data, createdById: user.id } });
    await joinClient(tx, client.id, data.assigneeId);
    await joinClient(tx, client.id, data.followUpId);
    const link = `/tasks/${task.number}`;
    if (data.assigneeId && data.assigneeId !== user.id) await notify(tx, [data.assigneeId], `${user.name} gave you task #${task.number} for ${client.name}: ${task.title}`, link);
    if (data.followUpId && data.followUpId !== user.id) await notify(tx, [data.followUpId], `You follow up on #${task.number} for ${client.name}: ${task.title}`, link);
    await logActivity(tx, client.id, user.id, "task.created", `${user.name} created task #${task.number}: ${task.title}`, link);
    await writeAudit(tx, { actorId: user.id, action: "task.create", entityType: "Task", entityId: task.id, after: auditView(task), ip });
    return task;
  });
}

function auditView(t: Prisma.TaskGetPayload<object>) {
  return { number: t.number, title: t.title, status: t.status, assigneeId: t.assigneeId, followUpId: t.followUpId, priority: t.priority, dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null };
}

const include = {
  client: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, avatarUpdatedAt: true } },
  followUp: { select: { id: true, name: true, avatarUpdatedAt: true } },
  createdBy: { select: { id: true, name: true, avatarUpdatedAt: true } },
} as const;

async function loadTask(user: SessionUser, number: number) {
  const task = Number.isInteger(number) ? await db.task.findUnique({ where: { number }, include }) : null;
  if (!task || (await accessTo(user, task.clientId)) !== "full") throw notFound("Task");
  return task;
}

type LoadedTask = Awaited<ReturnType<typeof loadTask>>;

// Who may change the task's details (title, people, due date).
// (Loading the task already checked the person can see the whole client.)
function canEdit(user: SessionUser) {
  return can(user.role, "tasks.manage");
}

// The follow-up person, whoever created the task, and owners keep an eye on it.
function isWatcher(user: SessionUser, task: LoadedTask) {
  return task.followUpId === user.id || task.createdById === user.id || user.role === "OWNER";
}

export type TaskAction = "progress" | "complete" | "reopen";

export const TASK_ACTION_LABELS: Record<TaskAction, string> = {
  progress: "Under process",
  complete: "Mark completed",
  reopen: "Reopen",
};

// The buttons this person gets on the task right now.
export function allowedActions(user: SessionUser, task: LoadedTask): TaskAction[] {
  const doer = task.assigneeId === user.id;
  const watcher = isWatcher(user, task);
  const actions: TaskAction[] = [];
  if (task.status === "NOT_STARTED" && doer) actions.push("progress");
  if (task.status !== "COMPLETED" && (doer || watcher)) actions.push("complete");
  if (task.status === "COMPLETED" && (doer || watcher || canEdit(user))) actions.push("reopen");
  return actions;
}

const noteSchema = z.string().trim().max(2000).optional();

export async function changeTaskStatus(user: SessionUser, number: number, action: TaskAction, note: unknown, ip: string | null, now = new Date()) {
  const task = await loadTask(user, number);
  if (!allowedActions(user, task).includes(action)) throw invalid("That step is not available on this task right now.");
  const text = noteSchema.parse(note ?? undefined) || "";
  let data: Prisma.TaskUpdateInput;
  let summary: string;
  const tell: { to: (string | null)[]; title: string }[] = [];
  const name = `#${task.number} ${task.title}`;
  switch (action) {
    case "progress":
      data = { status: "IN_PROGRESS" };
      summary = `${user.name} marked ${name} under process`;
      break;
    case "complete":
      data = { status: "COMPLETED", completedAt: now };
      summary = `${user.name} completed ${name}${text ? `: ${text}` : ""}`;
      tell.push({ to: [task.followUpId, task.createdById, task.assigneeId], title: `${user.name} completed ${name}` });
      break;
    case "reopen":
      data = { status: "IN_PROGRESS", completedAt: null, overdueNotifiedAt: null };
      summary = `${user.name} reopened ${name}${text ? `: ${text}` : ""}`;
      tell.push({ to: [task.assigneeId, task.followUpId], title: `${user.name} reopened ${name}` });
      break;
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: task.id }, data });
    for (const t of tell) await notify(tx, [...new Set(t.to)].filter((id): id is string => !!id && id !== user.id), t.title, `/tasks/${task.number}`);
    await logActivity(tx, task.clientId, user.id, `task.${action}`, summary, `/tasks/${task.number}`);
    await writeAudit(tx, { actorId: user.id, action: `task.${action}`, entityType: "Task", entityId: task.id, before: { status: task.status }, after: { status: updated.status, note: text || null }, ip });
    return updated;
  });
}

export const taskEditSchema = taskSchema.omit({ clientId: true, sourceMessageId: true });

export async function updateTask(user: SessionUser, number: number, input: unknown, ip: string | null) {
  const task = await loadTask(user, number);
  if (!canEdit(user)) throw forbidden();
  const data = taskEditSchema.parse(input);
  const dueChanged = (data.dueDate?.getTime() ?? null) !== (task.dueDate?.getTime() ?? null);
  return db.$transaction(async (tx) => {
    await checkPeople(tx, data.assigneeId, data.followUpId);
    const updated = await tx.task.update({ where: { id: task.id }, data: { ...data, ...(dueChanged ? { overdueNotifiedAt: null } : {}) } });
    await joinClient(tx, task.clientId, data.assigneeId);
    await joinClient(tx, task.clientId, data.followUpId);
    const link = `/tasks/${task.number}`;
    if (data.assigneeId && data.assigneeId !== task.assigneeId && data.assigneeId !== user.id) {
      await notify(tx, [data.assigneeId], `${user.name} gave you task #${task.number} for ${task.client.name}: ${updated.title}`, link);
    }
    if (data.followUpId && data.followUpId !== task.followUpId && data.followUpId !== user.id) {
      await notify(tx, [data.followUpId], `You follow up on #${task.number} for ${task.client.name}: ${updated.title}`, link);
    }
    await logActivity(tx, task.clientId, user.id, "task.updated", `${user.name} edited #${task.number} ${updated.title}`, link);
    await writeAudit(tx, { actorId: user.id, action: "task.update", entityType: "Task", entityId: task.id, before: auditView(task), after: auditView(updated), ip });
    return updated;
  });
}

// The task's own small chat. Anyone who can open the task can post (the
// client's team, strategy and owners); the people on the task and everyone
// who has posted before hear about it.
export async function addTaskComment(user: SessionUser, number: number, body: unknown) {
  const task = await loadTask(user, number);
  const text = z.string().trim().min(1, "Write a message.").max(5000).parse(body);
  return db.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({ data: { taskId: task.id, authorId: user.id, body: text } });
    const earlier = await tx.taskComment.findMany({ where: { taskId: task.id }, select: { authorId: true }, distinct: ["authorId"] });
    const to = [task.assigneeId, task.followUpId, task.createdById, ...earlier.map((c) => c.authorId)];
    await notify(tx, [...new Set(to)].filter((id): id is string => !!id && id !== user.id), `${user.name} on #${task.number}: ${text.slice(0, 80)}`, `/tasks/${task.number}`);
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    return comment;
  });
}

export async function taskComments(user: SessionUser, number: number) {
  const task = await loadTask(user, number);
  const comments = await db.taskComment.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, avatarUpdatedAt: true } } },
  });
  return comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), author: c.author }));
}

export async function getTask(user: SessionUser, number: number) {
  const task = await loadTask(user, number);
  const comments = await taskComments(user, number);
  const history = await db.activityEvent.findMany({ where: { link: `/tasks/${task.number}` }, orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, name: true } } } });
  return { task, comments, history, actions: allowedActions(user, task), canEdit: canEdit(user) };
}

// Once a day: tasks that went past their due date without being completed.
// Everyone on the client, the people on the task and the owners hear once.
export async function notifyOverdueTasks(now = new Date()) {
  const today = dateFromKey(istDateKey(now));
  const late = await db.task.findMany({
    where: { status: { notIn: DONE }, dueDate: { lt: today }, overdueNotifiedAt: null, client: { status: { not: "CHURNED" } } },
    include: { client: { select: { id: true, name: true, assignments: { select: { userId: true } } } } },
  });
  if (!late.length) return 0;
  const owners = await db.user.findMany({ where: { role: "OWNER", status: "ACTIVE" }, select: { id: true } });
  for (const t of late) {
    await db.$transaction(async (tx) => {
      const claimed = await tx.task.updateMany({ where: { id: t.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: now } });
      if (!claimed.count) return;
      const to = new Set([t.assigneeId, t.followUpId, t.createdById, ...t.client.assignments.map((a) => a.userId), ...owners.map((o) => o.id)]);
      const people = await tx.user.findMany({ where: { id: { in: [...to].filter((id): id is string => !!id) }, status: "ACTIVE" }, select: { id: true } });
      await notify(tx, people.map((p) => p.id), `Overdue: #${t.number} ${t.title} for ${t.client.name} was due ${keyFromDbDate(t.dueDate!)}`, `/tasks/${t.number}`);
      await logActivity(tx, t.clientId, null, "task.overdue", `#${t.number} ${t.title} is past its due date`, `/tasks/${t.number}`);
    });
  }
  return late.length;
}

// Tasks to offer after typing # in chat, most recently changed first.
export async function taskSuggestions(user: SessionUser, clientId: string | null, take = 60) {
  if (!can(user.role, "tasks.manage")) return [];
  const tasks = await db.task.findMany({
    where: { AND: [{ client: visibleClients(user) }, clientId ? { clientId } : {}] },
    orderBy: { updatedAt: "desc" },
    take,
    select: { number: true, title: true, status: true, client: { select: { name: true } } },
  });
  return tasks.map((t) => ({ number: t.number, title: t.title, status: t.status, client: t.client.name }));
}

export const taskFilterSchema = z.object({
  view: z.enum(["mine", "followup", "created", "all"]).catch("mine"),
  status: z.enum(["open", "overdue", "done", "NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).catch("open"),
  clientId: z.string().optional(),
});

export async function listTasks(user: SessionUser, filters: Partial<z.input<typeof taskFilterSchema>> = {}, now = new Date()) {
  if (!can(user.role, "tasks.manage")) throw forbidden();
  const f = taskFilterSchema.parse(filters);
  const today = dateFromKey(istDateKey(now));
  const where: Prisma.TaskWhereInput = {
    AND: [
      { client: visibleClients(user) },
      f.clientId ? { clientId: f.clientId } : {},
      f.view === "mine" ? { assigneeId: user.id } : f.view === "followup" ? { followUpId: user.id } : f.view === "created" ? { createdById: user.id } : {},
      f.status === "open"
        ? { status: { notIn: DONE } }
        : f.status === "overdue"
          ? { status: { notIn: DONE }, dueDate: { lt: today } }
          : f.status === "done"
            ? { status: { in: DONE } }
            : { status: f.status },
    ],
  };
  const tasks = await db.task.findMany({ where, include, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { number: "desc" }], take: 300 });
  return tasks.map((t) => ({ ...t, overdue: isOverdue(t, now) }));
}

// Someone's open tasks, for their profile (team leads see everyone's work).
export async function openTasksOf(actor: SessionUser, personId: string, now = new Date()) {
  if (actor.id !== personId && !can(actor.role, "team.overview")) throw forbidden();
  const tasks = await db.task.findMany({
    where: { assigneeId: personId, status: { notIn: DONE } },
    include,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { number: "desc" }],
    take: 100,
  });
  return tasks.map((t) => ({ ...t, overdue: isOverdue(t, now) }));
}

// Small counts for the home page.
export async function taskCounts(user: SessionUser, now = new Date()) {
  if (!can(user.role, "tasks.manage")) return null;
  const today = dateFromKey(istDateKey(now));
  const [mine, overdue, followUp] = await Promise.all([
    db.task.count({ where: { assigneeId: user.id, status: { notIn: DONE } } }),
    db.task.count({ where: { assigneeId: user.id, status: { notIn: DONE }, dueDate: { lt: today } } }),
    db.task.count({ where: { followUpId: user.id, status: { notIn: DONE } } }),
  ]);
  return { mine, overdue, followUp };
}

// Clients a person can create tasks for.
export function taskClients(user: SessionUser) {
  return db.client.findMany({ where: { AND: [visibleClients(user), { status: { not: "CHURNED" } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
