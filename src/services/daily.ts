import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { dailyTitle } from "@/lib/daily-labels";
import { addDays, dateFromKey, istDateKey, isValidKey, keyFromDbDate } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { accessTo, ensureAssigned, logActivity, requireClient, visibleClients } from "@/services/clients";
import { notify } from "@/services/notifications";
import { ensureMonth } from "@/services/offpage";

type Tx = Prisma.TransactionClient;

// Daily task lists (Aarif, 6 Oct 2026). Leads give off-page staff a list for
// each day, e.g. "Write 2 Guest Posting for IIT Bombay, Upload 3 Guest Posting
// for Beautiful India", so work is not left for the end of the week. Each
// line is ticked off one piece at a time; an upload ticked with its live link
// also ticks the next open box of that activity in the client's off-page
// checklist.

// Unfinished lines from this many days back stay on someone's list.
export const CARRY_OVER_DAYS = 14;

export const dailySchema = z
  .object({
    date: z.string().refine(isValidKey, "Pick a valid day."),
    assigneeId: z.string().min(1, "Pick who does it."),
    clientId: z.string().min(1, "Pick a client."),
    work: z.enum(["WRITING", "UPLOADING", "OTHER"]),
    activityId: z
      .string()
      .optional()
      .transform((v) => v || null),
    qty: z.coerce.number().int("Use a whole number.").min(1, "At least 1.").max(50, "At most 50 in a day."),
    details: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((v) => v || null),
  })
  .refine((d) => d.work === "OTHER" || d.activityId, { message: "Pick the off-page activity.", path: ["activityId"] })
  .refine((d) => d.work !== "OTHER" || d.details, { message: "Say what needs doing.", path: ["details"] });

const include = {
  client: { select: { id: true, name: true } },
  activity: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, avatarUpdatedAt: true } },
  createdBy: { select: { id: true, name: true } },
  ticks: { orderBy: { n: "asc" }, include: { doneBy: { select: { id: true, name: true } } } },
} satisfies Prisma.DailyTaskInclude;

type Loaded = Prisma.DailyTaskGetPayload<{ include: typeof include }>;

function view(t: Loaded) {
  return {
    id: t.id,
    date: keyFromDbDate(t.date),
    work: t.work,
    qty: t.qty,
    details: t.details,
    title: dailyTitle(t),
    client: t.client,
    activity: t.activity,
    assignee: t.assignee,
    createdBy: t.createdBy,
    ticks: t.ticks.map((k) => ({ id: k.id, n: k.n, proofUrl: k.proofUrl, doneAt: k.doneAt.toISOString(), linked: !!k.offpageItemId, doneBy: k.doneBy })),
    done: t.ticks.length,
  };
}
export type DailyTaskView = ReturnType<typeof view>;

export async function addDailyTask(user: SessionUser, input: unknown, ip: string | null, now = new Date()) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  const data = dailySchema.parse(input);
  const { client } = await requireClient(user, data.clientId);
  if (data.date < addDays(istDateKey(now), -1)) throw invalid("Plan today or a day ahead, not the past.");
  const person = await db.user.findUnique({ where: { id: data.assigneeId } });
  if (!person || person.status !== "ACTIVE" || !can(person.role, "daily.own")) throw invalid("Pick an active team member (not an owner).");
  if (data.activityId) {
    const a = await db.offpageActivity.findUnique({ where: { id: data.activityId } });
    if (!a || a.clientId !== client.id || a.removedAt) throw invalid("That activity is not in this client's off-page plan.");
  }
  return db.$transaction(async (tx) => {
    const task = await tx.dailyTask.create({
      data: { ...data, date: dateFromKey(data.date), createdById: user.id },
      include,
    });
    await ensureAssigned(tx, client.id, person.id, person.role === "OFFPAGE" ? "OFFPAGE" : "EXECUTION");
    if (person.id !== user.id) {
      const when = data.date === istDateKey(now) ? "today" : data.date;
      await notify(tx, [person.id], `${user.name} added to your list for ${when}: ${dailyTitle(task)} for ${client.name}`, `/daily?date=${data.date}`);
    }
    await writeAudit(tx, { actorId: user.id, action: "daily.create", entityType: "DailyTask", entityId: task.id, after: data, ip });
    return view(task);
  });
}

