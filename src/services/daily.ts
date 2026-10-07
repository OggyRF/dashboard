import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { dailyTitle, lineTitle, needsWriting, unitLabel } from "@/lib/daily-labels";
import { WEEKLY_OFF_DAYS, addDays, dateFromKey, istDateKey, isValidKey, keyFromDbDate, monthKeys, weekday } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { accessTo, ensureAssigned, logActivity, requireClient, visibleClients } from "@/services/clients";
import { holidaySet } from "@/services/leave";
import { notify } from "@/services/notifications";
import { ensureMonth, ensureMonthFor, weekOfDay } from "@/services/offpage";

type Tx = Prisma.TransactionClient;

// Daily task lists (Aarif, 6 Oct 2026). Each off-page person gets a list for
// every working day, made automatically from their clients' off-page plans
// so the month is finished on time, plus anything a lead adds by hand (a SERP
// update, an extra GMB post). A line such as "Guest Posting · Writing, 2 for
// IIT Bombay" is worked one piece at a time: Mark working, then Mark
// completed. A completed upload, with its live link, also ticks the next open
// box of that activity in the client's off-page checklist.

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
    followUpId: z
      .string()
      .optional()
      .transform((v) => v || null),
  })
  .refine((d) => d.work === "OTHER" || d.activityId, { message: "Pick the off-page activity.", path: ["activityId"] })
  .refine((d) => d.work !== "OTHER" || d.details, { message: "Say what needs doing.", path: ["details"] });

const person = { select: { id: true, name: true, avatarUpdatedAt: true } } as const;
const include = {
  client: { select: { id: true, name: true } },
  activity: { select: { id: true, name: true } },
  assignee: person,
  followUp: person,
  createdBy: { select: { id: true, name: true } },
  ticks: { orderBy: { n: "asc" }, include: { doneBy: { select: { id: true, name: true } } } },
} satisfies Prisma.DailyTaskInclude;

type Loaded = Prisma.DailyTaskGetPayload<{ include: typeof include }>;

export type UnitStatus = "TODO" | "WORKING" | "DONE";

function view(t: Loaded) {
  const byN = new Map(t.ticks.map((k) => [k.n, k]));
  const units = Array.from({ length: t.qty }, (_, i) => {
    const n = i + 1;
    const k = byN.get(n);
    const status: UnitStatus = !k ? "TODO" : k.doneAt ? "DONE" : "WORKING";
    return {
      n,
      label: unitLabel(t, n),
      status,
      tickId: k?.id ?? null,
      proofUrl: k?.proofUrl ?? null,
      startedAt: k?.startedAt.toISOString() ?? null,
      doneAt: k?.doneAt?.toISOString() ?? null,
      doneBy: k?.doneBy ?? null,
      linked: !!k?.offpageItemId,
    };
  });
  return {
    id: t.id,
    date: keyFromDbDate(t.date),
    work: t.work,
    qty: t.qty,
    details: t.details,
    auto: t.auto,
    title: dailyTitle(t),
    heading: lineTitle(t),
    client: t.client,
    activity: t.activity,
    assignee: t.assignee,
    followUp: t.followUp,
    createdBy: t.createdBy,
    units,
    done: units.filter((u) => u.status === "DONE").length,
    working: units.filter((u) => u.status === "WORKING").length,
  };
}
export type DailyTaskView = ReturnType<typeof view>;

// Who checks someone's work on a client: its SEO Project Manager, or its
// strategist when the manager is the doer.
function defaultFollowUp(client: { executionOwnerId: string | null; strategicOwnerId: string | null }, doerId: string) {
  if (client.executionOwnerId && client.executionOwnerId !== doerId) return client.executionOwnerId;
  if (client.strategicOwnerId && client.strategicOwnerId !== doerId) return client.strategicOwnerId;
  return null;
}

