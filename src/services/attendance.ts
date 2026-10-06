import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import {
  ALLOWED,
  BREAK_ALLOWANCE_MINUTES,
  allowedActions,
  EVENT_LABELS,
  effectiveEvents,
  summarizeDay,
  type DaySummary,
  type EventType,
} from "@/lib/attendance/compute";
import { DESKTOP_ONLY_MESSAGE, IDLE_STOP_MINUTES, IDLE_STOP_NOTE } from "@/lib/attendance/presence";
import { addDays, dateFromKey, istDateKey, istDateTime, isValidKey, isValidMonth, keyFromDbDate, monthKeys } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { z } from "zod";

type Tx = Prisma.TransactionClient;

async function loadSummary(tx: Tx, dayId: string, asOf: Date) {
  const [events, corrections] = await Promise.all([
    tx.attendanceEvent.findMany({ where: { dayId }, orderBy: { at: "asc" } }),
    tx.attendanceCorrection.findMany({ where: { dayId } }),
  ]);
  const effective = effectiveEvents(events, corrections);
  return { events, corrections, effective, summary: summarizeDay(effective, asOf) };
}

// Stored totals only count closed spans; open spans are added live on screen.
async function saveTotals(tx: Tx, dayId: string, summary: DaySummary, extra: Prisma.AttendanceDayUpdateInput = {}) {
  await tx.attendanceDay.update({
    where: { id: dayId },
    data: {
      firstLoginAt: summary.firstLoginAt,
      lastLogoutAt: summary.state === "LOGGED_OUT" ? summary.lastLogoutAt : null,
      workedMinutes: summary.workedMinutes,
      breakMinutes: summary.breakMinutes,
      breakCount: summary.breakCount,
      ...extra,
    },
  });
}

async function lockDay(tx: Tx, userId: string, key: string) {
  const day = await tx.attendanceDay.upsert({
    where: { userId_date: { userId, date: dateFromKey(key) } },
    create: { userId, date: dateFromKey(key) },
    update: {},
  });
  // Serialises button presses for one person's day (double clicks, two tabs).
  await tx.$queryRaw`SELECT id FROM attendance_days WHERE id = ${day.id} FOR UPDATE`;
  return day;
}

export type TodayView = {
  dayKey: string;
  summary: DaySummary;
  allowed: EventType[];
  // Server time the summary was computed at; the browser counts on from here.
  asOf: string;
  // When the timer last stopped because the laptop went quiet, if that is
  // why the person is logged out now.
  stoppedAt: Date | null;
  // What they wrote about today's work when logging out.
  workNote: string | null;
};

export async function getToday(user: SessionUser, now = new Date()): Promise<TodayView> {
  const key = istDateKey(now);
  await sweepIdle(now, user.id);
  const day = await db.attendanceDay.findUnique({ where: { userId_date: { userId: user.id, date: dateFromKey(key) } } });
  const loaded = day ? await loadSummary(db, day.id, now) : null;
  const summary = loaded?.summary ?? summarizeDay([], now);
  const last = loaded?.effective.at(-1);
  const lastRow = last && loaded?.events.find((e) => e.id === last.id);
  const stoppedAt = summary.state === "LOGGED_OUT" && lastRow?.note === IDLE_STOP_NOTE ? last!.at : null;
  return { dayKey: key, summary, allowed: allowedActions(summary), asOf: now.toISOString(), stoppedAt, workNote: day?.workNote ?? null };
}

// Where a button press or heartbeat came from. Phones may look but not clock in.
export type Device = { mobile: boolean };
const LAPTOP: Device = { mobile: false };

