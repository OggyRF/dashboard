import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { addDays, dateFromKey, istDateKey, keyFromDbDate, shiftMonth } from "@/lib/dates";
import { forbidden, invalid } from "@/lib/errors";
import { GoogleError, ga4BatchReports } from "@/lib/google/api";
import { SeoToolError, bingConfigured, bingLinkCounts, bingSites, bingUrlLinks, mozConfigured, mozSiteMetrics, pageSpeed, siteDomain, siteUrl } from "@/lib/seo-tools";
import type { SessionUser } from "@/services/auth";
import { requireClient } from "@/services/clients";
import { AI_FILTER, ORGANIC_FILTER } from "@/services/ga4";
import { googleAccessToken } from "@/services/google";

// The "Website insights" tab: one row per month with organic traffic (GA4,
// read live), clicks and impressions (from the stored Search Console data),
// and the website figures (Moz and PageSpeed) checked once a month.

export const INSIGHT_MONTHS = 12;

export type InsightRow = {
  month: string;
  organicUsers: number | null;
  organicSessions: number | null;
  aiSessions: number | null;
  clicks: number | null;
  impressions: number | null;
  da: number | null;
  pa: number | null;
  backlinks: number | null;
  refDomains: number | null;
  spamScore: number | null;
  mobileSpeed: number | null;
  desktopSpeed: number | null;
};

const CACHE_MS = 30 * 60_000;
const ga4Cache = new Map<string, { at: number; value: Map<string, number[]> }>();

