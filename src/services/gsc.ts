import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, dateFromKey, keyFromDbDate, shiftMonth } from "@/lib/dates";
import type { SessionUser } from "@/services/auth";
import { requireClient } from "@/services/clients";

// What a client's Search Console tab shows, read from the synced tables.

export const RANGES = {
  "7d": { label: "Last 7 days", days: 7 },
  "28d": { label: "Last 28 days", days: 28 },
  "3m": { label: "Last 3 months", days: 91 },
  "6m": { label: "Last 6 months", days: 182 },
  "12m": { label: "Last 12 months", days: 365 },
  "16m": { label: "Last 16 months", days: 486 },
} as const;
export type RangeKey = keyof typeof RANGES;

const viewSchema = z.object({
  range: z.enum(Object.keys(RANGES) as [RangeKey, ...RangeKey[]]).catch("28d"),
  month: z.string().optional().catch(undefined),
});

export type Totals = { clicks: number; impressions: number; ctr: number; position: number };
export type Point = { key: string; clicks: number; impressions: number; ctr: number; position: number };

function sum(rows: { clicks: number; impressions: number; position: number }[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weighted += r.position * r.impressions;
  }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? weighted / impressions : 0 };
}

export type BreakdownRow = Totals & { key: string; prevClicks: number | null; pages?: (Totals & { key: string })[] };

export async function clientSearchConsole(actor: SessionUser, clientId: string, input: { range?: string; month?: string } = {}) {
  await requireClient(actor, clientId);
  const { range, month: askedMonth } = viewSchema.parse(input);
  const source = await db.clientDataSource.findUnique({ where: { clientId_kind: { clientId, kind: "GSC" } } });
  if (!source) return { source: null } as const;

  const latest = await db.gscDailyTotal.findFirst({ where: { dataSourceId: source.id }, orderBy: { date: "desc" }, select: { date: true } });
  const earliest = await db.gscDailyTotal.findFirst({ where: { dataSourceId: source.id }, orderBy: { date: "asc" }, select: { date: true } });
  const monthRows = await db.gscRow.findMany({ where: { dataSourceId: source.id }, distinct: ["month"], select: { month: true }, orderBy: { month: "desc" } });
  const months = monthRows.map((m) => m.month);
  const base = { source, range, months, earliest: earliest ? keyFromDbDate(earliest.date) : null };
  if (!latest) return { ...base, latest: null } as const;

  // Like Search Console, ranges end on the newest day Google has finished.
  const end = keyFromDbDate(latest.date);
  const days = RANGES[range].days;
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const daily = await db.gscDailyTotal.findMany({
    where: { dataSourceId: source.id, date: { gte: dateFromKey(prevStart), lte: dateFromKey(end) } },
    orderBy: { date: "asc" },
  });
  const rows = daily.map((d) => ({ key: keyFromDbDate(d.date), clicks: d.clicks, impressions: d.impressions, position: d.position }));
  const current = rows.filter((r) => r.key >= start);
  const previous = rows.filter((r) => r.key < start);

  // Long ranges are drawn by week so the chart stays readable.
  const bucket = days > 100 ? 7 : 1;
  const series: Point[] = [];
  for (let i = 0; i < current.length; i += bucket) {
    const chunk = current.slice(i, i + bucket);
    series.push({ key: chunk[0]!.key, ...sum(chunk) });
  }

  const month = askedMonth && months.includes(askedMonth) ? askedMonth : (months[0] ?? null);
  const breakdowns = month ? await monthBreakdowns(source.id, month) : null;

  return {
    ...base,
    latest: end,
    window: { start, end, prevStart, prevEnd },
    totals: sum(current),
    previous: previous.length ? sum(previous) : null,
    series,
    bucket,
    month,
    breakdowns,
  } as const;
}

async function monthBreakdowns(sourceId: string, month: string) {
  const prevMonth = shiftMonth(month, -1);
  const [rows, prev] = await Promise.all([
    db.gscRow.findMany({ where: { dataSourceId: sourceId, month }, orderBy: { clicks: "desc" } }),
    db.gscRow.findMany({ where: { dataSourceId: sourceId, month: prevMonth, dimension: { in: ["QUERY", "PAGE"] } }, select: { dimension: true, key1: true, clicks: true } }),
  ]);
  const prevClicks = new Map(prev.map((p) => [`${p.dimension}|${p.key1}`, p.clicks]));
  const hasPrev = prev.length > 0;
  const view = (dimension: string, limit: number): BreakdownRow[] =>
    rows
      .filter((r) => r.dimension === dimension)
      .slice(0, limit)
      .map((r) => ({
        key: r.key1,
        ...sum([r]),
        // Only searches and pages are compared with the month before.
        prevClicks: hasPrev && (dimension === "QUERY" || dimension === "PAGE") ? (prevClicks.get(`${dimension}|${r.key1}`) ?? 0) : null,
      }));
  const queries = view("QUERY", 100);
  const pagesByQuery = new Map<string, (Totals & { key: string })[]>();
  for (const r of rows) {
    if (r.dimension !== "QUERY_PAGE") continue;
    const list = pagesByQuery.get(r.key1) ?? [];
    if (list.length < 5) list.push({ key: r.key2, ...sum([r]) });
    pagesByQuery.set(r.key1, list);
  }
  for (const q of queries) q.pages = pagesByQuery.get(q.key) ?? [];
  return {
    queries,
    pages: view("PAGE", 100),
    devices: view("DEVICE", 10),
    countries: view("COUNTRY", 15),
  };
}

