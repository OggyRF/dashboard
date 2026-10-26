import { randomUUID } from "node:crypto";

// Moz (authority, links, spam score), Bing Webmaster Tools (backlink list)
// and Google PageSpeed, using fetch. Keys come from the environment only:
// MOZ_API_TOKEN, BING_WEBMASTER_API_KEY and PAGESPEED_API_KEY.

export class SeoToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoToolError";
  }
}

export const mozConfigured = () => !!process.env.MOZ_API_TOKEN;
export const pageSpeedConfigured = () => !!process.env.PAGESPEED_API_KEY;

// "https://www.example.com/x" -> "example.com"
export function siteDomain(website: string): string {
  try {
    return new URL(/^https?:\/\//.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function siteUrl(website: string): string {
  return /^https?:\/\//.test(website) ? website : `https://${website}`;
}

async function moz(method: string, data: unknown): Promise<Record<string, unknown>> {
  const token = process.env.MOZ_API_TOKEN;
  if (!token) throw new SeoToolError("The Moz key is not in Vercel yet.");
  let res: Response;
  try {
    res = await fetch("https://api.moz.com/jsonrpc", {
      method: "POST",
      headers: { "x-moz-token": token, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params: { data } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new SeoToolError(`Could not reach Moz: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: { message?: string } };
  if (!res.ok || body.error || !body.result) throw new SeoToolError(`Moz said: ${body.error?.message ?? `error ${res.status}`}`);
  return body.result;
}

export type MozMetrics = { da: number; pa: number; spamScore: number | null; backlinks: number; refDomains: number };

export async function mozSiteMetrics(domain: string): Promise<MozMetrics> {
  const result = await moz("data.site.metrics.fetch", { site_query: { query: domain, scope: "domain" } });
  const m = (result.site_metrics ?? {}) as Record<string, number | null | undefined>;
  return {
    da: Math.round(m.domain_authority ?? 0),
    pa: Math.round(m.page_authority ?? 0),
    // Moz gives -1 when it has no spam score for a site.
    spamScore: m.spam_score === undefined || m.spam_score === null || m.spam_score < 0 ? null : Math.round(m.spam_score),
    backlinks: m.external_pages_to_root_domain ?? 0,
    refDomains: m.root_domains_to_root_domain ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Bing Webmaster Tools (free): the backlink list. BING_WEBMASTER_API_KEY.
// ---------------------------------------------------------------------------

export const bingConfigured = () => !!process.env.BING_WEBMASTER_API_KEY;

async function bing(method: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const key = process.env.BING_WEBMASTER_API_KEY;
  if (!key) throw new SeoToolError("The Bing Webmaster key is not in Vercel yet.");
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), apikey: key });
  let res: Response;
  try {
    res = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/${method}?${query}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
  } catch (e) {
    throw new SeoToolError(`Could not reach Bing: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: { d?: unknown; Message?: string; ErrorCode?: number } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new SeoToolError(`Bing said: ${body.Message ?? `error ${res.status}`}`);
  return body.d ?? body;
}

// The sites added to Bing Webmaster Tools, e.g. "https://www.example.com/".
export async function bingSites(): Promise<string[]> {
  const sites = (await bing("GetUserSites")) as { Url?: string }[] | null;
  return (sites ?? []).map((s) => s.Url ?? "").filter(Boolean);
}

export type LinkedPage = { url: string; count: number };
export type Backlink = { source: string; anchor: string };

// Pages of the site that have backlinks, with how many each has.
export async function bingLinkCounts(site: string, page: number): Promise<{ items: LinkedPage[]; totalPages: number }> {
  const r = (await bing("GetLinkCounts", { siteUrl: site, page })) as { Links?: { Url?: string; Count?: number }[]; TotalPages?: number } | null;
  return { items: (r?.Links ?? []).map((l) => ({ url: l.Url ?? "", count: l.Count ?? 0 })), totalPages: r?.TotalPages ?? 0 };
}

// The backlinks pointing at one page of the site.
export async function bingUrlLinks(site: string, link: string, page: number): Promise<{ items: Backlink[]; totalPages: number }> {
  const r = (await bing("GetUrlLinks", { siteUrl: site, link, page })) as { Details?: { Url?: string; AnchorText?: string }[]; TotalPages?: number } | null;
  return { items: (r?.Details ?? []).map((l) => ({ source: l.Url ?? "", anchor: l.AnchorText ?? "" })), totalPages: r?.TotalPages ?? 0 };
}

// Google's PageSpeed performance score (0-100) for one device type.
export async function pageSpeed(url: string, strategy: "mobile" | "desktop"): Promise<number> {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: AbortSignal.timeout(50_000) });
  } catch (e) {
    throw new SeoToolError(`PageSpeed did not answer: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { lighthouseResult?: { categories?: { performance?: { score?: number | null } } }; error?: { message?: string } };
  const score = body.lighthouseResult?.categories?.performance?.score;
  if (!res.ok || typeof score !== "number") throw new SeoToolError(`PageSpeed said: ${body.error?.message ?? `error ${res.status}`}`);
  return Math.round(score * 100);
}
