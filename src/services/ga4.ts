import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, istDateKey } from "@/lib/dates";
import { GoogleError, ga4BatchReports, type Ga4Report, type Ga4Request } from "@/lib/google/api";
import type { SessionUser } from "@/services/auth";
import { requireClient } from "@/services/clients";
import { googleAccessToken } from "@/services/google";
import { RANGES, type RangeKey } from "@/services/gsc";

// A client's Google Analytics tab. Unlike Search Console, nothing is stored:
// each view asks GA4 directly (one call with four reports) and the answer is
// kept in memory for a while, so repeat visits cost nothing.

export const GA4_RANGES = Object.fromEntries(Object.entries(RANGES).filter(([k]) => k !== "16m")) as Omit<typeof RANGES, "16m">;
type Ga4RangeKey = Exclude<RangeKey, "16m">;

const rangeSchema = z.enum(Object.keys(GA4_RANGES) as [Ga4RangeKey, ...Ga4RangeKey[]]).catch("28d");

export type Ga4Totals = { users: number; newUsers: number; sessions: number; engagedSessions: number; engagementRate: number; keyEvents: number };
export type Ga4Row = { key: string; sessions: number; users: number; engagementRate: number; keyEvents: number; prevSessions: number | null };
export type Ga4Point = { key: string; clicks: number; impressions: number };

const TOTAL_METRICS = ["activeUsers", "newUsers", "sessions", "engagedSessions", "engagementRate", "keyEvents"];
const ROW_METRICS = ["sessions", "activeUsers", "engagementRate", "keyEvents"];
const m = (names: string[]) => names.map((name) => ({ name }));

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: Ga4View }>();

export type Ga4View = {
  totals: Ga4Totals;
  previous: Ga4Totals | null;
  series: Ga4Point[];
  weekly: boolean;
  channels: Ga4Row[];
  organicPages: Ga4Row[];
  window: { start: string; end: string };
};

function num(v: string | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function totalsFrom(values: { value: string }[] | undefined): Ga4Totals {
  const [users, newUsers, sessions, engagedSessions, engagementRate, keyEvents] = TOTAL_METRICS.map((_, i) => num(values?.[i]?.value));
  return { users: users!, newUsers: newUsers!, sessions: sessions!, engagedSessions: engagedSessions!, engagementRate: engagementRate!, keyEvents: keyEvents! };
}

// With two date ranges GA4 adds a "dateRange" column holding "now" or "before".
function rowsByRange(report: Ga4Report | undefined) {
  const now = new Map<string, number[]>();
  const before = new Map<string, number[]>();
  for (const r of report?.rows ?? []) {
    const dims = (r.dimensionValues ?? []).map((d) => d.value);
    const range = dims.find((d) => d === "now" || d === "before") ?? "now";
    const key = dims.find((d) => d !== "now" && d !== "before") ?? "";
    (range === "now" ? now : before).set(key, (r.metricValues ?? []).map((v) => num(v.value)));
  }
  return { now, before };
}

function rowsFrom(report: Ga4Report | undefined, limit: number): Ga4Row[] {
  const { now, before } = rowsByRange(report);
  const hasBefore = before.size > 0;
  return [...now.entries()]
    .map(([key, v]) => ({ key, sessions: v[0] ?? 0, users: v[1] ?? 0, engagementRate: v[2] ?? 0, keyEvents: v[3] ?? 0, prevSessions: hasBefore ? (before.get(key)?.[0] ?? 0) : null }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

export function buildRequests(days: number): Ga4Request[] {
  const ranges = [
    { startDate: `${days}daysAgo`, endDate: "yesterday", name: "now" },
    { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo`, name: "before" },
  ];
  const organic = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } };
  return [
    { dateRanges: ranges, metrics: m(TOTAL_METRICS) },
    { dateRanges: [ranges[0]!], dimensions: [{ name: "date" }], metrics: m(["sessions", "engagedSessions"]), orderBys: [{ dimension: { dimensionName: "date" } }], limit: 400 },
    { dateRanges: ranges, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: m(ROW_METRICS), limit: 50 },
    { dateRanges: ranges, dimensions: [{ name: "landingPage" }], metrics: m(ROW_METRICS), dimensionFilter: organic, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 50 },
  ];
}

export function parseReports(reports: Ga4Report[], days: number, today: string): Ga4View {
  const totals = rowsByRange(reports[0]);
  const daily = (reports[1]?.rows ?? []).map((r) => {
    const d = r.dimensionValues?.[0]?.value ?? "";
    return { key: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, clicks: num(r.metricValues?.[0]?.value), impressions: num(r.metricValues?.[1]?.value) };
  });
  // Long ranges are drawn by week so the chart stays readable.
  const weekly = days > 100;
  const series: Ga4Point[] = [];
  for (let i = 0; i < daily.length; i += weekly ? 7 : 1) {
    const chunk = daily.slice(i, i + (weekly ? 7 : 1));
    series.push({ key: chunk[0]!.key, clicks: chunk.reduce((s, p) => s + p.clicks, 0), impressions: chunk.reduce((s, p) => s + p.impressions, 0) });
  }
  const now = [...totals.now.values()][0];
  const before = [...totals.before.values()][0];
  const toTotals = (v: number[] | undefined) => totalsFrom(v?.map((x) => ({ value: String(x) })));
  const end = addDays(today, -1);
  return {
    totals: toTotals(now),
    previous: before && before.some((x) => x > 0) ? toTotals(before) : null,
    series,
    weekly,
    channels: rowsFrom(reports[2], 20),
    organicPages: rowsFrom(reports[3], 25),
    window: { start: addDays(end, -(days - 1)), end },
  };
}

export async function clientAnalytics(actor: SessionUser, clientId: string, input: { range?: string } = {}, now = new Date()) {
  await requireClient(actor, clientId);
  const range = rangeSchema.parse(input.range);
  const source = await db.clientDataSource.findUnique({ where: { clientId_kind: { clientId, kind: "GA4" } } });
  if (!source) return { source: null, range } as const;
  const days = GA4_RANGES[range].days;
  // GA4 counts days in the property's own time zone; for Indian sites that is India time.
  const today = istDateKey(now);
  const key = `${source.externalId}|${range}|${today}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return { source, range, view: hit.value, error: null } as const;
  try {
    const reports = await ga4BatchReports(await googleAccessToken(), source.externalId, buildRequests(days));
    const view = parseReports(reports, days, today);
    cache.set(key, { at: now.getTime(), value: view });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return { source, range, view, error: null } as const;
  } catch (e) {
    if (!(e instanceof GoogleError)) throw e;
    const scope = e.status === 403 && /scope/i.test(e.message);
    const error = scope ? "The Google connection was made before Analytics was added. An owner needs to press Reconnect in Settings › Google once." : e.message;
    return { source, range, view: null, error } as const;
  }
}

export function clearAnalyticsCache() {
  cache.clear();
}
