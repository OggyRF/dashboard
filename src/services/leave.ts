import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import {
  addDays,
  countWorkingDays,
  dateFromKey,
  formatDayKey,
  istDateKey,
  isValidKey,
  isValidMonth,
  keyFromDbDate,
  monthKeys,
} from "@/lib/dates";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { activeOwnerIds, notify } from "@/services/notifications";

export const LEAVE_TYPE_LABELS = { CASUAL: "Casual", SICK: "Sick", UNPAID: "Unpaid", OTHER: "Other" } as const;

// Leave can be entered for up to 30 days back (for sick days) and a year ahead.
const MAX_BACKDATE_DAYS = 30;
const MAX_AHEAD_DAYS = 366;

export const leaveSchema = z
  .object({
    fromDate: z.string().refine(isValidKey, "Pick a start date."),
    toDate: z.string().refine(isValidKey, "Pick an end date."),
    halfDay: z.boolean(),
    type: z.enum(["CASUAL", "SICK", "UNPAID", "OTHER"]),
    reason: z.string().trim().min(3, "Add a short reason.").max(500),
  })
  .refine((v) => v.fromDate <= v.toDate, { message: "The end date is before the start date." })
  .refine((v) => !v.halfDay || v.fromDate === v.toDate, { message: "A half day must be a single date." });

async function holidaySet(fromKey: string, toKey: string) {
  const holidays = await db.holiday.findMany({ where: { date: { gte: dateFromKey(fromKey), lte: dateFromKey(toKey) } } });
  return new Set(holidays.map((h) => keyFromDbDate(h.date)));
}

function describeRange(from: string, to: string, halfDay: boolean) {
  if (from === to) return `${formatDayKey(from)}${halfDay ? " (half day)" : ""}`;
  return `${formatDayKey(from)} to ${formatDayKey(to)}`;
}

export async function applyForLeave(user: SessionUser, input: unknown, ip: string | null, now = new Date()) {
  if (!can(user.role, "leave.apply")) throw forbidden();
  const data = leaveSchema.parse(input);
  const today = istDateKey(now);
  if (data.fromDate < addDays(today, -MAX_BACKDATE_DAYS)) throw invalid(`Leave can be entered at most ${MAX_BACKDATE_DAYS} days back.`);
  if (data.toDate > addDays(today, MAX_AHEAD_DAYS)) throw invalid("Leave can be requested at most a year ahead.");

  const workingDays = countWorkingDays(data.fromDate, data.toDate, await holidaySet(data.fromDate, data.toDate));
  if (workingDays === 0) throw invalid("Those dates are all weekly offs or holidays.");
  const days = data.halfDay ? 0.5 : workingDays;

  const overlap = await db.leaveRequest.findFirst({
    where: {
      userId: user.id,
      status: { in: ["PENDING", "APPROVED"] },
      fromDate: { lte: dateFromKey(data.toDate) },
      toDate: { gte: dateFromKey(data.fromDate) },
    },
  });
  if (overlap) throw conflict("You already have leave requested for some of those dates.");

  return db.$transaction(async (tx) => {
    const request = await tx.leaveRequest.create({
      data: {
        userId: user.id,
        fromDate: dateFromKey(data.fromDate),
        toDate: dateFromKey(data.toDate),
        halfDay: data.halfDay,
        days,
        type: data.type,
        reason: data.reason,
      },
    });
    await notify(tx, await activeOwnerIds(tx), `${user.name} requested ${LEAVE_TYPE_LABELS[data.type].toLowerCase()} leave: ${describeRange(data.fromDate, data.toDate, data.halfDay)}`, "/leave");
    await writeAudit(tx, { actorId: user.id, action: "leave.requested", entityType: "LeaveRequest", entityId: request.id, after: { ...data, days }, ip });
    return request;
  });
}

export async function cancelLeave(user: SessionUser, requestId: string, ip: string | null) {
  const request = await db.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request || request.userId !== user.id) throw notFound("Leave request");
  if (request.status !== "PENDING") throw invalid("Only a pending request can be cancelled. Message the owners to change an approved one.");
  await db.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
    await writeAudit(tx, { actorId: user.id, action: "leave.cancelled", entityType: "LeaveRequest", entityId: requestId, ip });
  });
}

export const decisionSchema = z
  .object({ approve: z.boolean(), note: z.string().trim().max(500).optional() })
  .refine((v) => v.approve || (v.note && v.note.length >= 3), { message: "Add a note saying why it is rejected." });

export async function decideLeave(actor: SessionUser, requestId: string, input: unknown, ip: string | null) {
  if (!can(actor.role, "leave.approve")) throw forbidden();
  const data = decisionSchema.parse(input);
  const request = await db.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request) throw notFound("Leave request");
  if (request.status !== "PENDING") throw invalid("This request has already been decided or cancelled.");
  if (request.userId === actor.id) throw invalid("Ask the other owner to approve your own leave.");

  const status = data.approve ? "APPROVED" : "REJECTED";
  await db.$transaction(async (tx) => {
    // Guarded update so two owners deciding at once cannot both win.
    const { count } = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status, decidedById: actor.id, decidedAt: new Date(), decisionNote: data.note || null },
    });
    if (count === 0) throw invalid("This request has already been decided.");
    const range = describeRange(keyFromDbDate(request.fromDate), keyFromDbDate(request.toDate), request.halfDay);
    await notify(tx, [request.userId], `Your leave for ${range} was ${data.approve ? "approved" : "rejected"} by ${actor.name}`, "/leave");
    await writeAudit(tx, {
      actorId: actor.id,
      action: data.approve ? "leave.approved" : "leave.rejected",
      entityType: "LeaveRequest",
      entityId: requestId,
      after: { status, note: data.note ?? null },
      ip,
    });
  });
}

