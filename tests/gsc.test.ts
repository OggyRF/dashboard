import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { exchangeCode } from "@/lib/google/api";
import { decryptSecret, encryptSecret } from "@/lib/google/crypto";
import { createClient } from "@/services/clients";
import { googleStatus, listAnalyticsProperties, saveConnection, setClientProperty, setManyProperties, suggestGa4Property, suggestProperty } from "@/services/google";
import { clearAnalyticsCache, clientAnalytics, isoWeekStart } from "@/services/ga4";
import { clientSearchConsole } from "@/services/gsc";
import { runGscSync } from "@/services/gsc-sync";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

const SITE = "sc-domain:iitb.example";

type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let failSite: string | null = null;
let revoked = false;
let ga4NoScope = false;

// A pretend Google: totals of (day of month) clicks a day, 300 searches a month.
function fakeGoogle(url: string, init?: RequestInit): Response {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  calls.push({ url, body });
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const form = new URLSearchParams(String(init?.body));
    if (form.get("grant_type") === "authorization_code") {
      const idToken = `x.${Buffer.from(JSON.stringify({ email: "agency@gmail.com" })).toString("base64url")}.y`;
      return json({ refresh_token: "refresh-secret", id_token: idToken, scope: "openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly" });
    }
    if (revoked) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
    return json({ access_token: "access" });
  }
  if (url.includes("analyticsadmin.googleapis.com")) {
    return json({ accountSummaries: [{ displayName: "Agency", propertySummaries: [{ property: "properties/111", displayName: "IITB GA4" }, { property: "properties/222", displayName: "Other site" }] }] });
  }
  if (url.includes("analyticsdata.googleapis.com")) {
    if (ga4NoScope) return json({ error: { message: "Request had insufficient authentication scopes." } }, 403);
    const both = (dims: string[], now: string[], before: string[]) => [
      { dimensionValues: [...dims.map((value) => ({ value })), { value: "now" }], metricValues: now.map((value) => ({ value })) },
      { dimensionValues: [...dims.map((value) => ({ value })), { value: "before" }], metricValues: before.map((value) => ({ value })) },
    ];
    const requests = (body!.requests as { dimensions?: { name: string }[]; dimensionFilter?: { filter: { fieldName: string } } }[]);
    const reports = requests.map((r) => {
      const dim = r.dimensions?.[0]?.name;
      const filter = r.dimensionFilter?.filter.fieldName;
      if (dim === "date" && filter === "sessionSource") return { rows: both(["20261014"], ["2"], ["1"]) };
      if (dim === "date") return { rows: [...both(["20261014"], ["30", "10", "40", "30"], ["20", "5", "25", "20"]), ...both(["20261015"], ["35", "12", "45", "33"], ["21", "6", "26", "21"])] };
      if (dim === "sessionDefaultChannelGroup") return { rows: [...both(["Organic Search"], ["150", "90", "0.8", "7", "60", "120"], ["100", "70", "0.7", "5", "50", "70"]), ...both(["Direct"], ["50", "30", "0.6", "2", "20", "30"], ["60", "30", "0.5", "1", "25", "30"])] };
      if (dim === "landingPage") return { rows: both(["/courses"], ["70", "50", "0.9", "3"], ["40", "30", "0.8", "1"]) };
      if (dim === "sessionSource") return { rows: both(["chatgpt.com"], ["4", "3", "0.9", "1"], ["2", "2", "0.5", "0"]) };
      if (filter === "sessionSource") return { rows: both([], ["4"], ["2"]) };
      return { rows: both([], ["120", "80", "200", "150", "0.75", "9"], ["100", "70", "160", "100", "0.625", "6"]) };
    });
    return json({ reports });
  }
  if (url.endsWith("/sites")) return json({ siteEntry: [{ siteUrl: SITE, permissionLevel: "siteOwner" }] });
  const site = decodeURIComponent(url.split("/sites/")[1]!.split("/")[0]!);
  if (site === failSite) return json({ error: { message: "User does not have sufficient permission for site." } }, 403);
  const dims = body!.dimensions as string[];
  const start = String(body!.startDate);
  const end = String(body!.endDate);
  const rowLimit = Number(body!.rowLimit);
  const startRow = Number(body!.startRow ?? 0);
  let rows: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] = [];
  if (dims[0] === "date") {
    for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.getUTCDate();
      rows.push({ keys: [d.toISOString().slice(0, 10)], clicks: day, impressions: day * 10, ctr: 0.1, position: day % 2 ? 4 : 8 });
    }
  } else {
    const n = dims[0] === "device" ? 3 : dims[0] === "country" ? 30 : 300;
    for (let i = 0; i < n; i++) {
      const keys = dims.map((dim) => (dim === "page" ? `https://iitb.example/p${i % 7}` : dim === "query" ? `search ${i}` : `${dim}${i}`));
      rows.push({ keys, clicks: n - i, impressions: (n - i) * 20, ctr: 0.05, position: 5 });
    }
  }
  rows = rows.slice(startRow, startRow + rowLimit);
  return json({ rows });
}