// Stops a working session whose laptop has gone quiet, as of the last signal.
// Breaks are left alone: nobody needs the laptop on during a break.
async function stopIfIdle(tx: Tx, day: { id: string; userId: string; lastSeenAt: Date | null }, now: Date) {
  if (!day.lastSeenAt || now.getTime() - day.lastSeenAt.getTime() <= IDLE_STOP_MINUTES * 60_000) return false;
  const { summary, effective } = await loadSummary(tx, day.id, day.lastSeenAt);
  if (summary.state === "ON_BREAK") return false;
  if (summary.state !== "WORKING") {
    await tx.attendanceDay.update({ where: { id: day.id }, data: { lastSeenAt: null } });
    return false;
  }
  const lastEvent = effective.at(-1)?.at ?? day.lastSeenAt;
  const at = lastEvent > day.lastSeenAt ? lastEvent : day.lastSeenAt;
  await tx.attendanceEvent.create({ data: { dayId: day.id, userId: day.userId, type: "LOGOUT", at, source: "SYSTEM", note: IDLE_STOP_NOTE } });
  const after = await loadSummary(tx, day.id, now);
  await saveTotals(tx, day.id, after.summary, { lastSeenAt: null });
  return true;
}

// Applies stopIfIdle to every quiet session (or one person's), so totals and
// the team board never count time after a laptop went dark.
export async function sweepIdle(now = new Date(), userId?: string) {
  const cutoff = new Date(now.getTime() - IDLE_STOP_MINUTES * 60_000);
  const quiet = await db.attendanceDay.findMany({
    where: { lastSeenAt: { not: null, lt: cutoff }, ...(userId ? { userId } : {}) },
    select: { id: true },
  });
  let stopped = 0;
  for (const { id } of quiet) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM attendance_days WHERE id = ${id} FOR UPDATE`;
      const day = await tx.attendanceDay.findUniqueOrThrow({ where: { id }, select: { id: true, userId: true, lastSeenAt: true } });
      if (await stopIfIdle(tx, day, now)) stopped++;
    });
  }
  return stopped;
}

// The open dashboard on a laptop says "still here" once a minute. Returns
// today's view, so the page can tell when the timer was stopped meanwhile.
export async function heartbeat(user: SessionUser, device: Device, now = new Date()) {
  if (!can(user.role, "attendance.own")) return null;
  if (!device.mobile) {
    const key = istDateKey(now);
    await db.$transaction(async (tx) => {
      const day = await tx.attendanceDay.findUnique({ where: { userId_date: { userId: user.id, date: dateFromKey(key) } } });
      if (!day) return;
      await tx.$queryRaw`SELECT id FROM attendance_days WHERE id = ${day.id} FOR UPDATE`;
      const fresh = await tx.attendanceDay.findUniqueOrThrow({ where: { id: day.id } });
      if (await stopIfIdle(tx, fresh, now)) return;
      const { summary } = await loadSummary(tx, day.id, now);
      if (summary.state === "WORKING" || summary.state === "ON_BREAK") {
        await tx.attendanceDay.update({ where: { id: day.id }, data: { lastSeenAt: now } });
      }
    });
  }
  return getToday(user, now);
}

// Logging out for the day needs a few words on what was done (Aarif,
// 6 Oct 2026); owners read them per person and per day.
export const WORK_NOTE_MIN = 10;
export const workNoteSchema = z
  .string()
  .trim()
  .min(WORK_NOTE_MIN, "Write a few words about today's work before logging out.")
  .max(3000, "Keep the note under 3,000 characters.");

// A button press. The time is always the server's clock.
export async function recordEvent(user: SessionUser, type: EventType, ip: string | null, now = new Date(), device: Device = LAPTOP, workNote?: unknown) {
  if (!can(user.role, "attendance.own")) throw forbidden();
  if (device.mobile) throw invalid(DESKTOP_ONLY_MESSAGE);
  const key = istDateKey(now);
  const note = type === "LOGOUT" ? parseNote(workNote) : null;

  await db.$transaction(async (tx) => {
    const day = await lockDay(tx, user.id, key);
    await stopIfIdle(tx, await tx.attendanceDay.findUniqueOrThrow({ where: { id: day.id } }), now);
    const { summary } = await loadSummary(tx, day.id, now);
    if (!ALLOWED[summary.state].includes(type)) {
      throw invalid(`You cannot do "${EVENT_LABELS[type]}" now. Refresh the page to see your current status.`);
    }
    if (!allowedActions(summary).includes(type)) {
      throw invalid(`Today's ${BREAK_ALLOWANCE_MINUTES}-minute break allowance is used up.`);
    }
    if (type === "LOGOUT" && summary.state === "ON_BREAK") {
      // Logging out during a break ends the break at the same moment.
      await tx.attendanceEvent.create({ data: { dayId: day.id, userId: user.id, type: "BREAK_END", at: now, ip } });
    }
    await tx.attendanceEvent.create({ data: { dayId: day.id, userId: user.id, type, at: now, ip } });
    const after = await loadSummary(tx, day.id, now);
    await saveTotals(tx, day.id, after.summary, { lastSeenAt: type === "LOGOUT" ? null : now, ...(note ? { workNote: note, workNoteAt: now } : {}) });
  });

  return getToday(user, now);
}

