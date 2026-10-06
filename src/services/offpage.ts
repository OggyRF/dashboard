import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { istDateKey, isValidMonth } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { accessTo, ensureAssigned, logActivity, requireClient, visibleClients } from "@/services/clients";
import { notify } from "@/services/notifications";

type Tx = Prisma.TransactionClient;

// Off-page tracker (plan section 14). Each client has standing monthly
// activities; on the first view of a month they become one checkbox per piece
// of work, spread over four weeks.

export const WEEKS = [1, 2, 3, 4] as const;

// Suggestions for the activity name box; any name can be typed.
export const ACTIVITY_SUGGESTIONS = [
  "Guest Posting",
  "Web 2.0",
  "Image Submission",
  "Social Bookmarking",
  "Quora Answers",
  "Reddit Post",
  "Profile Creation",
  "Article Submission",
  "PDF Submission",
  "Business Listing",
  "Classified Ads",
  "Blog Commenting",
  "Infographic Submission",
  "Video Submission",
  "Press Release",
];

// Week 1 is days 1 to 7, week 2 days 8 to 14, week 3 days 15 to 21, week 4
// day 22 to the end of the month.
export function weekOfDay(dayKey: string): number {
  const day = Number(dayKey.slice(8, 10));
  return Math.min(4, Math.floor((day - 1) / 7) + 1);
}

export const WEEK_RANGES: Record<number, string> = { 1: "1–7", 2: "8–14", 3: "15–21", 4: "22–end" };

// 10 becomes 3, 3, 2, 2 and 5 becomes 2, 1, 1, 1.
export function splitQuantity(qty: number): number[] {
  const base = Math.floor(qty / 4);
  const rest = qty % 4;
  return WEEKS.map((w) => base + (w <= rest ? 1 : 0));
}

export function currentMonth(now = new Date()) {
  return istDateKey(now).slice(0, 7);
}

export function currentWeek(now = new Date()) {
  return weekOfDay(istDateKey(now));
}

// Activities that apply in a month: the standing plan plus extras added for
// that month only.
function activeIn(month: string): Prisma.OffpageActivityWhereInput {
  return { removedAt: null, OR: [{ onlyMonth: null }, { onlyMonth: month }] };
}

// How many of an activity a month gets: a one-month change if there is one,
// otherwise the usual monthly number.
async function quantities(tx: Tx, activities: { id: string; monthlyQty: number }[], month: string) {
  const changes = await tx.offpageMonthQty.findMany({ where: { month, activityId: { in: activities.map((a) => a.id) } } });
  const changed = new Map(changes.map((c) => [c.activityId, c.qty]));
  return new Map(activities.map((a) => [a.id, changed.get(a.id) ?? a.monthlyQty]));
}

// Creates the client's checklist for the month the first time it is needed.
// Only the current month is ever created; a plan made part-way through the
// month starts from the current week.
export async function ensureMonth(tx: Tx, clientId: string, month: string, now = new Date()) {
  if (month !== currentMonth(now)) return false;
  const created = await tx.offpageMonth.createMany({ data: [{ clientId, month }], skipDuplicates: true });
  if (created.count === 0) return false;
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { status: true } });
  if (client.status === "PAUSED" || client.status === "CHURNED") return true;
  const activities = await tx.offpageActivity.findMany({ where: { clientId, ...activeIn(month) } });
  const qty = await quantities(tx, activities, month);
  const fromWeek = currentWeek(now);
  const items: Prisma.OffpageItemCreateManyInput[] = [];
  for (const a of activities) {
    splitQuantity(qty.get(a.id)!).forEach((count, i) => {
      const week = i + 1;
      if (week < fromWeek) return;
      for (let n = 0; n < count; n++) items.push({ clientId, activityId: a.id, month, week, assigneeId: a.assigneeId });
    });
  }
  if (items.length) await tx.offpageItem.createMany({ data: items });
  return true;
}

