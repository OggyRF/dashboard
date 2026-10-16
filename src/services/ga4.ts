import { db } from "@/lib/db";
import { addDays, istDateKey, monthKeys, shiftMonth } from "@/lib/dates";
import { GoogleError, ga4BatchReports, type Ga4Report, type Ga4Request } from "@/lib/google/api";
import type { SessionUser } from "@/services/auth";
import { requireClient } from "@/services/clients";
import { googleAccessToken } from "@/services/google";
import { RANGES, type RangeKey } from "@/services/gsc";

// A client's Google Analytics tab. Unlike Search Console, nothing is stored:
// each view asks GA4 directly (two calls, seven reports) and the answer is
// kept in memory for a while, so repeat visits cost nothing.

export const GA4_RANGES = Object.fromEntries(Object.entries(RANGES).filter(([k]) => k !== "16m")) as Omit<typeof RANGES, "16m">;
type Ga4RangeKey = Exclude<RangeKey, "16m">;
// Months that can be picked, newest first.
export const GA4_MONTHS = 16;

// Visits referred by AI assistants, matched on the session source.
export const AI_SOURCES = "chatgpt|openai|perplexity|gemini|bard|copilot|claude|anthropic|deepseek|meta\\.ai|grok|you\\.com|poe\\.com|mistral";

export const ORGANIC_METRICS = {
  users: "Organic users",
  newUsers: "Organic new users",
  sessions: "Organic sessions",
  engagedSessions: "Organic engaged sessions",
  ai: "AI assistant sessions",
} as const;
export type OrganicMetric = keyof typeof ORGANIC_METRICS;

export type Ga4Totals = { users: number; newUsers: number; sessions: number; engagedSessions: number; engagementRate: number; keyEvents: number };
export type Ga4Row = { key: string; sessions: number; users: number; engagementRate: number; keyEvents: number; prevSessions: number | null };
export type OrganicPoint = { key: string; now: Record<OrganicMetric, number>; before: Record<OrganicMetric, number> | null };

export type Ga4Window = { start: string; end: string; prevStart: string; prevEnd: string; label: string };

export type Ga4View = {
  window: Ga4Window;
  totals: Ga4Totals;
  previous: Ga4Totals | null;
  organic: Record<OrganicMetric, number>;
  organicBefore: Record<OrganicMetric, number> | null;
  series: OrganicPoint[];
  weekly: boolean;
  channels: Ga4Row[];
  organicPages: Ga4Row[];
  aiSources: Ga4Row[];
};

const TOTAL_METRICS = ["activeUsers", "newUsers", "sessions", "engagedSessions", "engagementRate", "keyEvents"];
const ROW_METRICS = ["sessions", "activeUsers", "engagementRate", "keyEvents"];
const SERIES_METRICS = ["activeUsers", "newUsers", "sessions", "engagedSessions"];
const m = (names: string[]) => names.map((name) => ({ name }));
const ORGANIC = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } };
const AI = { filter: { fieldName: "sessionSource", stringFilter: { matchType: "PARTIAL_REGEXP", value: AI_SOURCES, caseSensitive: false } } };

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: Ga4View }>();