function parseNote(input: unknown) {
  const parsed = workNoteSchema.safeParse(typeof input === "string" ? input : "");
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Write a few words about today's work.");
  return parsed.data;
}

// Adds or changes the work note of one of your last few days, e.g. when the
// timer stopped on its own and there was no Log out.
export const WORK_NOTE_EDIT_DAYS = 7;
export async function saveWorkNote(user: SessionUser, key: string, input: unknown, ip: string | null, now = new Date()) {
  if (!can(user.role, "attendance.own")) throw forbidden();
  const today = istDateKey(now);
  if (!isValidKey(key) || key > today || key < addDays(today, -WORK_NOTE_EDIT_DAYS)) throw invalid(`Notes can be added for the last ${WORK_NOTE_EDIT_DAYS} days only.`);
  const note = parseNote(input);
  const day = await db.attendanceDay.findUnique({ where: { userId_date: { userId: user.id, date: dateFromKey(key) } } });
  if (!day?.firstLoginAt) throw invalid("There is no work recorded on that day.");
  await db.$transaction(async (tx) => {
    await tx.attendanceDay.update({ where: { id: day.id }, data: { workNote: note, workNoteAt: now } });
    await writeAudit(tx, { actorId: user.id, action: "attendance.work_note", entityType: "AttendanceDay", entityId: day.id, before: { workNote: day.workNote }, after: { workNote: note }, ip });
  });
  return getToday(user, now);
}

// Everyone's work notes for one day, for owners.
export async function workNotes(actor: SessionUser, key: string) {
  if (!can(actor.role, "attendance.viewAll")) throw forbidden();
  if (!isValidKey(key)) throw invalid("Pick a valid day.");
  const date = dateFromKey(key);
  const [users, days] = await Promise.all([
    db.user.findMany({ where: { role: { not: "OWNER" }, OR: [{ status: "ACTIVE" }, { attendanceDays: { some: { date } } }] }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, avatarUpdatedAt: true } }),
    db.attendanceDay.findMany({ where: { date }, select: { id: true, userId: true, firstLoginAt: true, workedMinutes: true, workNote: true, workNoteAt: true } }),
  ]);
  const byUser = new Map(days.map((d) => [d.userId, d]));
  return users.map((u) => {
    const d = byUser.get(u.id);
    return { person: u, dayId: d?.id ?? null, present: !!d?.firstLoginAt, workedMinutes: d?.workedMinutes ?? 0, note: d?.workNote ?? null, noteAt: d?.workNoteAt ?? null };
  });
}