export async function addDailyTask(user: SessionUser, input: unknown, ip: string | null, now = new Date()) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  const data = dailySchema.parse(input);
  const { client } = await requireClient(user, data.clientId);
  if (data.date < addDays(istDateKey(now), -1)) throw invalid("Plan today or a day ahead, not the past.");
  const doer = await db.user.findUnique({ where: { id: data.assigneeId } });
  if (!doer || doer.status !== "ACTIVE" || !can(doer.role, "daily.own")) throw invalid("Pick an active team member (not an owner).");
  if (data.activityId) {
    const a = await db.offpageActivity.findUnique({ where: { id: data.activityId } });
    if (!a || a.clientId !== client.id || a.removedAt) throw invalid("That activity is not in this client's off-page plan.");
  }
  let followUpId = data.followUpId ?? defaultFollowUp(client, doer.id) ?? (user.id !== doer.id ? user.id : null);
  if (data.followUpId) {
    const f = await db.user.findUnique({ where: { id: data.followUpId } });
    if (!f || f.status !== "ACTIVE" || !can(f.role, "daily.assign")) throw invalid("Pick an owner, strategist or manager to follow up.");
    if (f.id === doer.id) throw invalid("The person following up must be someone else.");
    followUpId = f.id;
  }
  return db.$transaction(async (tx) => {
    const task = await tx.dailyTask.create({
      data: { ...data, followUpId, date: dateFromKey(data.date), createdById: user.id },
      include,
    });
    await ensureAssigned(tx, client.id, doer.id, doer.role === "OFFPAGE" ? "OFFPAGE" : "EXECUTION");
    if (doer.id !== user.id) {
      const when = data.date === istDateKey(now) ? "today" : data.date;
      await notify(tx, [doer.id], `${user.name} added to your list for ${when}: ${dailyTitle(task)} for ${client.name}`, `/daily?date=${data.date}`);
    }
    await writeAudit(tx, { actorId: user.id, action: "daily.create", entityType: "DailyTask", entityId: task.id, after: { ...data, followUpId }, ip });
    return view(task);
  });
}

export async function removeDailyTask(user: SessionUser, id: string, ip: string | null) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  const task = await db.dailyTask.findUnique({ where: { id }, include });
  if (!task || (await accessTo(user, task.clientId)) !== "full") throw notFound("Daily task");
  if (task.ticks.length) throw invalid("Work on this has already started. Undo it first if it was a mistake.");
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

// The doer, the person following up, and leads with full access may move a
// piece along.
async function loadForWork(user: SessionUser, id: string) {
  const task = await db.dailyTask.findUnique({ where: { id }, include });
  const access = task ? await accessTo(user, task.clientId) : null;
  if (!task || !access) throw notFound("Daily task");
  const lead = access === "full" && can(user.role, "daily.assign");
  if (task.assigneeId !== user.id && task.followUpId !== user.id && !lead) throw forbidden();
  return task;
}

function checkUnit(task: Loaded, nInput: unknown, now: Date) {
  const n = Number(nInput);
  if (!Number.isInteger(n) || n < 1 || n > task.qty) throw invalid("That piece is not on this line.");
  if (keyFromDbDate(task.date) > istDateKey(now)) throw invalid("This is on a later day's list.");
  return n;
}

// Mark working: the piece is being done now.
export async function startUnit(user: SessionUser, id: string, nInput: unknown, ip: string | null, now = new Date()) {
  const task = await loadForWork(user, id);
  const n = checkUnit(task, nInput, now);
  if (task.ticks.some((k) => k.n === n)) throw invalid("This piece is already started.");
  await db.$transaction(async (tx) => {
    await tx.dailyTaskTick.create({ data: { dailyTaskId: id, n, startedAt: now, doneById: user.id } });
    await writeAudit(tx, { actorId: user.id, action: "daily.start", entityType: "DailyTask", entityId: id, after: { n }, ip });
  });
}

