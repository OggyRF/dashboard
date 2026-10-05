import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { login } from "@/services/auth";
import { createUser, listUsers, resetPassword, updateUser } from "@/services/users";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

describe("team management", () => {
  it("lets an owner create a login that must change its temporary password", async () => {
    const { user: owner } = await makeUser({ role: "OWNER" });
    const { user, temporaryPassword } = await createUser(
      asSessionUser(owner),
      { name: "Huzaif", email: "Huzaif@Gmail.com", role: "OFFPAGE" },
      null,
    );
    expect(user.email).toBe("huzaif@gmail.com");
    expect(user.passwordHash).not.toContain(temporaryPassword);

    const result = await login({ email: "huzaif@gmail.com", password: temporaryPassword, ip: null, userAgent: null });
    expect(result).toMatchObject({ ok: true, mustChangePassword: true });

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.created" } });
    expect(audit.actorId).toBe(owner.id);
    expect(JSON.stringify(audit.after)).not.toContain(temporaryPassword);
  });

  it("refuses non-owners", async () => {
    for (const role of ["STRATEGY", "EXECUTION", "OFFPAGE"] as const) {
      const { user } = await makeUser({ role });
      await expect(listUsers(asSessionUser(user))).rejects.toThrow(/permission/);
      await expect(createUser(asSessionUser(user), { name: "X Y", email: "x@example.com", role: "OWNER" }, null)).rejects.toThrow(/permission/);
    }
  });

  it("rejects duplicate emails", async () => {
    const { user: owner } = await makeUser({ role: "OWNER" });
    await makeUser({ email: "dup@example.com" });
    await expect(createUser(asSessionUser(owner), { name: "Dup", email: "DUP@example.com", role: "EXECUTION" }, null)).rejects.toThrow(/already/);
  });

  it("keeps at least one active owner and stops owners demoting themselves", async () => {
    const { user: aarif } = await makeUser({ role: "OWNER", name: "Aarif" });
    await expect(updateUser(asSessionUser(aarif), aarif.id, { role: "STRATEGY" }, null)).rejects.toThrow(/your own owner access/);

    const { user: salman } = await makeUser({ role: "OWNER", name: "Salman" });
    await updateUser(asSessionUser(aarif), salman.id, { status: "DISABLED" }, null);
    await db.user.update({ where: { id: salman.id }, data: { status: "ACTIVE" } });
    await db.user.update({ where: { id: aarif.id }, data: { status: "DISABLED" } });
    await expect(updateUser(asSessionUser(aarif), salman.id, { role: "EXECUTION" }, null)).rejects.toThrow(/At least one active owner/);
  });

  it("signs a person out when their role changes or they are disabled", async () => {
    const { user: owner } = await makeUser({ role: "OWNER" });
    const { user, password } = await makeUser({ role: "EXECUTION" });
    await login({ email: user.email, password, ip: null, userAgent: null });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);

    await updateUser(asSessionUser(owner), user.id, { role: "STRATEGY" }, null);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.updated" } });
    expect(audit.before).toMatchObject({ role: "EXECUTION" });
    expect(audit.after).toMatchObject({ role: "STRATEGY" });
  });

  it("resets a password, unlocks the account and ends sessions", async () => {
    const { user: owner } = await makeUser({ role: "OWNER" });
    const { user, password } = await makeUser();
    await login({ email: user.email, password, ip: null, userAgent: null });
    await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });

    const { temporaryPassword } = await resetPassword(asSessionUser(owner), user.id, null);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    const result = await login({ email: user.email, password: temporaryPassword, ip: null, userAgent: null });
    expect(result).toMatchObject({ ok: true, mustChangePassword: true });
  });
});
