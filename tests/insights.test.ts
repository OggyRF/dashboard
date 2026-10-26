import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dateFromKey, istDateTime } from "@/lib/dates";
import { encryptSecret } from "@/lib/google/crypto";
import { createClient } from "@/services/clients";
import { setClientProperty } from "@/services/google";
import { checkWebsiteNow, clientBacklinks, clientInsights, clearInsightCaches, runWebsiteChecks, saveWebsiteMetrics } from "@/services/insights";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

let calls: string[] = [];
let speedFails = false;

function fake(url: string, init?: RequestInit): Response {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  calls.push(url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access" });
  if (url.startsWith("https://api.moz.com/jsonrpc")) {
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === "data.site.metrics.fetch") {
      return json({ result: { site_metrics: { domain_authority: 14.4, page_authority: 34.2, spam_score: 17, external_pages_to_root_domain: 2156, root_domains_to_root_domain: 287 } } });
    }
    return json({ error: { message: "not used" } }, 400);
  }
  if (url.startsWith("https://ssl.bing.com/webmaster/api.svc/json/")) {
    const method = url.split("/json/")[1]!.split("?")[0];
    if (method === "GetUserSites") return json({ d: [{ Url: "https://www.iitb.example/", IsVerified: true }] });
    if (method === "GetLinkCounts") return json({ d: { Links: [{ Url: "https://www.iitb.example/courses", Count: 12 }], TotalPages: 1 } });
    if (method === "GetUrlLinks") return json({ d: { Details: [{ Url: "https://blog.example/post", AnchorText: "best courses" }], TotalPages: 3 } });
  }
  if (url.startsWith("https://www.googleapis.com/pagespeedonline")) {
    if (speedFails) return json({ error: { message: "Lighthouse returned an error" } }, 500);
    return json({ lighthouseResult: { categories: { performance: { score: url.includes("strategy=mobile") ? 0.42 : 0.56 } } } });
  }
  if (url.includes("analyticsdata.googleapis.com")) {
    return json({
      reports: [
        { rows: [{ dimensionValues: [{ value: "202609" }], metricValues: [{ value: "2324" }, { value: "2432" }] }, { dimensionValues: [{ value: "202610" }], metricValues: [{ value: "2400" }, { value: "2600" }] }] },
        { rows: [{ dimensionValues: [{ value: "202609" }], metricValues: [{ value: "321" }] }] },
      ],
    });
  }
  return json({ error: { message: `unexpected ${url}` } }, 404);
}

const on = (day: string) => istDateTime(day, "11:00");

beforeEach(async () => {
  await resetDatabase();
  calls = [];
  speedFails = false;
  clearInsightCaches();
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.TOKEN_ENCRYPTION_KEY = "a long random test key for encryption";
  process.env.MOZ_API_TOKEN = "moz-token";
  process.env.BING_WEBMASTER_API_KEY = "bing-key";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => fake(String(url), init)));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => db.$disconnect());

async function setup() {
  const aarif = asSessionUser((await makeUser({ role: "OWNER", name: "Aarif" })).user);
  const client = await createClient(aarif, { name: "IITB", type: "SEO", website: "https://www.iitb.example" }, null);
  return { aarif, client };
}

