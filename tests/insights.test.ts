import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dateFromKey, istDateTime } from "@/lib/dates";
import { encryptSecret } from "@/lib/google/crypto";
import { createClient } from "@/services/clients";
import { setClientProperty } from "@/services/google";
import { clientBacklinks, clientInsights, clearInsightCaches, runWebsiteChecks, saveWebsiteMetrics } from "@/services/insights";
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
    return json({ result: { links: [{ anchor_text: "best courses", nofollow: false, date_first_seen: "2026-03-02T00:00:00Z", source_site_metrics: { page: "blog.example/post", domain_authority: 41 } }], offset: { token: "next-1" } } });
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

  it("only lets editors type figures, and lists backlinks from Moz", async () => {
    const { aarif, client } = await setup();
    const staff = asSessionUser((await makeUser({ role: "OFFPAGE" })).user);
    await expect(saveWebsiteMetrics(staff, client.id, { month: "2026-09", da: "10" }, null)).rejects.toThrow();
    await expect(saveWebsiteMetrics(aarif, client.id, { month: "2026-09", da: "120" }, null)).rejects.toThrow();
    const links = await clientBacklinks(aarif, client.id, null);
    expect(links).toMatchObject({ domain: "iitb.example", next: "next-1", links: [{ source: "blog.example/post", anchor: "best courses", da: 41, nofollow: false, firstSeen: "2026-03-02" }] });
  });
});