export async function removeDailyTask(user: SessionUser, id: string, ip: string | null) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  const task = await db.dailyTask.findUnique({ where: { id }, include });
  if (!task || (await accessTo(user, task.clientId)) !== "full") throw notFound("Daily task");
  if (task.ticks.length) throw invalid("Part of this is already ticked off. Untick it first if it was a mistake.");
  await db.$transaction(async (tx) => {
    await tx.dailyTask.delete({ where: { id } });
    await writeAudit(tx, { actorId: user.id, action: "daily.delete", entityType: "DailyTask", entityId: id, before: { title: dailyTitle(task), date: keyFromDbDate(task.date), assigneeId: task.assigneeId }, ip });
  });
}

const proofSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const url = new URL(withScheme);
      if (!url.hostname.includes(".")) throw new Error();
      return url.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "The link does not look like a web address." });
      return z.NEVER;
    }
  });

async function loadForTick(user: SessionUser, id: string) {
  const task = await db.dailyTask.findUnique({ where: { id }, include });
  const access = task ? await accessTo(user, task.clientId) : null;
  if (!task || !access) throw notFound("Daily task");
  if (task.assigneeId !== user.id && !(access === "full" && can(user.role, "daily.assign"))) throw forbidden();
  return task;
}

// Ticks the next piece of a daily task. Uploads need the live link and tick
// the oldest open box of that activity in the client's checklist this month.
export async function tickDaily(user: SessionUser, id: string, proofInput: unknown, ip: string | null, now = new Date()) {
  const task = await loadForTick(user, id);
  const date = keyFromDbDate(task.date);
  if (date > istDateKey(now)) throw invalid("This is on a later day's list.");
  const proof = proofSchema.parse(proofInput ?? undefined);
  if (task.work === "UPLOADING" && !proof) throw invalid("Add the live link of the upload.");
  const taken = new Set(task.ticks.map((k) => k.n));
  const n = Array.from({ length: task.qty }, (_, i) => i + 1).find((i) => !taken.has(i));
  if (!n) throw invalid("All of this is already ticked off.");
  return db.$transaction(async (tx) => {
    let offpageItemId: string | null = null;
    if (task.work === "UPLOADING" && task.activityId) {
      offpageItemId = await tickChecklist(tx, user, task.clientId, task.activityId, proof, now);
    }
    const tick = await tx.dailyTaskTick.create({ data: { dailyTaskId: id, n, doneAt: now, doneById: user.id, proofUrl: proof, offpageItemId } });
    await logActivity(tx, task.clientId, user.id, "daily.tick", `${user.name} did ${n} of ${task.qty}: ${dailyTitle(task)}${offpageItemId ? " (ticked in the off-page checklist)" : ""}`, proof ?? `/daily?date=${date}`);
    await writeAudit(tx, { actorId: user.id, action: "daily.tick", entityType: "DailyTask", entityId: id, after: { n, proofUrl: proof, offpageItemId }, ip });
    return { tick, linked: !!offpageItemId, noBoxLeft: task.work === "UPLOADING" && !!task.activityId && !offpageItemId };
  });
}

// The oldest open box of the activity this month (earlier weeks first, so
// late work is caught up before this week's). Returns null when none is left.
async function tickChecklist(tx: Tx, user: SessionUser, clientId: string, activityId: string, proof: string | null, now: Date) {
  const month = istDateKey(now).slice(0, 7);
  await ensureMonth(tx, clientId, month, now);
  const item = await tx.offpageItem.findFirst({
    where: { activityId, month, doneAt: null, dailyTick: null },
    orderBy: [{ week: "asc" }, { createdAt: "asc" }],
  });
  if (!item) return null;
  await tx.offpageItem.update({
    where: { id: item.id },
    data: { doneAt: now, doneById: user.id, proofUrl: proof, rejectedAt: null, rejectedById: null, rejectReason: null },
  });
  return item.id;
}