const owner = async () => asSessionUser((await makeUser({ role: "OWNER", name: "Aarif" })).user);
const on = (day: string, time = "11:00") => istDateTime(day, time);

beforeEach(async () => {
  await resetDatabase();
  calls = [];
  failSite = null;
  revoked = false;
  ga4NoScope = false;
  clearAnalyticsCache();
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.TOKEN_ENCRYPTION_KEY = "a long random test key for encryption";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => fakeGoogle(String(url), init)));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => db.$disconnect());

async function connected() {
  const aarif = await owner();
  const { refreshToken, email } = await exchangeCode("code", "https://x/api/google/callback");
  await saveConnection(aarif, email, refreshToken, null);
  const client = await createClient(aarif, { name: "IITB", type: "SEO", website: "https://www.iitb.example" }, null);
  return { aarif, client };
}

describe("Google connection", () => {
  it("keeps the refresh token only in encrypted form", async () => {
    const { aarif } = await connected();
    const row = await db.googleConnection.findUniqueOrThrow({ where: { id: "agency" } });
    expect(row.email).toBe("agency@gmail.com");
    expect(row.refreshTokenEnc).not.toContain("refresh-secret");
    expect(decryptSecret(row.refreshTokenEnc)).toBe("refresh-secret");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
    expect((await googleStatus(aarif)).connection?.email).toBe("agency@gmail.com");
    const staff = asSessionUser((await makeUser({ role: "OFFPAGE" })).user);
    await expect(saveConnection(staff, "x@gmail.com", "t", null)).rejects.toThrow(/permission/);
  });

  it("marks the connection broken and tells the owners when Google rejects it", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, SITE, null, on("2026-10-07"));
    revoked = true;
    expect((await runGscSync({ budgetMs: 10_000, now: () => on("2026-10-07") })).status).toBe("not-connected");
    expect((await db.googleConnection.findUniqueOrThrow({ where: { id: "agency" } })).brokenAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: aarif.id, title: { contains: "Google connection stopped" } } })).toBe(1);
    // Later runs do not try again until someone reconnects.
    expect((await runGscSync({ budgetMs: 10_000, force: true, now: () => on("2026-10-07") })).status).toBe("not-connected");
  });
});