async function ensureMonthFor(clientIds: string[], month: string, now: Date) {
  if (month !== currentMonth(now) || !clientIds.length) return;
  const have = await db.offpageMonth.findMany({ where: { month, clientId: { in: clientIds } }, select: { clientId: true } });
  const done = new Set(have.map((h) => h.clientId));
  for (const id of clientIds) {
    if (!done.has(id)) await db.$transaction((tx) => ensureMonth(tx, id, month, now));
  }
}

// Brings this month's unticked boxes for one activity in line with its
// current quantity and assignee, from the current week on. Earlier weeks and
// ticked boxes are never touched.
async function applyToCurrentMonth(tx: Tx, activityId: string, now: Date) {
  const activity = await tx.offpageActivity.findUniqueOrThrow({ where: { id: activityId } });
  const month = currentMonth(now);
  // A month not planned yet is planned now, from the activities as they are.
  if (await ensureMonth(tx, activity.clientId, month, now)) return;
  const fromWeek = currentWeek(now);
  const qty = (await quantities(tx, [activity], month)).get(activity.id)!;
  const target = activity.removedAt || (activity.onlyMonth && activity.onlyMonth !== month) ? [0, 0, 0, 0] : splitQuantity(qty);
  for (const week of WEEKS) {
    if (week < fromWeek) continue;
    const items = await tx.offpageItem.findMany({ where: { activityId, month, week }, orderBy: { createdAt: "asc" } });
    const want = target[week - 1]!;
    if (items.length < want) {
      await tx.offpageItem.createMany({
        data: Array.from({ length: want - items.length }, () => ({ clientId: activity.clientId, activityId, month, week, assigneeId: activity.assigneeId })),
      });
    } else if (items.length > want) {
      const spare = items.filter((i) => !i.doneAt).reverse().slice(0, items.length - want);
      await tx.offpageItem.deleteMany({ where: { id: { in: spare.map((i) => i.id) } } });
    }
    await tx.offpageItem.updateMany({ where: { activityId, month, week, doneAt: null }, data: { assigneeId: activity.assigneeId } });
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export const activitySchema = z.object({
  name: z.string().trim().min(2, "Name the activity.").max(80),
  monthlyQty: z.coerce.number().int("Use a whole number.").min(1, "Plan at least 1 a month.").max(500, "That is more than 500 a month."),
  assigneeId: z
    .string()
    .optional()
    .transform((v) => v || null),
  reviewerId: z
    .string()
    .optional()
    .transform((v) => v || null),
  applyNow: z.coerce.boolean().default(false),
});

async function requirePlanner(user: SessionUser, clientId: string) {
  if (!can(user.role, "offpage.plan")) throw forbidden();
  return requireClient(user, clientId);
}

async function checkPeople(tx: Tx, assigneeId: string | null, reviewerId: string | null) {
  if (assigneeId) {
    const a = await tx.user.findUnique({ where: { id: assigneeId } });
    if (!a || a.status !== "ACTIVE") throw invalid("Pick an active team member to do the work.");
  }
  if (reviewerId) {
    const r = await tx.user.findUnique({ where: { id: reviewerId } });
    if (!r || r.status !== "ACTIVE" || r.role === "OFFPAGE") throw invalid("Pick an owner, strategy or execution person to check the work.");
  }
  if (assigneeId && assigneeId === reviewerId) throw invalid("The person checking the work must be someone else.");
}

async function addToTeam(tx: Tx, clientId: string, userId: string | null) {
  if (!userId) return;
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  if (u.role === "OFFPAGE") await ensureAssigned(tx, clientId, userId, "OFFPAGE");
  else if (u.role === "EXECUTION") await ensureAssigned(tx, clientId, userId, "EXECUTION");
}

export async function addActivity(user: SessionUser, clientId: string, input: unknown, ip: string | null, now = new Date()) {
  await requirePlanner(user, clientId);
  const data = activitySchema.parse(input);
  return db.$transaction(async (tx) => {
    await checkPeople(tx, data.assigneeId, data.reviewerId);
    const position = await tx.offpageActivity.count({ where: { clientId } });
    const { applyNow, ...fields } = data;
    const activity = await tx.offpageActivity.create({ data: { ...fields, clientId, position } });
    await addToTeam(tx, clientId, data.assigneeId);
    if (applyNow) await applyToCurrentMonth(tx, activity.id, now);
    await logActivity(tx, clientId, user.id, "offpage.plan", `${user.name} added ${activity.name} (${activity.monthlyQty} a month) to the off-page plan`, `/clients/${clientId}/off-page`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.activity.create", entityType: "OffpageActivity", entityId: activity.id, after: { ...fields, applyNow }, ip });
    return activity;
  });
}

export async function updateActivity(user: SessionUser, activityId: string, input: unknown, ip: string | null, now = new Date()) {
  const before = await db.offpageActivity.findUnique({ where: { id: activityId } });
  if (!before || before.removedAt) throw notFound("Activity");
  await requirePlanner(user, before.clientId);
  const data = activitySchema.parse(input);
  return db.$transaction(async (tx) => {
    await checkPeople(tx, data.assigneeId, data.reviewerId);
    const { applyNow, ...fields } = data;
    const activity = await tx.offpageActivity.update({ where: { id: activityId }, data: fields });
    await addToTeam(tx, before.clientId, data.assigneeId);
    if (applyNow) await applyToCurrentMonth(tx, activityId, now);
    await logActivity(tx, before.clientId, user.id, "offpage.plan", `${user.name} changed ${activity.name} in the off-page plan${applyNow ? " (from this week)" : " (from next month)"}`, `/clients/${before.clientId}/off-page`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.activity.update", entityType: "OffpageActivity", entityId: activityId, before: { name: before.name, monthlyQty: before.monthlyQty, assigneeId: before.assigneeId, reviewerId: before.reviewerId }, after: { ...fields, applyNow }, ip });
    return activity;
  });
}

export async function removeActivity(user: SessionUser, activityId: string, applyNow: boolean, ip: string | null, now = new Date()) {
  const before = await db.offpageActivity.findUnique({ where: { id: activityId } });
  if (!before || before.removedAt) throw notFound("Activity");
  await requirePlanner(user, before.clientId);
  await db.$transaction(async (tx) => {
    await tx.offpageActivity.update({ where: { id: activityId }, data: { removedAt: now } });
    if (applyNow) await applyToCurrentMonth(tx, activityId, now);
    await logActivity(tx, before.clientId, user.id, "offpage.plan", `${user.name} removed ${before.name} from the off-page plan${applyNow ? " (from this week)" : " (from next month)"}`, `/clients/${before.clientId}/off-page`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.activity.remove", entityType: "OffpageActivity", entityId: activityId, before: { name: before.name, monthlyQty: before.monthlyQty }, after: { applyNow }, ip });
  });
}

// Copies another client's activity list (handy when many clients share a package).
export async function copyActivities(user: SessionUser, fromClientId: string, toClientId: string, ip: string | null, now = new Date()) {
  await requirePlanner(user, toClientId);
  await requireClient(user, fromClientId);
  const source = await db.offpageActivity.findMany({ where: { clientId: fromClientId, removedAt: null, onlyMonth: null }, orderBy: { position: "asc" } });
  if (!source.length) throw invalid("That client has no off-page activities to copy.");
  for (const a of source) {
    await addActivity(user, toClientId, { name: a.name, monthlyQty: a.monthlyQty, assigneeId: a.assigneeId ?? "", reviewerId: a.reviewerId ?? "", applyNow: true }, ip, now);
  }
  return source.length;
}

// ---------------------------------------------------------------------------
// One month's plan
// ---------------------------------------------------------------------------

// Months that can still be changed: this one and the next twelve.
function editableMonth(month: string, now: Date) {
  if (!isValidMonth(month)) throw invalid("Pick a valid month.");
  const cur = currentMonth(now);
  const [y, m] = cur.split("-").map(Number) as [number, number];
  const last = `${y + 1}-${String(m).padStart(2, "0")}`;
  if (month < cur) throw invalid("Past months cannot be changed.");
  if (month > last) throw invalid("Plan at most a year ahead.");
}

// Makes this month hold `qty` boxes of the activity in total. Boxes in past
// weeks and ticked boxes stay; the rest is spread over the weeks still to come.
async function reconcileMonth(tx: Tx, activityId: string, month: string, qty: number, now: Date) {
  const activity = await tx.offpageActivity.findUniqueOrThrow({ where: { id: activityId } });
  if (await ensureMonth(tx, activity.clientId, month, now)) return;
  if (!(await tx.offpageMonth.findUnique({ where: { clientId_month: { clientId: activity.clientId, month } } }))) return;
  const fromWeek = month === currentMonth(now) ? currentWeek(now) : 1;
  const items = await tx.offpageItem.findMany({ where: { activityId, month }, orderBy: { createdAt: "asc" } });
  const past = items.filter((i) => i.week < fromWeek).length;
  const left = Math.max(0, qty - past);
  const weeks = WEEKS.filter((w) => w >= fromWeek);
  const share = (i: number) => Math.floor(left / weeks.length) + (i < left % weeks.length ? 1 : 0);
  for (const [i, week] of weeks.entries()) {
    const inWeek = items.filter((it) => it.week === week);
    const want = share(i);
    if (inWeek.length < want) {
      await tx.offpageItem.createMany({
        data: Array.from({ length: want - inWeek.length }, () => ({ clientId: activity.clientId, activityId, month, week, assigneeId: activity.assigneeId })),
      });
    } else if (inWeek.length > want) {
      const spare = inWeek.filter((it) => !it.doneAt).reverse().slice(0, inWeek.length - want);
      await tx.offpageItem.deleteMany({ where: { id: { in: spare.map((it) => it.id) } } });
    }
  }
}

// The activities of one month with the usual and the planned number, for the
// "This month only" editor.
export async function monthPlan(user: SessionUser, clientId: string, month: string) {
  await requirePlanner(user, clientId);
  const activities = await db.offpageActivity.findMany({
    where: { clientId, ...activeIn(month) },
    orderBy: [{ onlyMonth: { sort: "asc", nulls: "first" } }, { position: "asc" }],
    include: { assignee: { select: { name: true } } },
  });
  const qty = await quantities(db, activities, month);
  return activities.map((a) => ({
    id: a.id,
    name: a.name,
    assignee: a.assignee?.name ?? null,
    usual: a.onlyMonth ? 0 : a.monthlyQty,
    qty: qty.get(a.id)!,
    extra: !!a.onlyMonth,
  }));
}

// Changes how many of an activity one month gets, e.g. 15 image submissions
// in December. The usual monthly number is left alone.
export async function setMonthQty(user: SessionUser, activityId: string, month: string, qtyInput: unknown, ip: string | null, now = new Date()) {
  const activity = await db.offpageActivity.findUnique({ where: { id: activityId } });
  if (!activity || activity.removedAt) throw notFound("Activity");
  await requirePlanner(user, activity.clientId);
  editableMonth(month, now);
  if (activity.onlyMonth && activity.onlyMonth !== month) throw notFound("Activity");
  const qty = z.coerce.number().int("Use a whole number.").min(0, "Use 0 or more.").max(500, "That is more than 500 a month.").parse(qtyInput);
  return db.$transaction(async (tx) => {
    const before = (await quantities(tx, [activity], month)).get(activityId)!;
    if (activity.onlyMonth) {
      await tx.offpageActivity.update({ where: { id: activityId }, data: { monthlyQty: qty } });
    } else if (qty === activity.monthlyQty) {
      await tx.offpageMonthQty.deleteMany({ where: { activityId, month } });
    } else {
      await tx.offpageMonthQty.upsert({
        where: { activityId_month: { activityId, month } },
        create: { activityId, month, clientId: activity.clientId, qty },
        update: { qty },
      });
    }
    if (month === currentMonth(now)) await reconcileMonth(tx, activityId, month, qty, now);
    await logActivity(tx, activity.clientId, user.id, "offpage.month", `${user.name} set ${activity.name} to ${qty} for ${monthLabel(month)} (was ${before})`, `/clients/${activity.clientId}/off-page?month=${month}`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.month_qty", entityType: "OffpageActivity", entityId: activityId, before: { month, qty: before }, after: { month, qty }, ip });
  });
}

export const extraActivitySchema = activitySchema.pick({ name: true, monthlyQty: true, assigneeId: true });

// Adds work to one month only, e.g. a press release in January.
export async function addMonthActivity(user: SessionUser, clientId: string, month: string, input: unknown, ip: string | null, now = new Date()) {
  await requirePlanner(user, clientId);
  editableMonth(month, now);
  const data = extraActivitySchema.parse(input);
  return db.$transaction(async (tx) => {
    await checkPeople(tx, data.assigneeId, null);
    const position = await tx.offpageActivity.count({ where: { clientId } });
    const activity = await tx.offpageActivity.create({ data: { ...data, clientId, position, onlyMonth: month } });
    await addToTeam(tx, clientId, data.assigneeId);
    if (month === currentMonth(now)) await reconcileMonth(tx, activity.id, month, data.monthlyQty, now);
    await logActivity(tx, clientId, user.id, "offpage.month", `${user.name} added ${activity.name} (${activity.monthlyQty}) for ${monthLabel(month)} only`, `/clients/${clientId}/off-page?month=${month}`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.activity.create", entityType: "OffpageActivity", entityId: activity.id, after: { ...data, onlyMonth: month }, ip });
    return activity;
  });
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(month: string) {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Ticking
// ---------------------------------------------------------------------------

const proofSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      return new URL(withScheme).toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "The proof link does not look like a web address." });
      return z.NEVER;
    }
  });

async function loadItem(user: SessionUser, itemId: string) {
  const item = await db.offpageItem.findUnique({ where: { id: itemId }, include: { activity: true, client: { select: { id: true, name: true, executionOwnerId: true } } } });
  const access = item ? await accessTo(user, item.clientId) : null;
  if (!item || !access) throw notFound("Checklist item");
  return { item, access };
}

export async function tickItem(user: SessionUser, itemId: string, proofUrl: unknown, ip: string | null, now = new Date()) {
  if (!can(user.role, "offpage.tick")) throw forbidden();
  const { item, access } = await loadItem(user, itemId);
  if (access !== "full" && item.assigneeId !== user.id) throw forbidden();
  if (item.month > currentMonth(now)) throw invalid("That month has not started yet.");
  const proof = proofSchema.parse(proofUrl ?? undefined);
  return db.$transaction(async (tx) => {
    const updated = await tx.offpageItem.update({
      where: { id: itemId },
      data: { doneAt: now, doneById: user.id, proofUrl: proof, rejectedAt: null, rejectedById: null, rejectReason: null },
    });
    await logActivity(tx, item.clientId, user.id, "offpage.tick", `${user.name} ticked ${item.activity.name} (week ${item.week})`, proof ?? `/clients/${item.clientId}/off-page`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.tick", entityType: "OffpageItem", entityId: itemId, after: { proofUrl: proof }, ip });
    return updated;
  });
}

export async function untickItem(user: SessionUser, itemId: string, ip: string | null) {
  const { item, access } = await loadItem(user, itemId);
  if (!item.doneAt) return item;
  if (access !== "full" && item.doneById !== user.id) throw forbidden();
  return db.$transaction(async (tx) => {
    const updated = await tx.offpageItem.update({ where: { id: itemId }, data: { doneAt: null, doneById: null, proofUrl: null } });
    // A daily list line that ticked this box is open again too.
    await tx.dailyTaskTick.deleteMany({ where: { offpageItemId: itemId } });
    await logActivity(tx, item.clientId, user.id, "offpage.untick", `${user.name} unticked ${item.activity.name} (week ${item.week})`, `/clients/${item.clientId}/off-page`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.untick", entityType: "OffpageItem", entityId: itemId, before: { doneById: item.doneById, proofUrl: item.proofUrl }, ip });
    return updated;
  });
}

export function canReview(user: SessionUser, item: { activity: { reviewerId: string | null }; client: { executionOwnerId: string | null } }) {
  if (!can(user.role, "offpage.review")) return false;
  if (user.role === "OWNER" || user.role === "STRATEGY") return true;
  return item.activity.reviewerId === user.id || item.client.executionOwnerId === user.id;
}

export async function rejectItem(user: SessionUser, itemId: string, reason: unknown, ip: string | null, now = new Date()) {
  const { item } = await loadItem(user, itemId);
  if (!canReview(user, item)) throw forbidden();
  const why = z.string().trim().min(3, "Say what is wrong so it can be fixed.").max(500).parse(reason);
  if (!item.doneAt) throw invalid("Only ticked items can be sent back.");
  return db.$transaction(async (tx) => {
    const updated = await tx.offpageItem.update({
      where: { id: itemId },
      data: { doneAt: null, doneById: null, rejectedAt: now, rejectedById: user.id, rejectReason: why },
    });
    await tx.dailyTaskTick.deleteMany({ where: { offpageItemId: itemId } });
    if (item.doneById && item.doneById !== user.id) {
      await notify(tx, [item.doneById], `${user.name} sent back ${item.activity.name} for ${item.client.name}: ${why}`, `/clients/${item.clientId}/off-page`);
    }
    await logActivity(tx, item.clientId, user.id, "offpage.reject", `${user.name} sent back ${item.activity.name} (week ${item.week}): ${why}`, `/clients/${item.clientId}/off-page`);
    await writeAudit(tx, { actorId: user.id, action: "offpage.reject", entityType: "OffpageItem", entityId: itemId, before: { doneById: item.doneById, proofUrl: item.proofUrl }, after: { reason: why }, ip });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const personSelect = { id: true, name: true, avatarUpdatedAt: true } as const;

export type Progress = { done: number; planned: number };

// Done boxes first, then sent-back ones, then the rest, so a row fills up
// from the left.
function boxOrder(a: { doneAt: Date | null; rejectReason: string | null }, b: { doneAt: Date | null; rejectReason: string | null }) {
  const rank = (i: typeof a) => (i.doneAt ? 0 : i.rejectReason ? 1 : 2);
  return rank(a) - rank(b) || (a.doneAt?.getTime() ?? 0) - (b.doneAt?.getTime() ?? 0);
}
const pct = (p: Progress) => (p.planned ? Math.round((p.done / p.planned) * 100) : 0);
export { pct as progressPercent };

// One client's month: a bar per week, one for the month, and a row per activity.
export async function clientMonth(user: SessionUser, clientId: string, month: string, now = new Date()) {
  const { access } = await requireClient(user, clientId, "offpage");
  if (!isValidMonth(month)) throw invalid("Pick a valid month.");
  await db.$transaction((tx) => ensureMonth(tx, clientId, month, now));
  const [items, activities, client] = await Promise.all([
    db.offpageItem.findMany({
      where: { clientId, month },
      orderBy: [{ week: "asc" }, { createdAt: "asc" }],
      include: { doneBy: { select: personSelect }, rejectedBy: { select: personSelect }, assignee: { select: personSelect } },
    }),
    db.offpageActivity.findMany({
      where: { clientId, OR: [activeIn(month), { items: { some: { month } } }] },
      orderBy: { position: "asc" },
      include: { assignee: { select: personSelect }, reviewer: { select: personSelect } },
    }),
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, executionOwnerId: true } }),
  ]);
  const weeks = WEEKS.map((w) => {
    const inWeek = items.filter((i) => i.week === w);
    return { week: w, done: inWeek.filter((i) => i.doneAt).length, planned: inWeek.length };
  });
  const rows = activities.map((a) => ({
    activity: a,
    weeks: WEEKS.map((w) => items.filter((i) => i.activityId === a.id && i.week === w).sort(boxOrder)),
    done: items.filter((i) => i.activityId === a.id && i.doneAt).length,
    planned: items.filter((i) => i.activityId === a.id).length,
  }));
  const reviewer = (a: { reviewerId: string | null }) => canReview(user, { activity: a, client });
  return {
    month,
    access,
    planned: month === currentMonth(now) ? true : items.length > 0,
    isCurrent: month === currentMonth(now),
    currentWeek: month === currentMonth(now) ? currentWeek(now) : month < currentMonth(now) ? 5 : 0,
    weeks,
    total: { done: weeks.reduce((s, w) => s + w.done, 0), planned: weeks.reduce((s, w) => s + w.planned, 0) },
    rows: rows.map((r) => ({ ...r, canReview: reviewer(r.activity) })),
    canPlan: access === "full" && can(user.role, "offpage.plan"),
  };
}

// An off-page person's week: this week's boxes and anything left from earlier
// weeks of the month, across all their clients.
export async function myWeek(user: SessionUser, now = new Date()) {
  const month = currentMonth(now);
  const week = currentWeek(now);
  const mine = await db.clientAssignment.findMany({ where: { userId: user.id }, select: { clientId: true } });
  await ensureMonthFor([...new Set(mine.map((m) => m.clientId))], month, now);
  const items = await db.offpageItem.findMany({
    where: { assigneeId: user.id, month, OR: [{ week }, { week: { lt: week }, doneAt: null }] },
    orderBy: [{ week: "asc" }, { createdAt: "asc" }],
    include: {
      activity: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      doneBy: { select: personSelect },
      rejectedBy: { select: personSelect },
    },
  });
  type Group = { client: { id: string; name: string }; activity: { id: string; name: string }; thisWeek: typeof items; leftOver: typeof items };
  const groups = new Map<string, Group>();
  for (const i of items) {
    const key = `${i.clientId}:${i.activityId}`;
    const g = groups.get(key) ?? { client: i.client, activity: i.activity, thisWeek: [], leftOver: [] };
    (i.week === week ? g.thisWeek : g.leftOver).push(i);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.thisWeek.sort(boxOrder);
    g.leftOver.sort(boxOrder);
  }
  const list = [...groups.values()].sort((a, b) => a.client.name.localeCompare(b.client.name) || a.activity.name.localeCompare(b.activity.name));
  const thisWeek = items.filter((i) => i.week === week);
  return {
    month,
    week,
    groups: list,
    progress: { done: thisWeek.filter((i) => i.doneAt).length, planned: thisWeek.length },
    leftOver: items.filter((i) => i.week < week).length,
  };
}

// Every visible client's progress this week, for the execution lead and owners.
// A client is flagged when a finished week of this month fell short of plan.
export async function teamOverview(user: SessionUser, now = new Date()) {
  if (!can(user.role, "offpage.review")) throw forbidden();
  const month = currentMonth(now);
  const week = currentWeek(now);
  const clients = await db.client.findMany({
    where: { AND: [visibleClients(user), { status: { in: ["ACTIVE", "ONBOARDING"] } }, { offpageActivities: { some: activeIn(month) } }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, executionOwner: { select: personSelect } },
  });
  await ensureMonthFor(clients.map((c) => c.id), month, now);
  const counts = await db.offpageItem.groupBy({
    by: ["clientId", "week"],
    where: { month, clientId: { in: clients.map((c) => c.id) } },
    _count: { _all: true, doneAt: true },
  });
  return {
    month,
    week,
    clients: clients.map((c) => {
      const weeks = WEEKS.map((w) => {
        const row = counts.find((r) => r.clientId === c.id && r.week === w);
        return { week: w, planned: row?._count._all ?? 0, done: row?._count.doneAt ?? 0 };
      });
      const behind = weeks.filter((w) => w.week < week && w.done < w.planned);
      return {
        client: c,
        weeks,
        thisWeek: weeks[week - 1]!,
        month: { done: weeks.reduce((s, w) => s + w.done, 0), planned: weeks.reduce((s, w) => s + w.planned, 0) },
        behind: behind.map((w) => ({ week: w.week, missing: w.planned - w.done })),
      };
    }),
  };
}

// Daily housekeeping: make sure every running client has this month's list.
export async function ensureAllMonths(now = new Date()) {
  const clients = await db.client.findMany({ where: { status: { in: ["ACTIVE", "ONBOARDING"] } }, select: { id: true } });
  await ensureMonthFor(clients.map((c) => c.id), currentMonth(now), now);
}