export async function untickDaily(user: SessionUser, tickId: string, ip: string | null) {
  const tick = await db.dailyTaskTick.findUnique({ where: { id: tickId } });
  if (!tick) throw notFound("Tick");
  const task = await loadForTick(user, tick.dailyTaskId);
  await db.$transaction(async (tx) => {
    await tx.dailyTaskTick.delete({ where: { id: tickId } });
    if (tick.offpageItemId) {
      await tx.offpageItem.updateMany({ where: { id: tick.offpageItemId, doneAt: { not: null } }, data: { doneAt: null, doneById: null, proofUrl: null } });
    }
    await logActivity(tx, task.clientId, user.id, "daily.untick", `${user.name} unticked one of: ${dailyTitle(task)}`, `/daily?date=${keyFromDbDate(task.date)}`);
    await writeAudit(tx, { actorId: user.id, action: "daily.untick", entityType: "DailyTask", entityId: task.id, before: { n: tick.n, proofUrl: tick.proofUrl, offpageItemId: tick.offpageItemId }, ip });
  });
}

// Someone's list for a day, plus anything unfinished from the two weeks before.
export async function myDay(user: SessionUser, date: string, now = new Date()) {
  if (!can(user.role, "daily.own")) throw forbidden();
  if (!isValidKey(date)) throw invalid("Pick a valid day.");
  const [today, earlier] = await Promise.all([
    db.dailyTask.findMany({ where: { assigneeId: user.id, date: dateFromKey(date) }, include, orderBy: { createdAt: "asc" } }),
    date === istDateKey(now)
      ? db.dailyTask.findMany({
          where: { assigneeId: user.id, date: { lt: dateFromKey(date), gte: dateFromKey(addDays(date, -CARRY_OVER_DAYS)) } },
          include,
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const list = today.map(view);
  return {
    date,
    tasks: list,
    leftOver: earlier.map(view).filter((t) => t.done < t.qty),
    progress: { done: list.reduce((s, t) => s + t.done, 0), planned: list.reduce((s, t) => s + t.qty, 0) },
  };
}

// Everyone's lists for a day, for the people who plan them.
export async function dayBoard(user: SessionUser, date: string) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  if (!isValidKey(date)) throw invalid("Pick a valid day.");
  const tasks = await db.dailyTask.findMany({
    where: { date: dateFromKey(date), client: visibleClients(user) },
    include,
    orderBy: [{ assignee: { name: "asc" } }, { createdAt: "asc" }],
  });
  const byPerson = new Map<string, { person: Loaded["assignee"]; tasks: DailyTaskView[] }>();
  for (const t of tasks) {
    const g = byPerson.get(t.assigneeId) ?? { person: t.assignee, tasks: [] };
    g.tasks.push(view(t));
    byPerson.set(t.assigneeId, g);
  }
  return [...byPerson.values()].map((g) => ({
    ...g,
    done: g.tasks.reduce((s, t) => s + t.done, 0),
    planned: g.tasks.reduce((s, t) => s + t.qty, 0),
  }));
}

// What the "add to someone's day" form offers: people, and each visible
// client with its off-page activities.
export async function planningOptions(user: SessionUser) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  const [people, clients] = await Promise.all([
    db.user.findMany({ where: { status: "ACTIVE", role: { in: ["STRATEGY", "EXECUTION", "OFFPAGE"] } }, orderBy: [{ role: "desc" }, { name: "asc" }], select: { id: true, name: true, role: true } }),
    db.client.findMany({
      where: { AND: [visibleClients(user), { status: { not: "CHURNED" } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, offpageActivities: { where: { removedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true, onlyMonth: true } } },
    }),
  ]);
  return { people, clients };
}

// Small count for the home page.
export async function todayProgress(user: SessionUser, now = new Date()) {
  if (!can(user.role, "daily.own")) return null;
  const tasks = await db.dailyTask.findMany({ where: { assigneeId: user.id, date: dateFromKey(istDateKey(now)) }, select: { qty: true, _count: { select: { ticks: true } } } });
  return { done: tasks.reduce((s, t) => s + t._count.ticks, 0), planned: tasks.reduce((s, t) => s + t.qty, 0) };
}