describe("linking clients to properties", () => {
  it("suggests the property that matches the website", () => {
    const sites = ["https://www.other.com/", "sc-domain:iitb.example", "https://shop.example/"];
    expect(suggestProperty("https://www.iitb.example/about", sites)).toBe("sc-domain:iitb.example");
    expect(suggestProperty("shop.example", sites)).toBe("https://shop.example/");
    expect(suggestProperty("other.com", sites)).toBe("https://www.other.com/");
    expect(suggestProperty(null, sites)).toBeNull();
  });

  it("starts history from last month and drops old data when the property changes", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, SITE, null, on("2026-10-07"));
    const source = await db.clientDataSource.findFirstOrThrow();
    expect(source).toMatchObject({ externalId: SITE, backfillMonth: "2026-09", recentSyncedOn: null });
    await runGscSync({ budgetMs: 1, now: () => on("2026-10-07") });
    expect(await db.gscDailyTotal.count()).toBeGreaterThan(0);
    expect(await setManyProperties(aarif, [{ clientId: client.id, property: "https://www.iitb.example/" }], null, on("2026-10-07"))).toBe(1);
    expect(await db.gscDailyTotal.count()).toBe(0);
    await expect(setClientProperty(aarif, client.id, "not a property", null)).rejects.toThrow(/Search Console property/);
    const staff = asSessionUser((await makeUser({ role: "OFFPAGE" })).user);
    await expect(setClientProperty(staff, client.id, SITE, null)).rejects.toThrow(/permission/);
  });
});

describe("pulling Search Console data", () => {
  it("pulls today's data first, then 16 months of history one month at a time", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, SITE, null, on("2026-10-07"));
    let t = on("2026-10-07").getTime();
    // Time moves 10 seconds each time the clock is read, so the budget runs out quickly.
    const first = await runGscSync({ budgetMs: 25_000, now: () => new Date((t += 10_000)) });
    expect(first.status).toBe("more");
    const source = await db.clientDataSource.findFirstOrThrow();
    expect(source.recentSyncedOn?.toISOString().slice(0, 10)).toBe("2026-10-07");
    // Totals: 1 Jul 2025 (16 months back) up to yesterday.
    const totals = calls.find((c) => (c.body?.dimensions as string[] | undefined)?.[0] === "date")!.body!;
    expect(totals).toMatchObject({ startDate: "2025-07-01", endDate: "2026-10-06", type: "web", dataState: "final" });
    expect(await db.gscDailyTotal.count()).toBe(463);

    // Another run straight away waits for the cooldown; Sync now does not.
    expect((await runGscSync({ budgetMs: 25_000, now: () => new Date(t) })).status).toBe("busy");
    let result = first;
    for (let i = 0; i < 20 && result.status === "more"; i++) result = await runGscSync({ budgetMs: 1_000_000, force: true, now: () => new Date(t) });
    expect(result.status).toBe("done");
    const done = await db.clientDataSource.findFirstOrThrow();
    expect(done.backfillMonth).toBeNull();
    const months = await db.gscRow.findMany({ distinct: ["month"], select: { month: true }, orderBy: { month: "asc" } });
    expect(months.map((m) => m.month)).toHaveLength(16);
    expect(months[0]!.month).toBe("2025-07");
    // Recent months keep 500 rows per breakdown; older ones 100.
    expect(await db.gscRow.count({ where: { month: "2026-09", dimension: "QUERY" } })).toBe(300);
    expect(await db.gscRow.count({ where: { month: "2025-12", dimension: "QUERY" } })).toBe(100);
    expect(await db.gscRow.count({ where: { month: "2025-12", dimension: "DEVICE" } })).toBe(3);
    expect(await db.gscRow.findFirst({ where: { dimension: "QUERY_PAGE" } })).toMatchObject({ key1: "search 0", key2: "https://iitb.example/p0" });
  });

  it("re-pulls the last 5 days the next day and refreshes this month", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, SITE, null, on("2026-10-07"));
    await db.clientDataSource.updateMany({ data: { backfillMonth: null } });
    await runGscSync({ budgetMs: 1, now: () => on("2026-10-07") });
    calls = [];
    await runGscSync({ budgetMs: 1, force: true, now: () => on("2026-10-08") });
    const totals = calls.find((c) => (c.body?.dimensions as string[] | undefined)?.[0] === "date")!.body!;
    expect(totals).toMatchObject({ startDate: "2026-10-02", endDate: "2026-10-07" });
    expect(await db.gscDailyTotal.count({ where: { date: new Date("2026-10-07") } })).toBe(1);
    // Nothing more to do that day.
    expect((await runGscSync({ budgetMs: 10_000, force: true, now: () => on("2026-10-08", "15:00") })).steps).toBe(0);
  });

  it("records a property's error and carries on with the other clients", async () => {
    const { aarif, client } = await connected();
    const second = await createClient(aarif, { name: "Second", type: "SEO" }, null);
    await setClientProperty(aarif, client.id, "sc-domain:broken.example", null, on("2026-10-07"));
    await setClientProperty(aarif, second.id, SITE, null, on("2026-10-07"));
    failSite = "sc-domain:broken.example";
    const result = await runGscSync({ budgetMs: 1_000_000, now: () => on("2026-10-07") });
    expect(result).toMatchObject({ status: "done", errors: 1 });
    const broken = await db.clientDataSource.findFirstOrThrow({ where: { clientId: client.id } });
    expect(broken.lastError).toMatch(/sufficient permission/);
    expect((await db.clientDataSource.findFirstOrThrow({ where: { clientId: second.id } })).backfillMonth).toBeNull();
  });
});

