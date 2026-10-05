import { APP_TIME_ZONE } from "@/lib/time";

// Calendar dates are handled as "YYYY-MM-DD" keys in India time. PostgreSQL
// DATE columns are read and written as UTC midnight of that key.

const keyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Days nobody works. Sunday only by default; change here if Saturdays become off days.
export const WEEKLY_OFF_DAYS = [0];

export function istDateKey(date: Date): string {
  return keyFormat.format(date);
}

export function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export function keyFromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// A wall-clock time on an India calendar day, e.g. ("2026-10-05", "09:30").
export function istDateTime(key: string, hhmm: string): Date {
  return new Date(`${key}T${hhmm}:00+05:30`);
}

export function istTimeOfDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function addDays(key: string, days: number): string {
  const d = dateFromKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return keyFromDbDate(d);
}

export function weekday(key: string): number {
  return dateFromKey(key).getUTCDay();
}

export function isValidKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && keyFromDbDate(dateFromKey(key)) === key;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function monthKeys(month: string): string[] {
  const first = `${month}-01`;
  const keys: string[] = [];
  for (let key = first; key.startsWith(month); key = addDays(key, 1)) keys.push(key);
  return keys;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function formatDayKey(key: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(dateFromKey(key));
}

export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(dateFromKey(`${month}-01`));
}

// Working days between two keys inclusive, skipping weekly offs and holidays.
export function countWorkingDays(fromKey: string, toKey: string, holidays: Set<string>): number {
  let count = 0;
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    if (!WEEKLY_OFF_DAYS.includes(weekday(key)) && !holidays.has(key)) count++;
  }
  return count;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