describe("Website insights", () => {
  it("checks each client's website once a month, in the background", async () => {
    const { aarif, client } = await setup();
    await createClient(aarif, { name: "No site", type: "GMB" }, null);
    const result = await runWebsiteChecks({ budgetMs: 50_000, now: () => on("2026-10-26") });
    expect(result.checked).toBe(1);
    const saved = await db.websiteMetric.findUniqueOrThrow({ where: { clientId_month: { clientId: client.id, month: "2026-10" } } });
    expect(saved).toMatchObject({ da: 14, pa: 34, spamScore: 17, backlinks: 2156, refDomains: 287, mobileSpeed: 42, desktopSpeed: 56, lastError: null });
    // Already done this month: nothing more to check.
    expect((await runWebsiteChecks({ budgetMs: 50_000, now: () => on("2026-10-27") })).checked).toBe(0);
    expect((await runWebsiteChecks({ budgetMs: 50_000, now: () => on("2026-11-01") })).checked).toBe(1);
  });

  it("keeps the Moz figures when page speed fails, and notes the error", async () => {
    const { client } = await setup();
    speedFails = true;
    await runWebsiteChecks({ budgetMs: 50_000, now: () => on("2026-10-26") });
    const saved = await db.websiteMetric.findUniqueOrThrow({ where: { clientId_month: { clientId: client.id, month: "2026-10" } } });
    expect(saved).toMatchObject({ da: 14, mobileSpeed: null });
    expect(saved.lastError).toMatch(/PageSpeed/);
  });

  it("builds the monthly table from GA4, Search Console and saved figures", async () => {
    const { aarif, client } = await setup();
    await db.googleConnection.create({ data: { id: "agency", email: "agency@gmail.com", refreshTokenEnc: encryptSecret("refresh"), connectedById: aarif.id } });
    await setClientProperty(aarif, client.id, "properties/111", null, new Date(), "GA4");
    await setClientProperty(aarif, client.id, "sc-domain:iitb.example", null, on("2026-10-26"));
    const gsc = await db.clientDataSource.findFirstOrThrow({ where: { kind: "GSC" } });
    await db.gscDailyTotal.createMany({
      data: [
        { dataSourceId: gsc.id, date: dateFromKey("2026-09-01"), clicks: 600, impressions: 50000, position: 9 },
        { dataSourceId: gsc.id, date: dateFromKey("2026-09-02"), clicks: 600, impressions: 45000, position: 9 },
      ],
    });
    await saveWebsiteMetrics(aarif, client.id, { month: "2026-09", da: "14", pa: "35", backlinks: "2,166", refDomains: "290", spamScore: "15", mobileSpeed: "42", desktopSpeed: "" }, null, on("2026-10-26"));
    const view = await clientInsights(aarif, client.id, on("2026-10-26"));
    expect(view.rows).toHaveLength(12);
    expect(view.rows[0]!.month).toBe("2026-10");
    expect(view.rows[1]).toEqual({
      month: "2026-09", organicUsers: 2324, organicSessions: 2432, aiSessions: 321, clicks: 1200, impressions: 95000,
      da: 14, pa: 35, backlinks: 2166, refDomains: 290, spamScore: 15, mobileSpeed: 42, desktopSpeed: null,
    });
    expect(view.rows[2]).toMatchObject({ organicUsers: 0, clicks: 0, da: null });
  });

  it("asks Moz only once a month, even when checked again", async () => {
    const { aarif, client } = await setup();
    await checkWebsiteNow(aarif, client.id, on("2026-10-26"));
    await checkWebsiteNow(aarif, client.id, on("2026-10-27"));
    expect(calls.filter((u) => u.includes("api.moz.com")).length).toBe(1);
    expect(calls.filter((u) => u.includes("pagespeedonline")).length).toBe(4);
  });

  it("only lets editors type figures, and lists backlinks from Bing", async () => {
    const { aarif, client } = await setup();
    const staff = asSessionUser((await makeUser({ role: "OFFPAGE" })).user);
    await expect(saveWebsiteMetrics(staff, client.id, { month: "2026-09", da: "10" }, null)).rejects.toThrow();
    await expect(saveWebsiteMetrics(aarif, client.id, { month: "2026-09", da: "120" }, null)).rejects.toThrow();
    const pages = await clientBacklinks(aarif, client.id, {});
    expect(pages).toMatchObject({ kind: "pages", site: "https://www.iitb.example/", items: [{ url: "https://www.iitb.example/courses", count: 12 }] });
    const links = await clientBacklinks(aarif, client.id, { target: "https://www.iitb.example/courses", page: 1 });
    expect(links).toMatchObject({ kind: "links", page: 1, totalPages: 3, items: [{ source: "https://blog.example/post", anchor: "best courses" }] });
    expect(calls.find((u) => u.includes("GetUrlLinks"))).toContain("page=1");
  });
});