// Organic users and sessions and AI assistant sessions per month, from GA4.
async function ga4Months(property: string, first: string, today: string, now: Date) {
  const key = `${property}|${first}|${today}`;
  const hit = ga4Cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value;
  const range = [{ startDate: `${first}-01`, endDate: addDays(today, -1) }];
  const month = [{ name: "yearMonth" }];
  const [organic, ai] = await ga4BatchReports(await googleAccessToken(), property, [
    { dateRanges: range, dimensions: month, metrics: [{ name: "activeUsers" }, { name: "sessions" }], dimensionFilter: ORGANIC_FILTER, limit: 100 },
    { dateRanges: range, dimensions: month, metrics: [{ name: "sessions" }], dimensionFilter: AI_FILTER, limit: 100 },
  ]);
  const out = new Map<string, number[]>();
  const ym = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}`;
  for (const r of organic?.rows ?? []) out.set(ym(r.dimensionValues?.[0]?.value ?? ""), [Number(r.metricValues?.[0]?.value ?? 0), Number(r.metricValues?.[1]?.value ?? 0), 0]);
  for (const r of ai?.rows ?? []) {
    const k = ym(r.dimensionValues?.[0]?.value ?? "");
    const row = out.get(k) ?? [0, 0, 0];
    row[2] = Number(r.metricValues?.[0]?.value ?? 0);
    out.set(k, row);
  }
  ga4Cache.set(key, { at: now.getTime(), value: out });
  if (ga4Cache.size > 500) ga4Cache.delete(ga4Cache.keys().next().value!);
  return out;
}

export async function clientInsights(actor: SessionUser, clientId: string, now = new Date()) {
  const { client } = await requireClient(actor, clientId);
  const today = istDateKey(now);
  const thisMonth = today.slice(0, 7);
  const months = Array.from({ length: INSIGHT_MONTHS }, (_, i) => shiftMonth(thisMonth, -i));
  const first = months.at(-1)!;
  const sources = await db.clientDataSource.findMany({ where: { clientId } });
  const gsc = sources.find((s) => s.kind === "GSC");
  const ga4 = sources.find((s) => s.kind === "GA4");

  const clicks = new Map<string, [number, number]>();
  if (gsc) {
    const daily = await db.gscDailyTotal.findMany({ where: { dataSourceId: gsc.id, date: { gte: dateFromKey(`${first}-01`) } }, select: { date: true, clicks: true, impressions: true } });
    for (const d of daily) {
      const m = keyFromDbDate(d.date).slice(0, 7);
      const t = clicks.get(m) ?? [0, 0];
      clicks.set(m, [t[0] + d.clicks, t[1] + d.impressions]);
    }
  }

  let traffic: Map<string, number[]> | null = null;
  let ga4Error: string | null = null;
  if (ga4) {
    try {
      traffic = await ga4Months(ga4.externalId, first, today, now);
    } catch (e) {
      if (!(e instanceof GoogleError)) throw e;
      ga4Error = e.message;
    }
  }

  const saved = new Map((await db.websiteMetric.findMany({ where: { clientId, month: { gte: first } } })).map((m) => [m.month, m]));
  const rows: InsightRow[] = months.map((month) => {
    const t = traffic?.get(month);
    const c = clicks.get(month);
    const w = saved.get(month);
    return {
      month,
      organicUsers: traffic ? (t?.[0] ?? 0) : null,
      organicSessions: traffic ? (t?.[1] ?? 0) : null,
      aiSessions: traffic ? (t?.[2] ?? 0) : null,
      clicks: gsc ? (c?.[0] ?? 0) : null,
      impressions: gsc ? (c?.[1] ?? 0) : null,
      da: w?.da ?? null,
      pa: w?.pa ?? null,
      backlinks: w?.backlinks ?? null,
      refDomains: w?.refDomains ?? null,
      spamScore: w?.spamScore ?? null,
      mobileSpeed: w?.mobileSpeed ?? null,
      desktopSpeed: w?.desktopSpeed ?? null,
    };
  });
  const current = saved.get(thisMonth);
  return {
    client,
    rows,
    hasGsc: !!gsc,
    hasGa4: !!ga4,
    ga4Error,
    lastCheck: current?.checkedAt ?? null,
    lastError: current?.lastError ?? null,
  };
}

// ---------------------------------------------------------------------------
// The monthly website check
// ---------------------------------------------------------------------------

// Checks one client's website now and saves it as this month's figures.
// A part that fails keeps whatever was there before.
export async function checkWebsite(clientId: string, now = new Date()) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { website: true } });
  const month = istDateKey(now).slice(0, 7);
  const errors: string[] = [];
  const data: { da?: number; pa?: number; spamScore?: number | null; backlinks?: number; refDomains?: number; mobileSpeed?: number; desktopSpeed?: number } = {};
  const domain = client?.website ? siteDomain(client.website) : "";
  const existing = await db.websiteMetric.findUnique({ where: { clientId_month: { clientId, month } }, select: { da: true } });
  const mozDone = existing?.da !== null && existing?.da !== undefined;
  if (!domain) {
    errors.push("No website saved for this client.");
  } else {
    const url = siteUrl(client!.website!);
    const note = (e: unknown) => errors.push(e instanceof SeoToolError ? e.message : "Unexpected error.");
    await Promise.all([
      // Moz's free plan is small, so its figures are fetched once a month.
      mozConfigured() && !mozDone ? mozSiteMetrics(domain).then((m) => Object.assign(data, m), note) : Promise.resolve(),
      pageSpeed(url, "mobile").then((v) => (data.mobileSpeed = v), note),
      pageSpeed(url, "desktop").then((v) => (data.desktopSpeed = v), note),
    ]);
  }
  const fields = { ...data, checkedAt: now, lastError: errors.length ? errors.join(" ").slice(0, 500) : null };
  await db.websiteMetric.upsert({ where: { clientId_month: { clientId, month } }, create: { clientId, month, ...fields }, update: fields });
  return { ok: errors.length === 0, errors };
}

export async function checkWebsiteNow(actor: SessionUser, clientId: string, now = new Date()) {
  if (!can(actor.role, "clients.edit")) throw forbidden();
  await requireClient(actor, clientId);
  return checkWebsite(clientId, now);
}

const LEASE = "website-check";

// Background work: checks the next client that has no figures for this
// month yet. Runs while the team uses the dashboard; one at a time.
export async function runWebsiteChecks(opts: { budgetMs: number; now?: () => Date }) {
  const clock = opts.now ?? (() => new Date());
  const started = clock();
  const month = istDateKey(started).slice(0, 7);
  const pending = () =>
    db.client.findFirst({
      where: { status: { not: "CHURNED" }, website: { not: null }, websiteMetrics: { none: { month, checkedAt: { not: null } } } },
      orderBy: { name: "asc" },
      select: { id: true },
    });
  if (!(await pending())) return { checked: 0 };
  const holder = randomUUID();
  const expiresAt = new Date(started.getTime() + opts.budgetMs + 60_000);
  const taken = await db.syncLease.updateMany({ where: { name: LEASE, expiresAt: { lt: started } }, data: { holder, expiresAt } });
  if (!taken.count) {
    try {
      await db.syncLease.create({ data: { name: LEASE, holder, expiresAt } });
    } catch {
      return { checked: 0 };
    }
  }
  let checked = 0;
  try {
    // A check takes up to about 40 seconds, so only start one with time left.
    while (checked === 0 || clock().getTime() - started.getTime() < opts.budgetMs - 45_000) {
      const next = await pending();
      if (!next) break;
      await checkWebsite(next.id, clock());
      checked++;
    }
  } finally {
    await db.syncLease.updateMany({ where: { name: LEASE, holder }, data: { expiresAt: new Date(0) } });
  }
  return { checked };
}

// ---------------------------------------------------------------------------
// Typing figures in by hand (older months, or tools other than Moz)
// ---------------------------------------------------------------------------

const optionalInt = (max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(/,/g, ""))), z.number().int().min(0).max(max).nullable());

const manualSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  da: optionalInt(100),
  pa: optionalInt(100),
  spamScore: optionalInt(100),
  backlinks: optionalInt(1_000_000_000),
  refDomains: optionalInt(100_000_000),
  mobileSpeed: optionalInt(100),
  desktopSpeed: optionalInt(100),
});

export async function saveWebsiteMetrics(actor: SessionUser, clientId: string, input: unknown, ip: string | null, now = new Date()) {
  if (!can(actor.role, "clients.edit")) throw forbidden();
  await requireClient(actor, clientId);
  const { month, ...values } = manualSchema.parse(input);
  if (month > istDateKey(now).slice(0, 7) || month < shiftMonth(istDateKey(now).slice(0, 7), -(INSIGHT_MONTHS * 3))) throw invalid("Pick a month that has started.");
  await db.$transaction(async (tx) => {
    const before = await tx.websiteMetric.findUnique({ where: { clientId_month: { clientId, month } } });
    await tx.websiteMetric.upsert({ where: { clientId_month: { clientId, month } }, create: { clientId, month, ...values }, update: values });
    await writeAudit(tx, { actorId: actor.id, action: "client.websiteMetrics", entityType: "Client", entityId: clientId, before: before ?? undefined, after: { month, ...values }, ip });
  });
}

// ---------------------------------------------------------------------------
// The backlink list (live from Bing Webmaster Tools, which is free)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60_000;
const linkCache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ms: number, now: Date, load: () => Promise<T>): Promise<T> {
  const hit = linkCache.get(key);
  if (hit && now.getTime() - hit.at < ms) return hit.value as T;
  const value = await load();
  linkCache.set(key, { at: now.getTime(), value });
  if (linkCache.size > 500) linkCache.delete(linkCache.keys().next().value!);
  return value;
}

// Without a target page: the site's pages that have backlinks. With one: the
// links pointing at that page. Pages are numbered from 0, as Bing does.
export async function clientBacklinks(actor: SessionUser, clientId: string, input: { target?: string | null; page?: number }, now = new Date()) {
  const { client } = await requireClient(actor, clientId);
  const domain = client.website ? siteDomain(client.website) : "";
  if (!domain) throw invalid("This client has no website saved.");
  if (!bingConfigured()) throw invalid("The Bing Webmaster key is not in Vercel yet, so backlinks can't be listed.");
  const sites = await cached("sites", 60 * 60_000, now, bingSites);
  const site = sites.find((s) => siteDomain(s) === domain);
  if (!site) throw invalid(`${domain} is not in Bing Webmaster Tools yet. Add it there (Import from Google Search Console), then try again.`);
  const page = Math.max(0, Math.floor(input.page ?? 0));
  if (input.target) {
    const target = input.target;
    const links = await cached(`links|${site}|${target}|${page}`, DAY_MS, now, () => bingUrlLinks(site, target, page));
    return { domain, site, target, page, ...links, kind: "links" as const };
  }
  const pages = await cached(`counts|${site}|${page}`, DAY_MS, now, () => bingLinkCounts(site, page));
  return { domain, site, target: null, page, ...pages, kind: "pages" as const };
}

export function clearInsightCaches() {
  ga4Cache.clear();
  linkCache.clear();
}

