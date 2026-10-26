import { randomUUID } from "node:crypto";

// Moz (authority, links, spam score) and Google PageSpeed, using fetch.
// Keys come from the environment only: MOZ_API_TOKEN and PAGESPEED_API_KEY.

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

export type Backlink = { source: string; anchor: string; da: number | null; nofollow: boolean; firstSeen: string | null };

// One page (up to 50) of a site's backlinks, strongest first. Each link
// returned uses one row of the Moz plan.
export async function mozBacklinks(domain: string, token: string | null): Promise<{ links: Backlink[]; next: string | null }> {
  const result = await moz("data.site.link.list", {
    site_query: { query: domain, scope: "domain" },
    options: { sort: "source_domain_authority", filters: ["external"] },
    offset: { token, limit: 50 },
  });
  const links = ((result.links ?? []) as Record<string, unknown>[]).map((l) => {
    const src = (l.source_site_metrics ?? {}) as Record<string, unknown>;
    return {
      source: String(src.page ?? ""),
      anchor: String(l.anchor_text ?? ""),
      da: typeof src.domain_authority === "number" ? Math.round(src.domain_authority) : null,
      nofollow: !!l.nofollow,
      firstSeen: typeof l.date_first_seen === "string" ? l.date_first_seen.slice(0, 10) : null,
    };
  });
  const next = ((result.offset ?? {}) as { token?: string | null }).token ?? null;
  return { links, next: links.length ? next : null };
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
