import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "hid_session";
// Signed out after 12 hours without activity, and after 7 days regardless.
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
// lastSeenAt is written at most this often to keep page loads cheap.
export const SESSION_TOUCH_MS = 5 * 60 * 1000;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isSessionExpired(
  session: { createdAt: Date; lastSeenAt: Date; expiresAt: Date },
  now: Date,
): boolean {
  if (now >= session.expiresAt) return true;
  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS) return true;
  return now.getTime() - session.createdAt.getTime() > SESSION_MAX_MS;
}
