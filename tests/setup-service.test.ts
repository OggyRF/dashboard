import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { login } from "@/services/auth";
import { createFirstOwner, needsSetup } from "@/services/setup";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const input = { name: "Aarif", email: "Aarif@HiDigital.co.in", password: "a long first password" };

describe("first-run setup", () => {
  it("creates an owner who can sign in straight away", async () => {
    expect(await needsSetup()).toBe(true);
    const user = await createFirstOwner(input);
    expect(user).toMatchObject({ role: "OWNER", email: "aarif@hidigital.co.in", mustChangePassword: false });
    expect(await needsSetup()).toBe(false);

    const result = await login({ email: input.email, password: input.password, ip: null, userAgent: null });
    expect(result).toMatchObject({ ok: true, mustChangePassword: false });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.created" } });
    expect(JSON.stringify(audit.after)).not.toContain(input.password);
  });

  it("is closed once any account exists", async () => {
    await makeUser({ role: "EXECUTION" });
    await expect(createFirstOwner(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.user.count({ where: { role: "OWNER" } })).toBe(0);
  });

  it("lets only one of two simultaneous attempts through", async () => {
    const results = await Promise.allSettled([
      createFirstOwner(input),
      createFirstOwner({ ...input, email: "someone@example.com" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count()).toBe(1);
  });

  it("rejects weak passwords and bad emails", async () => {
    await expect(createFirstOwner({ ...input, password: "short" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createFirstOwner({ ...input, email: "not-an-email" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await needsSetup()).toBe(true);
  });
});
