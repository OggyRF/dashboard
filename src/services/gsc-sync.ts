import { randomUUID } from "node:crypto";
import type { GscDimension } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, dateFromKey, istDateKey, keyFromDbDate, monthKeys, shiftMonth } from "@/lib/dates";
import { GoogleError, googleConfigured, searchAnalyticsAll, type GscQuery } from "@/lib/google/api";
import { googleAccessToken, historyStartMonth } from "@/services/google";

// Search Console data is pulled in small steps, so each fits inside one short
// serverless call (Vercel has no always-on worker):
//   1. once a day per client: daily totals since the last pull (the last 5 days
//      again, as Google settles them) and this month's breakdowns;
//   2. then history, one month of breakdowns per step, back 16 months.
// Steps run from the nightly cron, from "Sync now", and in the background
// while people use the dashboard.

const DIMENSIONS: { dimension: GscDimension; keys: GscQuery["dimensions"]; recent: number; older: number }[] = [
  { dimension: "QUERY", keys: ["query"], recent: 500, older: 100 },
  { dimension: "PAGE", keys: ["page"], recent: 500, older: 100 },
  { dimension: "QUERY_PAGE", keys: ["query", "page"], recent: 500, older: 100 },
  { dimension: "DEVICE", keys: ["device"], recent: 10, older: 10 },
  { dimension: "COUNTRY", keys: ["country"], recent: 50, older: 25 },
];

// Recent months keep more rows; older ones only the top, to fit the database.
const RECENT_MONTHS = 3;
// Days pulled again on each daily pass, since Google revises recent days.
const SETTLE_DAYS = 5;

type Source = { id: string; externalId: string; recentSyncedOn: Date | null; backfillMonth: string | null };

async function pullTotals(token: string, source: Source, today: string) {
  const end = addDays(today, -1);
  const start = source.recentSyncedOn ? addDays(keyFromDbDate(source.recentSyncedOn), -SETTLE_DAYS) : `${historyStartMonth(today)}-01`;
  if (start > end) return;
  const rows = await searchAnalyticsAll(token, source.externalId, { startDate: start, endDate: end, dimensions: ["date"] }, 1000);
  await db.$transaction([
    db.gscDailyTotal.deleteMany({ where: { dataSourceId: source.id, date: { gte: dateFromKey(start), lte: dateFromKey(end) } } }),
    db.gscDailyTotal.createMany({
      data: rows.map((r) => ({ dataSourceId: source.id, date: dateFromKey(r.keys![0]!), clicks: r.clicks, impressions: r.impressions, position: r.position })),
    }),
  ]);
}

async function pullMonth(token: string, source: Source, month: string, today: string) {
  const days = monthKeys(month);
  const start = days[0]!;
  const end = [days.at(-1)!, addDays(today, -1)].sort()[0]!;
  const recent = month >= shiftMonth(today.slice(0, 7), -(RECENT_MONTHS - 1));
  const data: { dataSourceId: string; month: string; dimension: GscDimension; key1: string; key2: string; clicks: number; impressions: number; position: number }[] = [];
  if (start <= end) {
    for (const d of DIMENSIONS) {
      const rows = await searchAnalyticsAll(token, source.externalId, { startDate: start, endDate: end, dimensions: d.keys }, recent ? d.recent : d.older);
      for (const r of rows) {
        data.push({ dataSourceId: source.id, month, dimension: d.dimension, key1: r.keys?.[0] ?? "", key2: r.keys?.[1] ?? "", clicks: r.clicks, impressions: r.impressions, position: r.position });
      }
    }
  }
  await db.$transaction([db.gscRow.deleteMany({ where: { dataSourceId: source.id, month } }), db.gscRow.createMany({ data })]);
}

// One step of work for one property. Returns false when it has nothing to do.
export async function syncStep(token: string, source: Source, now = new Date()): Promise<boolean> {
  const today = istDateKey(now);
  const thisMonth = today.slice(0, 7);
  if (!source.recentSyncedOn || keyFromDbDate(source.recentSyncedOn) < today) {
    await pullTotals(token, source, today);
    await pullMonth(token, source, thisMonth, today);
    // Early in a month, last month is still settling too.
    const lastMonth = shiftMonth(thisMonth, -1);
    if (Number(today.slice(8)) <= SETTLE_DAYS && source.recentSyncedOn && source.backfillMonth !== lastMonth) await pullMonth(token, source, lastMonth, today);
    await db.clientDataSource.update({ where: { id: source.id }, data: { recentSyncedOn: dateFromKey(today), lastSyncAt: now, lastError: null } });
    return true;
  }
  if (source.backfillMonth) {
    await pullMonth(token, source, source.backfillMonth, today);
    const next = shiftMonth(source.backfillMonth, -1);
    await db.clientDataSource.update({
      where: { id: source.id },
      data: { backfillMonth: next < historyStartMonth(today) ? null : next, lastSyncAt: now, lastError: null },
    });
    return true;
  }
  return false;
}

