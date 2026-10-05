import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/auth/password";
import {
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  hashSessionToken,
  isSessionExpired,
  newSessionToken,
} from "@/lib/auth/tokens";

describe("password policy", () => {
  it("rejects short and common passwords", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("Password@123")).toMatch(/too common/);
    expect(passwordProblem("a perfectly fine phrase")).toBeNull();
  });

  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword("a perfectly fine phrase");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "a perfectly fine phrase")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });

  it("generates temporary passwords that pass the policy", () => {
    const p = generateTemporaryPassword();
    expect(p).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}-[A-Za-z0-9]{4}$/);
    expect(passwordProblem(p)).toBeNull();
    expect(generateTemporaryPassword()).not.toBe(p);
  });
});

describe("session tokens", () => {
  it("stores only a hash of the token", () => {
    const token = newSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });

  it("expires after idle time and after the maximum age", () => {
    const start = new Date("2026-10-05T04:00:00Z");
    const fresh = { createdAt: start, lastSeenAt: start, expiresAt: new Date(start.getTime() + SESSION_IDLE_MS) };
    expect(isSessionExpired(fresh, new Date(start.getTime() + 60_000))).toBe(false);
    expect(isSessionExpired(fresh, new Date(start.getTime() + SESSION_IDLE_MS + 1))).toBe(true);

    const active = {
      createdAt: start,
      lastSeenAt: new Date(start.getTime() + SESSION_MAX_MS),
      expiresAt: new Date(start.getTime() + SESSION_MAX_MS + SESSION_IDLE_MS),
    };
    expect(isSessionExpired(active, new Date(start.getTime() + SESSION_MAX_MS + 1000))).toBe(true);
  });
});