// Mark completed. Uploads need the live link and tick the oldest open box of
// that activity in the client's checklist this month.
export async function completeUnit(user: SessionUser, id: string, nInput: unknown, proofInput: unknown, ip: string | null, now = new Date()) {
  const task = await loadForWork(user, id);
  const n = checkUnit(task, nInput, now);
  const existing = task.ticks.find((k) => k.n === n);
  if (existing?.doneAt) throw invalid("This piece is already completed.");
  const proof = proofSchema.parse(proofInput ?? undefined);
  if (task.work === "UPLOADING" && !proof) throw invalid("Add the live link of the upload.");
  const date = keyFromDbDate(task.date);
  return db.$transaction(async (tx) => {
    let offpageItemId: string | null = null;
    if (task.work === "UPLOADING" && task.activityId) {
      offpageItemId = await tickChecklist(tx, user, task.clientId, task.activityId, proof, now);
    }
    const data = { doneAt: now, doneById: user.id, proofUrl: proof, offpageItemId };
    if (existing) {
      const { count } = await tx.dailyTaskTick.updateMany({ where: { id: existing.id, doneAt: null }, data });
      if (count === 0) throw invalid("This piece is already completed.");
    } else {
      await tx.dailyTaskTick.create({ data: { dailyTaskId: id, n, startedAt: now, ...data } });
    }
    const label = unitLabel(task, n);
    await logActivity(tx, task.clientId, user.id, "daily.tick", `${user.name} completed ${label} (${lineTitle(task)})${offpageItemId ? ", ticked in the off-page checklist" : ""}`, proof ?? `/daily?date=${date}`);
    const doneNow = task.ticks.filter((k) => k.doneAt).length + 1;
    if (doneNow === task.qty && task.followUpId && task.followUpId !== user.id) {
      await notify(tx, [task.followUpId], `${task.assignee.name} finished ${dailyTitle(task)} for ${task.client.name}`, `/daily?date=${date}`);
    }
    await writeAudit(tx, { actorId: user.id, action: "daily.complete", entityType: "DailyTask", entityId: id, after: { n, proofUrl: proof, offpageItemId }, ip });
    return { linked: !!offpageItemId, noBoxLeft: task.work === "UPLOADING" && !!task.activityId && !offpageItemId };
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

// Steps a piece back: a completed one goes back to working (and its
// checklist box is unticked), a working one back to not started.
export async function undoUnit(user: SessionUser, tickId: string, ip: string | null) {
  const tick = await db.dailyTaskTick.findUnique({ where: { id: tickId } });
  if (!tick) throw notFound("Piece");
  const task = await loadForWork(user, tick.dailyTaskId);
  await db.$transaction(async (tx) => {
    if (tick.doneAt) {
      await tx.dailyTaskTick.update({ where: { id: tickId }, data: { doneAt: null, proofUrl: null, offpageItemId: null } });
      if (tick.offpageItemId) {
        await tx.offpageItem.updateMany({ where: { id: tick.offpageItemId, doneAt: { not: null } }, data: { doneAt: null, doneById: null, proofUrl: null } });
      }
      await logActivity(tx, task.clientId, user.id, "daily.untick", `${user.name} reopened ${unitLabel(task, tick.n)} (${lineTitle(task)})`, `/daily?date=${keyFromDbDate(task.date)}`);
    } else {
      await tx.dailyTaskTick.delete({ where: { id: tickId } });
    }
    await writeAudit(tx, { actorId: user.id, action: "daily.undo", entityType: "DailyTask", entityId: task.id, before: { n: tick.n, done: !!tick.doneAt, proofUrl: tick.proofUrl, offpageItemId: tick.offpageItemId }, ip });
  });
}

// ---------------------------------------------------------------------------
// Automatic daily plan
// ---------------------------------------------------------------------------

// Someone's working days in a month: not Sunday, not a holiday, not a full
// day of approved leave.
async function workingDays(tx: Tx, userId: string, month: string) {
  const days = monthKeys(month);
  const [holidays, leave] = await Promise.all([
    holidaySet(days[0]!, days.at(-1)!),
    tx.leaveRequest.findMany({
      where: { userId, status: "APPROVED", halfDay: false, fromDate: { lte: dateFromKey(days.at(-1)!) }, toDate: { gte: dateFromKey(days[0]!) } },
      select: { fromDate: true, toDate: true },
    }),
  ]);
  const onLeave = (k: string) => leave.some((l) => keyFromDbDate(l.fromDate) <= k && k <= keyFromDbDate(l.toDate));
  return days.filter((k) => !WEEKLY_OFF_DAYS.includes(weekday(k)) && !holidays.has(k) && !onLeave(k));
}

// How many boxes should be done by the end of a working day: every box of the
// weeks before, plus an even share of that week's boxes for each of its
// working days gone by. `days` are the person's working days from the day the
// work started (a client added mid-month starts then).
function targetBy(day: string | null, boxesByWeek: Map<number, number>, days: string[]) {
  const all = [...boxesByWeek.values()].reduce((s, v) => s + v, 0);
  if (!day) return all;
  const week = weekOfDay(day);
  let before = 0;
  for (const [w, count] of boxesByWeek) if (w < week) before += count;
  const inWeek = days.filter((d) => weekOfDay(d) === week);
  const index = inWeek.indexOf(day) + 1;
  return Math.min(all, before + Math.ceil(((boxesByWeek.get(week) ?? 0) * index) / Math.max(inWeek.length, 1)));
}

// Today's share: the even daily pace, plus a slice of anything behind spread
// over the coming days rather than dumped on one day.
function shareToday(target: number, previousTarget: number, planned: number, daysLeft: number) {
  const pace = Math.max(0, target - Math.max(previousTarget, planned));
  const behind = Math.max(0, previousTarget - planned);
  return Math.max(0, Math.min(target - planned, pace + Math.ceil(behind / Math.max(daysLeft, 1))));
}

// Makes someone's list for today from the off-page boxes they own this month,
// once per day. Each activity gets an even daily share so every week of the
// checklist is met; work that needs writing (guest posts, articles) is
// written a day ahead of its upload. Unstarted pieces of earlier automatic
// lists are folded into today's share instead of piling up.
export async function ensureDailyPlan(userId: string, now = new Date()) {
  const today = istDateKey(now);
  const month = today.slice(0, 7);
  if (await db.dailyPlanRun.findUnique({ where: { userId_date: { userId, date: dateFromKey(today) } } })) return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, status: true, role: true } });
  if (!user || user.status !== "ACTIVE" || !can(user.role, "daily.own")) return false;
  const boxesWhere: Prisma.OffpageItemWhereInput = {
    month,
    activity: { removedAt: null },
    client: { status: { in: ["ACTIVE", "ONBOARDING"] } },
    OR: [{ assigneeId: userId }, { assigneeId: null, client: { offpageOwnerId: userId } }],
  };
  const clientIds = (await db.clientAssignment.findMany({ where: { userId }, select: { clientId: true } })).map((c) => c.clientId);
  await ensureMonthFor([...new Set(clientIds)], month, now);

  return db.$transaction(async (tx) => {
    const run = await tx.dailyPlanRun.createMany({ data: [{ userId, date: dateFromKey(today) }], skipDuplicates: true });
    if (run.count === 0) return false;
    const days = await workingDays(tx, userId, month);
    if (!days.includes(today)) return true;

    // Earlier automatic lines keep only the pieces already started.
    const older = await tx.dailyTask.findMany({ where: { assigneeId: userId, auto: true, date: { lt: dateFromKey(today) } }, include: { ticks: { orderBy: { n: "asc" } } } });
    for (const line of older) {
      if (line.ticks.length >= line.qty) continue;
      if (!line.ticks.length) {
        await tx.dailyTask.delete({ where: { id: line.id } });
        continue;
      }
      for (const [i, k] of line.ticks.entries()) if (k.n !== i + 1) await tx.dailyTaskTick.update({ where: { id: k.id }, data: { n: i + 1 } });
      await tx.dailyTask.update({ where: { id: line.id }, data: { qty: line.ticks.length } });
    }

    const boxes = await tx.offpageItem.findMany({
      where: boxesWhere,
      select: { week: true, doneAt: true, createdAt: true, activityId: true, activity: { select: { name: true } }, client: { select: { id: true, executionOwnerId: true, strategicOwnerId: true } } },
    });
    if (!boxes.length) return true;
    const activityIds = [...new Set(boxes.map((b) => b.activityId))];
    // Pieces already on someone's lists this month (any day), by activity and work.
    const lines = await tx.dailyTask.findMany({
      where: { activityId: { in: activityIds }, date: { gte: dateFromKey(`${month}-01`), lte: dateFromKey(today) } },
      select: { activityId: true, work: true, qty: true, assigneeId: true, ticks: { select: { doneAt: true } } },
    });
    const next = days[days.indexOf(today) + 1] ?? null;
    const previous = days[days.indexOf(today) - 1] ?? null;
    const plan: { clientId: string; activityId: string; work: "WRITING" | "UPLOADING"; qty: number; followUpId: string | null }[] = [];

    for (const activityId of activityIds) {
      const mine = boxes.filter((b) => b.activityId === activityId);
      const total = mine.length;
      const uploaded = mine.filter((b) => b.doneAt).length;
      const byWeek = new Map<number, number>();
      for (const b of mine) byWeek.set(b.week, (byWeek.get(b.week) ?? 0) + 1);
      const of = (work: "WRITING" | "UPLOADING") => lines.filter((l) => l.activityId === activityId && l.work === work);
      const completed = (work: "WRITING" | "UPLOADING") => of(work).reduce((s, l) => s + l.ticks.filter((k) => k.doneAt).length, 0);
      // Pieces of this person's lists still to finish (today's or carried over).
      const pending = (work: "WRITING" | "UPLOADING") => of(work).filter((l) => l.assigneeId === userId).reduce((s, l) => s + l.qty - l.ticks.filter((k) => k.doneAt).length, 0);

      // The plan runs from the day this activity's boxes were made this month.
      const start = mine.reduce((m, b) => (istDateKey(b.createdAt) < m ? istDateKey(b.createdAt) : m), today);
      const from = days.filter((d) => d >= start);
      const before = previous && previous >= start ? previous : null;
      const target = (d: string | null | undefined) => (d === undefined ? 0 : Math.min(total, targetBy(d, byWeek, from)));
      // Catch-up is spread over at least three working days (or what is left of the month).
      const daysLeft = Math.min(days.length - days.indexOf(today), Math.max(3, from.filter((d) => d >= today && weekOfDay(d) === weekOfDay(today)).length));

      const writes = needsWriting(mine[0]!.activity.name);
      let writeToday = 0;
      let written = total;
      if (writes) {
        written = Math.min(total, Math.max(completed("WRITING"), uploaded));
        // Writing runs a day ahead of uploading.
        writeToday = shareToday(target(next), target(today), written + pending("WRITING"), daysLeft);
      }
      const plannedUploads = uploaded + pending("UPLOADING");
      let uploadToday = shareToday(target(today), before ? target(before) : 0, plannedUploads, daysLeft);
      // Nothing goes up before it is written (writing done today counts).
      if (writes) uploadToday = Math.min(uploadToday, Math.max(0, written + pending("WRITING") + writeToday - plannedUploads));

      const client = mine[0]!.client;
      const followUpId = defaultFollowUp(client, userId);
      if (writeToday) plan.push({ clientId: client.id, activityId, work: "WRITING", qty: writeToday, followUpId });
      if (uploadToday) plan.push({ clientId: client.id, activityId, work: "UPLOADING", qty: uploadToday, followUpId });
    }
    if (plan.length) {
      await tx.dailyTask.createMany({ data: plan.map((p) => ({ ...p, assigneeId: userId, date: dateFromKey(today), auto: true })) });
    }
    return true;
  });
}