describe("Search Console tab", () => {
  it("adds up clicks, compares with the period before and lists top searches with their pages", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, SITE, null, on("2026-10-07"));
    await runGscSync({ budgetMs: 1_000_000, now: () => on("2026-10-07") });
    const view = await clientSearchConsole(aarif, client.id, { range: "7d" });
    if (!view.source || !view.latest) throw new Error("no data");
    // 30 Sep – 6 Oct: clicks 30 + 1 + 2 + ... + 6.
    expect(view.window).toMatchObject({ start: "2026-09-30", end: "2026-10-06" });
    expect(view.totals.clicks).toBe(30 + 21);
    expect(view.totals.impressions).toBe(510);
    expect(view.totals.ctr).toBeCloseTo(0.1);
    expect(view.previous?.clicks).toBe(23 + 24 + 25 + 26 + 27 + 28 + 29);
    expect(view.series).toHaveLength(7);
    // Position is weighted by impressions: odd days 4, even days 8.
    const odd = [1, 3, 5].reduce((a, d) => a + d * 10, 0);
    const even = [30, 2, 4, 6].reduce((a, d) => a + d * 10, 0);
    expect(view.totals.position).toBeCloseTo((odd * 4 + even * 8) / (odd + even));
    expect(view.month).toBe("2026-10");
    expect(view.breakdowns!.queries[0]).toMatchObject({ key: "search 0", clicks: 300, prevClicks: 300 });
    expect(view.breakdowns!.queries[0]!.pages![0]!.key).toBe("https://iitb.example/p0");
    expect(view.breakdowns!.devices).toHaveLength(3);
    // Long ranges are drawn by week.
    const year = await clientSearchConsole(aarif, client.id, { range: "12m" });
    expect(year.source && "bucket" in year && year.bucket).toBe(7);
    // Off-page staff cannot open it.
    const staff = asSessionUser((await makeUser({ role: "OFFPAGE" })).user);
    await expect(clientSearchConsole(staff, client.id)).rejects.toThrow(/not found/);
  });
});

