// A small Google client for OAuth and the Search Console API, using fetch.
// Secrets come from the environment only and are never logged.

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_BASE = "https://www.googleapis.com/webmasters/v3";

export class GoogleError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // Google no longer accepts the saved sign-in (revoked, expired, password changed).
    public readonly tokenRevoked = false,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY);
}

function clientCredentials() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set");
  return { id, secret };
}

export function consentUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientCredentials().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${GSC_SCOPE}`,
    access_type: "offline",
    // Always ask, so Google returns a refresh token on every connect.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retries rate limits and Google-side errors with backoff (1s, 2s, 4s).
async function call(url: string, init: RequestInit, retries = 3): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new GoogleError(`Could not reach Google: ${(e as Error).message}`, 0);
    }
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    let message = text.slice(0, 300);
    let code = "";
    try {
      const body = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
      if (typeof body.error === "string") code = body.error;
      message = body.error_description ?? (typeof body.error === "object" ? body.error.message : body.error) ?? message;
    } catch {}
    throw new GoogleError(`Google said: ${message}`, res.status, code === "invalid_grant");
  }
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; email: string }> {
  const { id, secret } = clientCredentials();
  const body = (await call(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  })) as { refresh_token?: string; id_token?: string; scope?: string };
  if (!body.refresh_token) throw new GoogleError("Google did not return a long-term sign-in. Please try connecting again.", 400);
  if (!body.scope?.includes(GSC_SCOPE)) throw new GoogleError("Search Console access was not ticked on Google's screen. Please connect again and allow it.", 400);
  // The ID token comes straight from Google over HTTPS, so its payload can be read as is.
  const payload = body.id_token ? JSON.parse(Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString("utf8")) : {};
  return { refreshToken: body.refresh_token, email: String(payload.email ?? "unknown") };
}

export async function accessToken(refreshToken: string): Promise<string> {
  const { id, secret } = clientCredentials();
  const body = (await call(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: "refresh_token" }),
  })) as { access_token: string };
  return body.access_token;
}

export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => {});
}

export type GscSite = { siteUrl: string; permissionLevel: string };

export async function listSites(token: string): Promise<GscSite[]> {
  const body = (await call(`${GSC_BASE}/sites`, { headers: { authorization: `Bearer ${token}` } })) as { siteEntry?: GscSite[] };
  return (body.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export type GscApiRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

export type GscQuery = {
  startDate: string;
  endDate: string;
  dimensions: ("date" | "query" | "page" | "device" | "country")[];
  rowLimit?: number;
  startRow?: number;
};

// One Search Analytics request (web search). Up to 25,000 rows per page.
export async function searchAnalytics(token: string, siteUrl: string, query: GscQuery): Promise<GscApiRow[]> {
  const body = (await call(`${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "web", dataState: "final", ...query }),
  })) as { rows?: GscApiRow[] };
  return body.rows ?? [];
}

// Pages through results until `max` rows or the end.
export async function searchAnalyticsAll(token: string, siteUrl: string, query: GscQuery, max: number): Promise<GscApiRow[]> {
  const rows: GscApiRow[] = [];
  const page = Math.min(25_000, max);
  while (rows.length < max) {
    const requested = Math.min(page, max - rows.length);
    const batch = await searchAnalytics(token, siteUrl, { ...query, rowLimit: requested, startRow: rows.length });
    rows.push(...batch);
    if (batch.length < requested) break;
  }
  return rows;
}