// Everyone's plan for today, from the nightly housekeeping and the leads' board.
export async function ensureAllDailyPlans(now = new Date()) {
  const people = await db.user.findMany({ where: { status: "ACTIVE", role: { in: ["STRATEGY", "EXECUTION", "OFFPAGE"] } }, select: { id: true } });
  let made = 0;
  for (const p of people) if (await ensureDailyPlan(p.id, now)) made++;
  return made;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

// Lines grouped by client, in the order they should be worked: writing before
// uploading, automatic plan before extra work.
export type ClientGroup = { client: { id: string; name: string }; lines: (DailyTaskView & { carried: boolean })[]; done: number; planned: number };
const WORK_ORDER = { WRITING: 0, UPLOADING: 1, OTHER: 2 } as const;
function byClient(lines: (DailyTaskView & { carried: boolean })[]): ClientGroup[] {
  const groups = new Map<string, ClientGroup>();
  for (const l of lines) {
    const g = groups.get(l.client.id) ?? { client: l.client, lines: [], done: 0, planned: 0 };
    g.lines.push(l);
    g.done += l.done;
    g.planned += l.qty;
    groups.set(l.client.id, g);
  }
  for (const g of groups.values()) {
    g.lines.sort((a, b) => Number(b.carried) - Number(a.carried) || WORK_ORDER[a.work] - WORK_ORDER[b.work] || (a.activity?.name ?? "").localeCompare(b.activity?.name ?? ""));
  }
  return [...groups.values()].sort((a, b) => a.client.name.localeCompare(b.client.name));
}

// Someone's list for a day, plus anything unfinished from the two weeks before,
// grouped by client.
export async function myDay(user: SessionUser, date: string, now = new Date()) {
  if (!can(user.role, "daily.own")) throw forbidden();
  if (!isValidKey(date)) throw invalid("Pick a valid day.");
  const isToday = date === istDateKey(now);
  if (isToday) await ensureDailyPlan(user.id, now);
  const [today, earlier] = await Promise.all([
    db.dailyTask.findMany({ where: { assigneeId: user.id, date: dateFromKey(date) }, include, orderBy: { createdAt: "asc" } }),
    isToday
      ? db.dailyTask.findMany({
          where: { assigneeId: user.id, date: { lt: dateFromKey(date), gte: dateFromKey(addDays(date, -CARRY_OVER_DAYS)) } },
          include,
          orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const lines = [
    ...earlier.map(view).filter((t) => t.done < t.qty).map((t) => ({ ...t, carried: true })),
    ...today.map(view).map((t) => ({ ...t, carried: false })),
  ];
  return {
    date,
    clients: byClient(lines),
    progress: { done: lines.reduce((s, t) => s + t.done, 0), planned: lines.reduce((s, t) => s + t.qty, 0) },
  };
}

// Everyone's lists for a day, for the people who plan them.
export async function dayBoard(user: SessionUser, date: string, now = new Date()) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  if (!isValidKey(date)) throw invalid("Pick a valid day.");
  if (date === istDateKey(now)) await ensureAllDailyPlans(now);
  const tasks = await db.dailyTask.findMany({
    where: { date: dateFromKey(date), client: visibleClients(user) },
    include,
    orderBy: [{ assignee: { name: "asc" } }, { client: { name: "asc" } }, { createdAt: "asc" }],
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

// What the "add a task" form offers: people, those who can follow up, and each
// visible client with its off-page activities.
export async function planningOptions(user: SessionUser) {
  if (!can(user.role, "daily.assign")) throw forbidden();
  const [people, clients] = await Promise.all([
    db.user.findMany({ where: { status: "ACTIVE", role: { in: ["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"] } }, orderBy: [{ role: "desc" }, { name: "asc" }], select: { id: true, name: true, role: true } }),
    db.client.findMany({
      where: { AND: [visibleClients(user), { status: { not: "CHURNED" } }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        executionOwnerId: true,
        strategicOwnerId: true,
        offpageActivities: { where: { removedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true, onlyMonth: true } },
      },
    }),
  ]);
  return {
    people: people.filter((p) => can(p.role, "daily.own")),
    followers: people.filter((p) => can(p.role, "daily.assign")),
    clients,
  };
}

// Small count for the home page.
export async function todayProgress(user: SessionUser, now = new Date()) {
  if (!can(user.role, "daily.own")) return null;
  await ensureDailyPlan(user.id, now);
  const tasks = await db.dailyTask.findMany({
    where: { assigneeId: user.id, date: dateFromKey(istDateKey(now)) },
    select: { qty: true, _count: { select: { ticks: { where: { doneAt: { not: null } } } } } },
  });
  return { done: tasks.reduce((s, t) => s + t._count.ticks, 0), planned: tasks.reduce((s, t) => s + t.qty, 0) };
}
