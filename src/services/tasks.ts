import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { dateFromKey, istDateKey, isValidKey } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { accessTo, ensureAssigned, logActivity, requireClient, visibleClients } from "@/services/clients";
import { notify } from "@/services/notifications";

type Tx = Prisma.TransactionClient;

// Task workflow (plan section 4): Not started → In progress → Submitted (with
// a note or proof link) → QA by the named reviewer → Approved, or back to In
// progress with a reason → Completed once live and verified. Blocked can be
// set from Not started, In progress or QA and needs a reason. Overdue is
// worked out from the due date, never stored.

export { TASK_CATEGORY_LABELS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/task-labels";

const DONE: TaskStatus[] = ["APPROVED", "COMPLETED"];

export function isOverdue(task: { status: TaskStatus; dueDate: Date | null }, now = new Date()) {
  return !!task.dueDate && !DONE.includes(task.status) && task.dueDate < dateFromKey(istDateKey(now));
}

const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null);

export const taskSchema = z.object({
  clientId: z.string().min(1, "Pick a client."),
  title: z.string().trim().min(3, "Give the task a short title.").max(200),
  description: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .transform((v) => v || null),
  category: z.enum(["TECHNICAL", "ON_PAGE", "CONTENT", "OFF_PAGE", "GMB", "REPORTING", "OTHER"]).default("OTHER"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assigneeId: optionalId,
  reviewerId: optionalId,
  dueDate: z
    .string()
    .optional()
    .refine((v) => !v || isValidKey(v), "Pick a valid due date.")
    .transform((v) => (v ? dateFromKey(v) : null)),
  sourceMessageId: optionalId,
});

async function checkPeople(tx: Tx, assigneeId: string | null, reviewerId: string | null) {
  for (const [id, label] of [
    [assigneeId, "do the task"],
    [reviewerId, "check the task"],
  ] as const) {
    if (!id) continue;
    const p = await tx.user.findUnique({ where: { id } });
    if (!p || p.status !== "ACTIVE" || p.role === "OFFPAGE") throw invalid(`Pick an owner, strategy or execution person to ${label}.`);
  }
  if (assigneeId && assigneeId === reviewerId) throw invalid("The QA reviewer must be someone other than the person doing the task.");
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
    await checkPeople(tx, data.assigneeId, data.reviewerId);
    const task = await tx.task.create({ data: { ...data, createdById: user.id } });
    await joinClient(tx, client.id, data.assigneeId);
    await joinClient(tx, client.id, data.reviewerId);
    const link = `/tasks/${task.number}`;
    if (data.assigneeId && data.assigneeId !== user.id) await notify(tx, [data.assigneeId], `${user.name} gave you task #${task.number} for ${client.name}: ${task.title}`, link);
    if (data.reviewerId && data.reviewerId !== user.id) await notify(tx, [data.reviewerId], `You are QA reviewer on #${task.number} for ${client.name}: ${task.title}`, link);
    await logActivity(tx, client.id, user.id, "task.created", `${user.name} created task #${task.number}: ${task.title}`, link);
    await writeAudit(tx, { actorId: user.id, action: "task.create", entityType: "Task", entityId: task.id, after: auditView(task), ip });
    return task;
  });
}

function auditView(t: Prisma.TaskGetPayload<object>) {
  return { number: t.number, title: t.title, status: t.status, assigneeId: t.assigneeId, reviewerId: t.reviewerId, priority: t.priority, dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null };
}

const include = {
  client: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, avatarUpdatedAt: true } },
  reviewer: { select: { id: true, name: true, avatarUpdatedAt: true } },
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

function isReviewer(user: SessionUser, task: LoadedTask) {
  if (task.assigneeId === user.id || !can(user.role, "tasks.qa")) return false;
  return task.reviewerId === user.id || user.role === "OWNER" || user.role === "STRATEGY";
}

function isWorker(user: SessionUser, task: LoadedTask) {
  return task.assigneeId === user.id;
}

export type TaskAction = "start" | "submit" | "pickUp" | "approve" | "reject" | "complete" | "block" | "unblock" | "reopen";