function needsWork(today: string) {
  return { OR: [{ recentSyncedOn: null }, { recentSyncedOn: { lt: dateFromKey(today) } }, { backfillMonth: { not: null } }] };
}

const LEASE = "gsc-sync";
// After a background run, wait this long before the next one starts by itself.
const COOLDOWN_MS = 3 * 60_000;

async function takeLease(holder: string, ms: number, force: boolean, now: Date) {
  const expiresAt = new Date(now.getTime() + ms);
  // A finished run leaves a "cooldown" lease; "Sync now" may jump it.
  const free = force ? { OR: [{ expiresAt: { lt: now } }, { holder: "cooldown" }] } : { expiresAt: { lt: now } };
  const taken = await db.syncLease.updateMany({ where: { name: LEASE, ...free }, data: { holder, expiresAt } });
  if (taken.count) return true;
  try {
    await db.syncLease.create({ data: { name: LEASE, holder, expiresAt } });
    return true;
  } catch {
    return false;
  }
}

export type SyncResult = { status: "done" | "more" | "busy" | "not-connected"; steps: number; errors: number };

// Runs steps until the time budget is used up. With sourceId, works on that
// client's property only.
export async function runGscSync(opts: { budgetMs: number; sourceId?: string; force?: boolean; now?: () => Date }): Promise<SyncResult> {
  const clock = opts.now ?? (() => new Date());
  const started = clock();
  if (!googleConfigured() || !(await db.googleConnection.findFirst({ where: { brokenAt: null }, select: { id: true } }))) {
    return { status: "not-connected", steps: 0, errors: 0 };
  }
  const holder = randomUUID();
  if (!(await takeLease(holder, opts.budgetMs + 60_000, opts.force ?? false, started))) return { status: "busy", steps: 0, errors: 0 };
  let steps = 0;
  let errors = 0;
  const failed = new Set<string>();
  try {
    let token: string;
    try {
      token = await googleAccessToken();
    } catch {
      return { status: "not-connected", steps, errors: 1 };
    }
    const today = istDateKey(started);
    while (clock().getTime() - started.getTime() < opts.budgetMs) {
      const where = { kind: "GSC" as const, id: opts.sourceId ?? { notIn: [...failed] }, ...needsWork(today), client: { status: { not: "CHURNED" as const } } };
      // Today's pass for every client comes before anyone's history.
      const source =
        (await db.clientDataSource.findFirst({ where: { ...where, OR: [{ recentSyncedOn: null }, { recentSyncedOn: { lt: dateFromKey(today) } }] }, orderBy: { createdAt: "asc" } })) ??
        (await db.clientDataSource.findFirst({ where, orderBy: { lastSyncAt: { sort: "asc", nulls: "first" } } }));
      if (!source || failed.has(source.id)) break;
      try {
        if (!(await syncStep(token, source, clock()))) break;
        steps++;
      } catch (e) {
        errors++;
        failed.add(source.id);
        const message = e instanceof GoogleError ? e.message : "Unexpected error while pulling data.";
        await db.clientDataSource.update({ where: { id: source.id }, data: { lastError: message.slice(0, 500), lastSyncAt: clock() } });
        if (e instanceof GoogleError && e.tokenRevoked) break;
        if (!(e instanceof GoogleError)) console.error("GSC sync failed", e);
        if (opts.sourceId) break;
      }
    }
    const left = await db.clientDataSource.count({ where: { kind: "GSC", ...(opts.sourceId ? { id: opts.sourceId } : { id: { notIn: [...failed] } }), ...needsWork(today), client: { status: { not: "CHURNED" } } } });
    return { status: left ? "more" : "done", steps, errors };
  } finally {
    await db.syncLease.updateMany({ where: { name: LEASE, holder }, data: { holder: "cooldown", expiresAt: new Date(clock().getTime() + COOLDOWN_MS) } });
  }
}

// Background top-up while people use the dashboard: does nothing unless
// Google is connected, work is waiting and no run happened in the last minutes.
export async function backgroundGscSync() {
  if (!googleConfigured()) return;
  const today = istDateKey(new Date());
  const waiting = await db.clientDataSource.findFirst({
    where: { kind: "GSC", lastError: null, ...needsWork(today), client: { status: { not: "CHURNED" } } },
    select: { id: true },
  });
  if (!waiting) return;
  try {
    await runGscSync({ budgetMs: 20_000 });
  } catch (e) {
    console.error("Background GSC sync failed", e);
  }
}