describe("Google Analytics", () => {
  it("lists properties and suggests one from the client's website or name", async () => {
    const { aarif } = await connected();
    const props = await listAnalyticsProperties(aarif);
    expect(props.map((p) => p.property)).toEqual(["properties/111", "properties/222"]);
    expect(suggestGa4Property("IITB", "https://www.iitb.example", props)).toBe("properties/111");
    expect(suggestGa4Property("Some other site", null, props)).toBe("properties/222");
    expect(suggestGa4Property("Nobody", "https://nobody.example", props)).toBeNull();
  });

  it("links a property without touching Search Console, and checks the format", async () => {
    const { aarif, client } = await connected();
    await expect(setClientProperty(aarif, client.id, "sc-domain:iitb.example", null, new Date(), "GA4")).rejects.toThrow(/Google Analytics property/);
    await setManyProperties(aarif, [{ clientId: client.id, property: "properties/111", kind: "GA4" }], null);
    const sources = await db.clientDataSource.findMany({ where: { clientId: client.id } });
    expect(sources.map((s) => [s.kind, s.externalId, s.backfillMonth])).toEqual([["GA4", "properties/111", null]]);
    expect((await runGscSync({ budgetMs: 5_000 })).steps).toBe(0);
  });

  it("reads the tab live from GA4 and reuses the answer", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, "properties/111", null, new Date(), "GA4");
    const now = on("2026-10-16");
    const first = await clientAnalytics(aarif, client.id, { range: "7d" }, now);
    const view = first.view!;
    expect(view.window).toMatchObject({ start: "2026-10-09", end: "2026-10-15", prevStart: "2026-10-02", prevEnd: "2026-10-08" });
    expect(view.totals).toMatchObject({ users: 120, sessions: 200, engagementRate: 0.75, keyEvents: 9 });
    expect(view.previous?.sessions).toBe(160);
    expect(view.organic).toEqual({ users: 90, newUsers: 60, sessions: 150, engagedSessions: 120, ai: 4 });
    expect(view.organicBefore).toEqual({ users: 70, newUsers: 50, sessions: 100, engagedSessions: 70, ai: 2 });
    // Every day is listed, days without visits as zero.
    expect(view.series).toHaveLength(7);
    expect(view.series.at(-2)).toEqual({ key: "2026-10-14", now: { users: 30, newUsers: 10, sessions: 40, engagedSessions: 30, ai: 2 }, before: { users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, ai: 0 } });
    expect(view.channels.map((c) => [c.key, c.sessions, c.prevSessions])).toEqual([["Organic Search", 150, 100], ["Direct", 50, 60]]);
    expect(view.organicPages[0]).toMatchObject({ key: "/courses", sessions: 70, keyEvents: 3 });
    expect(view.aiSources[0]).toMatchObject({ key: "chatgpt.com", sessions: 4, prevSessions: 2 });
    const asked = calls.filter((c) => c.url.includes("analyticsdata")).length;
    await clientAnalytics(aarif, client.id, { range: "7d" }, now);
    expect(calls.filter((c) => c.url.includes("analyticsdata")).length).toBe(asked);
  });

  it("shows a picked month against the month before", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, "properties/111", null, new Date(), "GA4");
    const sept = await clientAnalytics(aarif, client.id, { month: "2026-09" }, on("2026-10-16"));
    expect(sept.month).toBe("2026-09");
    expect(sept.view?.window).toMatchObject({ start: "2026-09-01", end: "2026-09-30", prevStart: "2026-08-01", prevEnd: "2026-08-31" });
    const current = await clientAnalytics(aarif, client.id, { month: "2026-10" }, on("2026-10-16"));
    expect(current.view?.window).toMatchObject({ start: "2026-10-01", end: "2026-10-15" });
    const future = await clientAnalytics(aarif, client.id, { month: "2026-12" }, on("2026-10-16"));
    expect([future.month, future.range]).toEqual([null, "28d"]);
  });

  it("turns GA4 week numbers into the Monday they start", () => {
    expect(isoWeekStart("202641")).toBe("2026-10-05");
    expect(isoWeekStart("202601")).toBe("2025-12-29");
  });

  it("asks for a reconnect when the saved sign-in has no Analytics access", async () => {
    const { aarif, client } = await connected();
    await setClientProperty(aarif, client.id, "properties/111", null, new Date(), "GA4");
    ga4NoScope = true;
    const result = await clientAnalytics(aarif, client.id, {}, on("2026-10-16"));
    expect(result.view).toBeNull();
    expect(result.error).toMatch(/Reconnect/);
  });
});
