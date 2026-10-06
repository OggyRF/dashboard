import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { normalizeEmail } from "@/services/auth";

const roleSchema = z.enum(["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"]);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name.").max(80),
  email: z.email("Enter a valid email address.").transform(normalizeEmail),
  role: roleSchema,
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  // Fixes a mistyped login email; the person signs in with the new one.
  email: z.string().transform(normalizeEmail).pipe(z.email("Enter a valid email address.")).optional(),
  role: roleSchema.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

function requireManager(actor: SessionUser) {
  if (!can(actor.role, "users.manage")) throw forbidden();
}

function snapshot(u: { name: string; email: string; role: string; status: string }) {
  return { name: u.name, email: u.email, role: u.role, status: u.status };
}

export async function listUsers(actor: SessionUser) {
  requireManager(actor);
  return db.user.findMany({
    where: { status: { not: "DELETED" } },
    orderBy: [{ status: "asc" }, { role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, mustChangePassword: true, avatarUpdatedAt: true },
  });
}

// Returns the temporary password once; it is never stored in plain text.
export async function createUser(actor: SessionUser, input: unknown, ip: string | null) {
  requireManager(actor);
  const data = createUserSchema.parse(input);
  if (await db.user.findUnique({ where: { email: data.email } })) {
    throw conflict("Someone already uses that email address.");
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { ...data, passwordHash, mustChangePassword: true } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.created",
      entityType: "User",
      entityId: created.id,
      after: snapshot(created),
      ip,
    });
    return created;
  });
  return { user, temporaryPassword };
}

export async function updateUser(actor: SessionUser, userId: string, input: unknown, ip: string | null) {
  requireManager(actor);
  const data = updateUserSchema.parse(input);
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing || existing.status === "DELETED") throw notFound("User");

  const losesOwner =
    existing.role === "OWNER" &&
    ((data.role && data.role !== "OWNER") || data.status === "DISABLED");
  if (losesOwner && userId === actor.id) {
    throw invalid("You cannot remove your own owner access. Ask the other owner.");
  }
  if (losesOwner) {
    const activeOwners = await db.user.count({ where: { role: "OWNER", status: "ACTIVE" } });
    if (activeOwners <= 1) throw invalid("At least one active owner must remain.");
  }

  if (data.email && data.email !== existing.email && (await db.user.findUnique({ where: { email: data.email } }))) {
    throw conflict("Someone already uses that email address.");
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data });
    if (data.status === "DISABLED" || (data.role && data.role !== existing.role)) {
      // Role or access changed: sign them out everywhere so the change applies now.
      await tx.session.deleteMany({ where: { userId } });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.updated",
      entityType: "User",
      entityId: userId,
      before: snapshot(existing),
      after: snapshot(updated),
      ip,
    });
    return updated;
  });
}

export async function resetPassword(actor: SessionUser, userId: string, ip: string | null) {
  requireManager(actor);
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing || existing.status === "DELETED") throw notFound("User");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, { actorId: actor.id, action: "user.password_reset", entityType: "User", entityId: userId, ip });
  });
  return { temporaryPassword };
}

export async function signOutEverywhere(actor: SessionUser, userId: string, ip: string | null) {
  requireManager(actor);
  await db.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.signed_out",
      entityType: "User",
      entityId: userId,
      after: { sessionsEnded: count },
      ip,
    });
  });
}

// Removes a person from the team. Their past attendance, leave and messages
// stay on record under their name, but they can no longer sign in, they
// disappear from every list, and their email address is freed for reuse.
export async function deleteUser(actor: SessionUser, userId: string, ip: string | null) {
  requireManager(actor);
  if (userId === actor.id) throw invalid("You cannot delete your own account.");
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing || existing.status === "DELETED") throw notFound("User");
  if (existing.role === "OWNER" && existing.status === "ACTIVE") {
    const activeOwners = await db.user.count({ where: { role: "OWNER", status: "ACTIVE" } });
    if (activeOwners <= 1) throw invalid("At least one active owner must remain.");
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { status: "DELETED", deletedAt: new Date(), email: `deleted-${userId}@removed.invalid`, avatarUpdatedAt: null },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.userAvatar.deleteMany({ where: { userId } });
    await writeAudit(tx, { actorId: actor.id, action: "user.deleted", entityType: "User", entityId: userId, before: snapshot(existing), ip });
  });
}

export async function listAuditLog(actor: SessionUser, page: number, pageSize = 50) {
  if (!can(actor.role, "audit.view")) throw forbidden();
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { name: true } } },
    }),
    db.auditLog.count(),
  ]);
  return { rows, total, pageSize };
}
