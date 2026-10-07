import { timingSafeEqual } from "node:crypto";

export const STATE_COOKIE = "g_oauth_state";

// The address Google sends people back to. It must match the redirect URI
// entered in Google Cloud exactly.
export function callbackUrl(request: Request) {
  const base = process.env.APP_URL || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/api/google/callback`;
}

export function sameState(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