const leaveInclude = { user: { select: { id: true, name: true } }, decidedBy: { select: { name: true } } } as const;

export function myLeave(user: SessionUser) {
  return db.leaveRequest.findMany({ where: { userId: user.id }, orderBy: { fromDate: "desc" }, take: 50, include: leaveInclude });
}

export async function pendingLeave(actor: SessionUser) {
  if (!can(actor.role, "leave.approve")) throw forbidden();
  return db.leaveRequest.findMany({ where: { status: "PENDING" }, orderBy: { fromDate: "asc" }, include: leaveInclude });
}

export async function pendingLeaveCount(actor: SessionUser) {
  if (!can(actor.role, "leave.approve")) return 0;
  return db.leaveRequest.count({ where: { status: "PENDING", userId: { not: actor.id } } });
}

export async function recentDecisions(actor: SessionUser) {
  if (!can(actor.role, "leave.approve")) throw forbidden();
  return db.leaveRequest.findMany({
    where: { status: { in: ["APPROVED", "REJECTED"] } },
    orderBy: { decidedAt: "desc" },
    take: 20,
    include: leaveInclude,
  });
}

export type CalendarEntry = { key: string; name: string; status: "PENDING" | "APPROVED"; halfDay: boolean; mine: boolean };

// Month calendar: owners see everyone's leave, members only their own.
export async function leaveCalendar(user: SessionUser, month: string) {
  if (!isValidMonth(month)) throw invalid("Pick a valid month.");
  const keys = monthKeys(month);
  const first = dateFromKey(keys[0]);
  const last = dateFromKey(keys.at(-1)!);
  const everyone = can(user.role, "leave.approve");
  const [requests, holidays] = await Promise.all([
    db.leaveRequest.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        fromDate: { lte: last },
        toDate: { gte: first },
        ...(everyone ? {} : { userId: user.id }),
      },
      include: { user: { select: { name: true } } },
    }),
    db.holiday.findMany({ where: { date: { gte: first, lte: last } } }),
  ]);
  const entries: CalendarEntry[] = [];
  for (const r of requests) {
    for (let key = keyFromDbDate(r.fromDate); key <= keyFromDbDate(r.toDate); key = addDays(key, 1)) {
      if (key.startsWith(month)) {
        entries.push({ key, name: r.user.name, status: r.status as "PENDING" | "APPROVED", halfDay: r.halfDay, mine: r.userId === user.id });
      }
    }
  }
  return { entries, holidays: holidays.map((h) => ({ key: keyFromDbDate(h.date), name: h.name })) };
}

export async function listHolidays(fromKey: string) {
  const rows = await db.holiday.findMany({ where: { date: { gte: dateFromKey(fromKey) } }, orderBy: { date: "asc" } });
  return rows.map((h) => ({ id: h.id, key: keyFromDbDate(h.date), name: h.name }));
}

const holidaySchema = z.object({ date: z.string().refine(isValidKey, "Pick a date."), name: z.string().trim().min(2, "Name the holiday.").max(80) });

export async function addHoliday(actor: SessionUser, input: unknown, ip: string | null) {
  if (!can(actor.role, "settings.manage")) throw forbidden();
  const data = holidaySchema.parse(input);
  if (await db.holiday.findUnique({ where: { date: dateFromKey(data.date) } })) throw conflict("There is already a holiday on that date.");
  await db.$transaction(async (tx) => {
    const h = await tx.holiday.create({ data: { date: dateFromKey(data.date), name: data.name } });
    await writeAudit(tx, { actorId: actor.id, action: "holiday.added", entityType: "Holiday", entityId: h.id, after: data, ip });
  });
}

export async function updateHoliday(actor: SessionUser, id: string, input: unknown, ip: string | null) {
  if (!can(actor.role, "settings.manage")) throw forbidden();
  const data = holidaySchema.parse(input);
  const existing = await db.holiday.findUnique({ where: { id } });
  if (!existing) throw notFound("Holiday");
  const clash = await db.holiday.findUnique({ where: { date: dateFromKey(data.date) } });
  if (clash && clash.id !== id) throw conflict("There is already a holiday on that date.");
  await db.$transaction(async (tx) => {
    await tx.holiday.update({ where: { id }, data: { date: dateFromKey(data.date), name: data.name } });
    await writeAudit(tx, { actorId: actor.id, action: "holiday.updated", entityType: "Holiday", entityId: id, before: { date: keyFromDbDate(existing.date), name: existing.name }, after: data, ip });
  });
}

export async function removeHoliday(actor: SessionUser, id: string, ip: string | null) {
  if (!can(actor.role, "settings.manage")) throw forbidden();
  await db.$transaction(async (tx) => {
    const h = await tx.holiday.delete({ where: { id } });
    await writeAudit(tx, { actorId: actor.id, action: "holiday.removed", entityType: "Holiday", entityId: id, before: { date: keyFromDbDate(h.date), name: h.name }, ip });
  });
}