export const TASK_ACTION_LABELS: Record<TaskAction, string> = {
  start: "Start work",
  submit: "Submit for QA",
  pickUp: "Start QA",
  approve: "Approve",
  reject: "Send back",
  complete: "Mark completed",
  block: "Mark blocked",
  unblock: "Unblock",
  reopen: "Reopen",
};

// The buttons this person gets on the task right now.
export function allowedActions(user: SessionUser, task: LoadedTask): TaskAction[] {
  const worker = isWorker(user, task);
  const reviewer = isReviewer(user, task);
  const manager = canEdit(user);
  const actions: TaskAction[] = [];
  switch (task.status) {
    case "NOT_STARTED":
      if (worker) actions.push("start");
      if (worker || manager) actions.push("block");
      break;
    case "IN_PROGRESS":
      if (worker) actions.push("submit", "block");
      else if (manager) actions.push("block");
      break;
    case "SUBMITTED":
      if (reviewer) actions.push("pickUp", "approve", "reject");
      break;
    case "QA":
      if (reviewer) actions.push("approve", "reject", "block");
      break;
    case "APPROVED":
      if (worker || reviewer || manager) actions.push("complete");
      if (reviewer) actions.push("reopen");
      break;
    case "BLOCKED":
      if (worker || reviewer || manager) actions.push("unblock");
      break;
    case "COMPLETED":
      if (manager) actions.push("reopen");
      break;
  }
  return actions;
}

const noteSchema = z.string().trim().max(2000).optional();

export async function changeTaskStatus(user: SessionUser, number: number, action: TaskAction, note: unknown, ip: string | null, now = new Date()) {
  const task = await loadTask(user, number);
  if (!allowedActions(user, task).includes(action)) throw invalid("That step is not available on this task right now.");
  const text = noteSchema.parse(note ?? undefined) || "";
  const need = (msg: string) => {
    if (text.length < 3) throw invalid(msg);
  };
  let data: Prisma.TaskUpdateInput;
  let summary: string;
  const tell: { to: (string | null)[]; title: string }[] = [];
  const name = `#${task.number} ${task.title}`;
  switch (action) {
    case "start":
      data = { status: "IN_PROGRESS" };
      summary = `${user.name} started ${name}`;
      break;
    case "submit": {
      need("Add a note or proof link so the reviewer knows what to check.");
      data = { status: "SUBMITTED", submissionNote: text, submittedAt: now, rejectionReason: null };
      summary = `${user.name} submitted ${name} for QA`;
      const fallback = task.reviewerId ? [task.reviewerId] : [task.createdById];
      tell.push({ to: fallback, title: `${user.name} submitted ${name} for QA` });
      break;
    }
    case "pickUp":
      data = { status: "QA", ...(task.reviewerId ? {} : { reviewer: { connect: { id: user.id } } }) };
      summary = `${user.name} started QA on ${name}`;
      break;
    case "approve":
      data = { status: "APPROVED", ...(task.reviewerId ? {} : { reviewer: { connect: { id: user.id } } }) };
      summary = `${user.name} approved ${name}`;
      tell.push({ to: [task.assigneeId], title: `${user.name} approved ${name}` });
      break;
    case "reject":
      need("Say what needs fixing.");
      data = { status: "IN_PROGRESS", rejectionReason: text };
      summary = `${user.name} sent back ${name}: ${text}`;
      tell.push({ to: [task.assigneeId], title: `${user.name} sent back ${name}: ${text}` });
      break;
    case "complete":
      data = { status: "COMPLETED", completedAt: now };
      summary = `${user.name} completed ${name}`;
      break;
    case "block":
      need("Say what is blocking it.");
      data = { status: "BLOCKED", statusBeforeBlocked: task.status, blockedReason: text };
      summary = `${user.name} marked ${name} blocked: ${text}`;
      tell.push({ to: [task.createdById, task.assigneeId, task.reviewerId], title: `${name} is blocked: ${text}` });
      break;
    case "unblock":
      data = { status: task.statusBeforeBlocked ?? "IN_PROGRESS", statusBeforeBlocked: null, blockedReason: null };
      summary = `${user.name} unblocked ${name}`;
      tell.push({ to: [task.assigneeId], title: `${name} is unblocked` });
      break;
    case "reopen":
      data = { status: "IN_PROGRESS", completedAt: null };
      summary = `${user.name} reopened ${name}`;
      tell.push({ to: [task.assigneeId], title: `${user.name} reopened ${name}` });
      break;
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: task.id }, data });
    for (const t of tell) await notify(tx, t.to.filter((id): id is string => !!id && id !== user.id), t.title, `/tasks/${task.number}`);
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
  return db.$transaction(async (tx) => {
    await checkPeople(tx, data.assigneeId, data.reviewerId);
    const updated = await tx.task.update({ where: { id: task.id }, data });
    await joinClient(tx, task.clientId, data.assigneeId);
    await joinClient(tx, task.clientId, data.reviewerId);
    const link = `/tasks/${task.number}`;
    if (data.assigneeId && data.assigneeId !== task.assigneeId && data.assigneeId !== user.id) {
      await notify(tx, [data.assigneeId], `${user.name} gave you task #${task.number} for ${task.client.name}: ${updated.title}`, link);
    }
    if (data.reviewerId && data.reviewerId !== task.reviewerId && data.reviewerId !== user.id) {
      await notify(tx, [data.reviewerId], `You are QA reviewer on #${task.number} for ${task.client.name}: ${updated.title}`, link);
    }
    await logActivity(tx, task.clientId, user.id, "task.updated", `${user.name} edited #${task.number} ${updated.title}`, link);
    await writeAudit(tx, { actorId: user.id, action: "task.update", entityType: "Task", entityId: task.id, before: auditView(task), after: auditView(updated), ip });
    return updated;
  });
}

