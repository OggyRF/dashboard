import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashSessionToken } from "@/lib/auth/tokens";
import {
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  MAX_FAILED_LOGINS_PER_IP,
  changeOwnPassword,
  login,
  logout,
  validateSessionToken,
} from "@/services/auth";
import { makeUser, resetDatabase } from "./helpers";

const meta = { ip: "203.0.113.5", userAgent: "vitest" };

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

describe("login", () => {
  it("signs in with any email provider, case-insensitively, and stores only the token hash", async () => {
    const { user, password } = await makeUser({ email: "huzaif.seo@gmail.com" });
    const result = await login({ email: "  Huzaif.SEO@Gmail.com ", password, ...meta });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await db.session.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(hashSessionToken(result.token));
    expect(stored[0].id).not.toBe(result.token);

    const actions = (await db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain("auth.login");
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    await makeUser({ email: "saad@example.com" });
    const unknown = await login({ email: "nobody@example.com", password: "whatever123", ...meta });
    const wrong = await login({ email: "saad@example.com", password: "whatever123", ...meta });
    expect(unknown).toEqual({ ok: false, reason: "invalid" });
    expect(wrong).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks the account after repeated wrong passwords, even for the right password", async () => {
    const { user, password } = await makeUser({ email: "sohail@example.com" });
    const now = new Date();
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      expect(await login({ email: user.email, password: "nope-nope-nope", ...meta }, now)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await login({ email: user.email, password: "nope-nope-nope", ...meta }, now)).toEqual({ ok: false, reason: "locked" });
    expect(await login({ email: user.email, password, ...meta }, now)).toEqual({ ok: false, reason: "locked" });

    const later = new Date(now.getTime() + LOCKOUT_MS + 1000);
    const result = await login({ email: user.email, password, ip: "198.51.100.9", userAgent: null }, later);
    expect(result.ok).toBe(true);
  });

  it("rate-limits one network address that keeps failing", async () => {
    const { user, password } = await makeUser();
    await db.loginAttempt.createMany({
      data: Array.from({ length: MAX_FAILED_LOGINS_PER_IP }, () => ({ email: "x@example.com", ip: meta.ip, success: false })),
    });
    expect(await login({ email: user.email, password, ...meta })).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("refuses disabled accounts", async () => {
    const { user, password } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    expect(await login({ email: user.email, password, ...meta })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("sessions", () => {
  it("validates, then ends on logout", async () => {
    const { user, password } = await makeUser({ role: "OFFPAGE" });
    const result = await login({ email: user.email, password, ...meta });
    if (!result.ok) throw new Error("login failed");

    const sessionUser = await validateSessionToken(result.token);
    expect(sessionUser).toMatchObject({ id: user.id, role: "OFFPAGE" });

    await logout(result.token, meta.ip);
    expect(await validateSessionToken(result.token)).toBeNull();
  });

  it("ends sessions of a disabled account at once", async () => {
    const { user, password } = await makeUser();
    const result = await login({ email: user.email, password, ...meta });
    if (!result.ok) throw new Error("login failed");
    await db.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    expect(await validateSessionToken(result.token)).toBeNull();
  });

  it("expires a session left idle", async () => {
    const { user, password } = await makeUser();
    const start = new Date();
    const result = await login({ email: user.email, password, ...meta }, start);
    if (!result.ok) throw new Error("login failed");
    expect(await validateSessionToken(result.token, new Date(start.getTime() + 13 * 3600_000))).toBeNull();
  });
});

describe("changing your own password", () => {
  it("clears the must-change flag and signs out other devices only", async () => {
    const { user, password } = await makeUser({ mustChangePassword: true });
    const a = await login({ email: user.email, password, ...meta });
    const b = await login({ email: user.email, password, ...meta });
    if (!a.ok || !b.ok) throw new Error("login failed");

    await changeOwnPassword(user.id, hashSessionToken(a.token), password, "a brand new passphrase", meta.ip);

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword).toBe(false);
    expect(await validateSessionToken(a.token)).not.toBeNull();
    expect(await validateSessionToken(b.token)).toBeNull();
    expect((await login({ email: user.email, password: "a brand new passphrase", ...meta })).ok).toBe(true);
  });

  it("requires the current password and a strong new one", async () => {
    const { user, password } = await makeUser();
    await expect(changeOwnPassword(user.id, "s", "wrong-current", "a brand new passphrase", null)).rejects.toThrow(/current password/);
    await expect(changeOwnPassword(user.id, "s", password, "short", null)).rejects.toThrow(/at least 10/);
  });
});