// End-of-day job: closes days where nobody pressed Log out, at `now`, and
// flags them for owners to check.
export async function closeOpenDays(now = new Date()) {
  // Sessions whose laptop went quiet end at the last signal, not at midnight.
  await sweepIdle(now);
  const key = istDateKey(now);
  const open = await db.attendanceDay.findMany({
    where: { date: { lte: dateFromKey(key) }, firstLoginAt: { not: null }, lastLogoutAt: null },
    select: { id: true, userId: true },
  });
  let closed = 0;
  for (const { id, userId } of open) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM attendance_days WHERE id = ${id} FOR UPDATE`;
      const { summary } = await loadSummary(tx, id, now);
      if (summary.state !== "WORKING" && summary.state !== "ON_BREAK") return;
      if (summary.state === "ON_BREAK") {
        await tx.attendanceEvent.create({ data: { dayId: id, userId, type: "BREAK_END", at: now, source: "SYSTEM" } });
      }
      await tx.attendanceEvent.create({ data: { dayId: id, userId, type: "LOGOUT", at: now, source: "SYSTEM" } });
      const after = await loadSummary(tx, id, now);
      await saveTotals(tx, id, after.summary, { autoClosed: true, lastSeenAt: null });
      closed++;
    });
  }
  return closed;
}

export type TeamMemberToday = {
  userId: string;
  name: string;
  role: string;
  summary: DaySummary;
  autoClosed: boolean;
  onLeave: boolean;
};

export async function teamToday(actor: SessionUser, now = new Date()): Promise<TeamMemberToday[]> {
  if (!can(actor.role, "attendance.viewAll")) throw forbidden();
  await sweepIdle(now);
  const key = istDateKey(now);
  const date = dateFromKey(key);
  const [users, days, leaves] = await Promise.all([
    db.user.findMany({ where: { status: "ACTIVE", role: { not: "OWNER" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    db.attendanceDay.findMany({
      where: { date },
      include: { events: { orderBy: { at: "asc" } }, corrections: true },
    }),
    db.leaveRequest.findMany({
      where: { status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date } },
      select: { userId: true },
    }),
  ]);
  const byUser = new Map(days.map((d) => [d.userId, d]));
  const onLeave = new Set(leaves.map((l) => l.userId));
  return users.map((u) => {
    const day = byUser.get(u.id);
    const summary = summarizeDay(day ? effectiveEvents(day.events, day.corrections) : [], now);
    return { userId: u.id, name: u.name, role: u.role, summary, autoClosed: day?.autoClosed ?? false, onLeave: onLeave.has(u.id) };
  });
}

export type SheetRow = {
  key: string;
  dayId: string | null;
  summary: DaySummary | null;
  autoClosed: boolean;
  corrected: boolean;
  workNote: string | null;
};

// Month of attendance for one person. Members can only see their own.
export async function monthSheet(actor: SessionUser, userId: string, month: string, now = new Date()) {
  if (userId !== actor.id && !can(actor.role, "attendance.viewAll")) throw forbidden();
  if (!isValidMonth(month)) throw invalid("Pick a valid month.");
  await sweepIdle(now, userId);
  const keys = monthKeys(month);
  const person = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true } });
  if (!person) throw notFound("Team member");

  const days = await db.attendanceDay.findMany({
    where: { userId, date: { gte: dateFromKey(keys[0]), lte: dateFromKey(keys.at(-1)!) } },
    include: { events: true, corrections: true },
  });
  const byKey = new Map(days.map((d) => [keyFromDbDate(d.date), d]));
  const rows: SheetRow[] = keys.map((key) => {
    const d = byKey.get(key);
    if (!d) return { key, dayId: null, summary: null, autoClosed: false, corrected: false, workNote: null };
    return {
      key,
      dayId: d.id,
      summary: summarizeDay(effectiveEvents(d.events, d.corrections), now),
      autoClosed: d.autoClosed,
      corrected: d.corrected,
      workNote: d.workNote,
    };
  });
  const present = rows.filter((r) => r.summary?.firstLoginAt);
  const totals = {
    daysPresent: present.length,
    workedMinutes: present.reduce((s, r) => s + r.summary!.workedMinutes, 0),
    breakMinutes: present.reduce((s, r) => s + r.summary!.breakMinutes, 0),
  };
  return { person, month, rows, totals };
}

export async function dayDetail(actor: SessionUser, dayId: string, now = new Date()) {
  const day = await db.attendanceDay.findUnique({ where: { id: dayId }, include: { user: { select: { id: true, name: true } } } });
  if (!day) throw notFound("Attendance day");
  if (day.userId !== actor.id && !can(actor.role, "attendance.viewAll")) throw forbidden();
  const { events, corrections, effective, summary } = await loadSummary(db, dayId, now);
  const people = await db.user.findMany({
    where: { id: { in: corrections.map((c) => c.correctedById) } },
    select: { id: true, name: true },
  });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return {
    day: { id: day.id, key: keyFromDbDate(day.date), user: day.user, autoClosed: day.autoClosed, workNote: day.workNote, workNoteAt: day.workNoteAt },
    events,
    effective,
    summary,
    corrections: corrections
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((c) => ({ ...c, correctedByName: names.get(c.correctedById) ?? "Unknown" })),
  };
}

export const correctionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CHANGE_TIME"), eventId: z.string().min(1), time: z.string().regex(/^\d{2}:\d{2}$/), reason: z.string().trim().min(3, "Give a reason for the correction.").max(300) }),
  z.object({ kind: z.literal("ADD_EVENT"), type: z.enum(["LOGIN", "BREAK_START", "BREAK_END", "LOGOUT"]), time: z.string().regex(/^\d{2}:\d{2}$/), reason: z.string().trim().min(3, "Give a reason for the correction.").max(300) }),
  z.object({ kind: z.literal("REMOVE_EVENT"), eventId: z.string().min(1), reason: z.string().trim().min(3, "Give a reason for the correction.").max(300) }),
]);

// Owner correction. Recorded events stay as they were; the correction is
// stored beside them, shown on the record, and audited.
export async function correctDay(actor: SessionUser, dayId: string, input: unknown, ip: string | null, now = new Date()) {
  if (!can(actor.role, "attendance.correct")) throw forbidden();
  const data = correctionSchema.parse(input);

  await db.$transaction(async (tx) => {
    const day = await tx.attendanceDay.findUnique({ where: { id: dayId } });
    if (!day) throw notFound("Attendance day");
    await tx.$queryRaw`SELECT id FROM attendance_days WHERE id = ${dayId} FOR UPDATE`;
    const before = await loadSummary(tx, dayId, now);
    const key = keyFromDbDate(day.date);

    let correction: Prisma.AttendanceCorrectionUncheckedCreateInput;
    if (data.kind === "ADD_EVENT") {
      const at = istDateTime(key, data.time);
      if (at > now) throw invalid("A correction cannot be in the future.");
      const event = await tx.attendanceEvent.create({ data: { dayId, userId: day.userId, type: data.type, at, source: "OWNER", ip } });
      correction = { dayId, eventId: event.id, kind: "ADD_EVENT", newAt: at, reason: data.reason, correctedById: actor.id };
    } else {
      const current = before.effective.find((e) => e.id === data.eventId);
      if (!current) throw notFound("Attendance entry");
      const newAt = data.kind === "CHANGE_TIME" ? istDateTime(key, data.time) : null;
      if (newAt && newAt > now) throw invalid("A correction cannot be in the future.");
      correction = { dayId, eventId: data.eventId, kind: data.kind, oldAt: current.at, newAt, reason: data.reason, correctedById: actor.id };
    }
    await tx.attendanceCorrection.create({ data: correction });

    const after = await loadSummary(tx, dayId, now);
    if (after.summary.issues.length) {
      throw invalid("That change would put the day's entries out of order (for example a break before logging in). Check the times and try again.");
    }
    await saveTotals(tx, dayId, after.summary, { corrected: true });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "attendance.corrected",
      entityType: "AttendanceDay",
      entityId: dayId,
      before: { workedMinutes: before.summary.workedMinutes, breakMinutes: before.summary.breakMinutes },
      after: { kind: data.kind, reason: data.reason, workedMinutes: after.summary.workedMinutes, breakMinutes: after.summary.breakMinutes },
      ip,
    });
  });
}

// An owner opens a day that has no record yet (someone forgot to log in at all).
export async function ensureDay(actor: SessionUser, userId: string, key: string) {
  if (!can(actor.role, "attendance.correct")) throw forbidden();
  const day = await db.attendanceDay.upsert({
    where: { userId_date: { userId, date: dateFromKey(key) } },
    create: { userId, date: dateFromKey(key) },
    update: {},
  });
  return day.id;
}