export async function addTaskComment(user: SessionUser, number: number, body: unknown) {
  const task = await loadTask(user, number);
  const text = z.string().trim().min(1, "Write a comment.").max(5000).parse(body);
  return db.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({ data: { taskId: task.id, authorId: user.id, body: text } });
    const to = [task.assigneeId, task.reviewerId, task.createdById].filter((id): id is string => !!id && id !== user.id);
    await notify(tx, to, `${user.name} commented on #${task.number}: ${text.slice(0, 80)}`, `/tasks/${task.number}`);
    return comment;
  });
}

export async function getTask(user: SessionUser, number: number) {
  const task = await loadTask(user, number);
  const comments = await db.taskComment.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, avatarUpdatedAt: true } } },
  });
  const history = await db.activityEvent.findMany({ where: { link: `/tasks/${task.number}` }, orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, name: true } } } });
  return { task, comments, history, actions: allowedActions(user, task), canEdit: canEdit(user) };
}

export const taskFilterSchema = z.object({
  view: z.enum(["mine", "review", "created", "all"]).catch("mine"),
  status: z.enum(["open", "overdue", "done", "NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "QA", "APPROVED", "COMPLETED", "BLOCKED"]).catch("open"),
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
      f.view === "mine" ? { assigneeId: user.id } : f.view === "review" ? { reviewerId: user.id, status: { in: ["SUBMITTED", "QA"] } } : f.view === "created" ? { createdById: user.id } : {},
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

// Small counts for the home page.
export async function taskCounts(user: SessionUser, now = new Date()) {
  if (!can(user.role, "tasks.manage")) return null;
  const today = dateFromKey(istDateKey(now));
  const [mine, overdue, review] = await Promise.all([
    db.task.count({ where: { assigneeId: user.id, status: { notIn: DONE } } }),
    db.task.count({ where: { assigneeId: user.id, status: { notIn: DONE }, dueDate: { lt: today } } }),
    db.task.count({ where: { reviewerId: user.id, status: { in: ["SUBMITTED", "QA"] } } }),
  ]);
  return { mine, overdue, review };
}

// Clients a person can create tasks for.
export function taskClients(user: SessionUser) {
  return db.client.findMany({ where: { AND: [visibleClients(user), { status: { not: "CHURNED" } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