function num(v: string | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// The period shown: a preset range ending yesterday, or one calendar month
// (compared with the month before).
export function ga4Window(input: { range?: string; month?: string }, today: string): Ga4Window & { range: Ga4RangeKey | null; month: string | null; days: number } {
  const yesterday = addDays(today, -1);
  const thisMonth = today.slice(0, 7);
  const month = input.month && /^\d{4}-\d{2}$/.test(input.month) && input.month <= thisMonth && input.month >= shiftMonth(thisMonth, -(GA4_MONTHS - 1)) ? input.month : null;
  if (month) {
    const days = monthKeys(month);
    const prev = monthKeys(shiftMonth(month, -1));
    const end = [days.at(-1)!, yesterday].sort()[0]!;
    return { range: null, month, days: days.length, start: days[0]!, end, prevStart: prev[0]!, prevEnd: prev.at(-1)!, label: "compared with the month before" };
  }
  const range = (Object.keys(GA4_RANGES) as Ga4RangeKey[]).find((k) => k === input.range) ?? "28d";
  const days = GA4_RANGES[range].days;
  const start = addDays(yesterday, -(days - 1));
  const prevEnd = addDays(start, -1);
  return { range, month: null, days, start, end: yesterday, prevStart: addDays(prevEnd, -(days - 1)), prevEnd, label: "compared with the period before" };
}

export function buildRequests(w: Ga4Window, weekly: boolean): [Ga4Request[], Ga4Request[]] {
  const ranges = [
    { startDate: w.start, endDate: w.end, name: "now" },
    { startDate: w.prevStart, endDate: w.prevEnd, name: "before" },
  ];
  const time = [{ name: weekly ? "isoYearIsoWeek" : "date" }];
  return [
    [
      { dateRanges: ranges, metrics: m(TOTAL_METRICS) },
      { dateRanges: ranges, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: m([...ROW_METRICS, "newUsers", "engagedSessions"]), limit: 50 },
      { dateRanges: ranges, metrics: m(["sessions"]), dimensionFilter: AI },
      { dateRanges: ranges, dimensions: [{ name: "landingPage" }], metrics: m(ROW_METRICS), dimensionFilter: ORGANIC, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 50 },
      { dateRanges: ranges, dimensions: [{ name: "sessionSource" }], metrics: m(ROW_METRICS), dimensionFilter: AI, limit: 30 },
    ],
    [
      { dateRanges: ranges, dimensions: time, metrics: m(SERIES_METRICS), dimensionFilter: ORGANIC, limit: 1000 },
      { dateRanges: ranges, dimensions: time, metrics: m(["sessions"]), dimensionFilter: AI, limit: 1000 },
    ],
  ];
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

const toTotals = (v: number[] | undefined): Ga4Totals => ({
  users: v?.[0] ?? 0,
  newUsers: v?.[1] ?? 0,
  sessions: v?.[2] ?? 0,
  engagedSessions: v?.[3] ?? 0,
  engagementRate: v?.[4] ?? 0,
  keyEvents: v?.[5] ?? 0,
});

// "202640" (ISO year and week) to the Monday that starts it.
export function isoWeekStart(value: string): string {
  const year = Number(value.slice(0, 4));
  const week = Number(value.slice(4));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000);
  return new Date(monday.getTime() + (week - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}

const zero = (): Record<OrganicMetric, number> => ({ users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, ai: 0 });

function seriesFrom(organic: Ga4Report | undefined, ai: Ga4Report | undefined, w: Ga4Window, weekly: boolean): OrganicPoint[] {
  const o = rowsByRange(organic);
  const a = rowsByRange(ai);
  // Days with no visits are missing from GA4's answer, so list every day.
  const keys = (from: string, to: string, found: Map<string, number[]>, alsoFound: Map<string, number[]>) => {
    if (weekly) return [...new Set([...found.keys(), ...alsoFound.keys()])].sort();
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d.replaceAll("-", ""));
    return out;
  };
  const values = (k: string, metrics: Map<string, number[]>, aiMetrics: Map<string, number[]>) => {
    const v = metrics.get(k);
    return { users: v?.[0] ?? 0, newUsers: v?.[1] ?? 0, sessions: v?.[2] ?? 0, engagedSessions: v?.[3] ?? 0, ai: aiMetrics.get(k)?.[0] ?? 0 };
  };
  const nowKeys = keys(w.start, w.end, o.now, a.now);
  const beforeKeys = keys(w.prevStart, w.prevEnd, o.before, a.before);
  const hasBefore = o.before.size > 0 || a.before.size > 0;
  return nowKeys.map((k, i) => ({
    key: weekly ? isoWeekStart(k) : `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`,
    now: values(k, o.now, a.now),
    before: hasBefore ? (beforeKeys[i] ? values(beforeKeys[i]!, o.before, a.before) : zero()) : null,
  }));
}

export function parseReports(main: Ga4Report[], series: Ga4Report[], w: Ga4Window, weekly: boolean): Ga4View {
  const totals = rowsByRange(main[0]);
  const channels = rowsByRange(main[1]);
  const ai = rowsByRange(main[2]);
  const organicOf = (v: number[] | undefined, aiSessions: number | undefined): Record<OrganicMetric, number> => ({
    // Channel rows: sessions, users, engagement rate, key events, new users, engaged sessions.
    users: v?.[1] ?? 0,
    newUsers: v?.[4] ?? 0,
    sessions: v?.[0] ?? 0,
    engagedSessions: v?.[5] ?? 0,
    ai: aiSessions ?? 0,
  });
  const before = [...totals.before.values()][0];
  const hasBefore = !!before && before.some((x) => x > 0);
  return {
    window: w,
    totals: toTotals([...totals.now.values()][0]),
    previous: hasBefore ? toTotals(before) : null,
    organic: organicOf(channels.now.get("Organic Search"), [...ai.now.values()][0]?.[0]),
    organicBefore: hasBefore ? organicOf(channels.before.get("Organic Search"), [...ai.before.values()][0]?.[0]) : null,
    series: seriesFrom(series[0], series[1], w, weekly),
    weekly,
    channels: rowsFrom(main[1], 20),
    organicPages: rowsFrom(main[3], 25),
    aiSources: rowsFrom(main[4], 15),
  };
}

export async function clientAnalytics(actor: SessionUser, clientId: string, input: { range?: string; month?: string } = {}, now = new Date()) {
  await requireClient(actor, clientId);
  // GA4 counts days in the property's own time zone; for Indian sites that is India time.
  const today = istDateKey(now);
  const w = ga4Window(input, today);
  const pick = { range: w.range, month: w.month };
  const source = await db.clientDataSource.findUnique({ where: { clientId_kind: { clientId, kind: "GA4" } } });
  if (!source) return { source: null, ...pick, view: null, error: null } as const;
  const weekly = w.days > 100;
  const key = `${source.externalId}|${w.start}|${w.end}|${today}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return { source, ...pick, view: hit.value, error: null } as const;
  try {
    const token = await googleAccessToken();
    const [mainReq, seriesReq] = buildRequests(w, weekly);
    const [main, series] = await Promise.all([ga4BatchReports(token, source.externalId, mainReq), ga4BatchReports(token, source.externalId, seriesReq)]);
    const view = parseReports(main, series, w, weekly);
    cache.set(key, { at: now.getTime(), value: view });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return { source, ...pick, view, error: null } as const;
  } catch (e) {
    if (!(e instanceof GoogleError)) throw e;
    const scope = e.status === 403 && /scope/i.test(e.message);
    const error = scope ? "The Google connection was made before Analytics was added. An owner needs to press Reconnect in Settings › Google once." : e.message;
    return { source, ...pick, view: null, error } as const;
  }
}

export function clearAnalyticsCache() {
  cache.clear();
}
