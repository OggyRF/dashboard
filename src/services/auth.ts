import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import {
  SESSION_IDLE_MS,
  SESSION_TOUCH_MS,
  hashSessionToken,
  isSessionExpired,
  newSessionToken,
} from "@/lib/auth/tokens";
import { invalid, notFound } from "@/lib/errors";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_FAILED_LOGINS_PER_IP = 20;

// Used when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$x09QEDWLgSRxA9UAzGjRKQ$7Uej915BRWZqO2sq3AMYURj7lugQLPcUu6L0IezNyak";

export type LoginInput = { email: string; password: string; ip: string | null; userAgent: string | null };
export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" | "locked" | "rate_limited" };

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function login(input: LoginInput, now = new Date()): Promise<LoginResult> {
  const email = normalizeEmail(input.email);

  if (input.ip) {
    const recentIpFailures = await db.loginAttempt.count({
      where: { ip: input.ip, success: false, createdAt: { gte: new Date(now.getTime() - LOCKOUT_MS) } },
    });
    if (recentIpFailures >= MAX_FAILED_LOGINS_PER_IP) {
      await db.loginAttempt.create({ data: { email, ip: input.ip, success: false } });
      return { ok: false, reason: "rate_limited" };
    }
  }

  const user = await db.user.findUnique({ where: { email } });
  const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, input.password);

  if (!user || user.status !== "ACTIVE") {
    await db.loginAttempt.create({ data: { email, ip: input.ip, success: false } });
    return { ok: false, reason: "invalid" };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await db.loginAttempt.create({ data: { email, ip: input.ip, success: false } });
    return { ok: false, reason: "locked" };
  }

  if (!passwordOk) {
    const failed = user.failedLoginCount + 1;
    const locks = failed >= MAX_FAILED_LOGINS;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: locks ? 0 : failed,
          lockedUntil: locks ? new Date(now.getTime() + LOCKOUT_MS) : user.lockedUntil,
        },
      });
      await tx.loginAttempt.create({ data: { email, ip: input.ip, success: false } });
      await writeAudit(tx, {
        actorId: user.id,
        action: locks ? "auth.locked" : "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        ip: input.ip,
      });
    });
    return { ok: false, reason: locks ? "locked" : "invalid" };
  }

  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  await db.$transaction(async (tx) => {
    await tx.session.create({
      data: {
        id: hashSessionToken(token),
        userId: user.id,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    await tx.loginAttempt.create({ data: { email, ip: input.ip, success: true } });
    await writeAudit(tx, { actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ip: input.ip });
  });

  return { ok: true, token, expiresAt, mustChangePassword: user.mustChangePassword };
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE";
  mustChangePassword: boolean;
  // Set when the person has a profile photo; changes with every new photo.
  avatarUpdatedAt?: Date | null;
  sessionId: string;
};

// Returns the signed-in user for a cookie token, or null. Slides the idle
// expiry forward at most every few minutes.
export async function validateSessionToken(token: string, now = new Date()): Promise<SessionUser | null> {
  const id = hashSessionToken(token);
  const session = await db.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return null;

  if (isSessionExpired(session, now) || session.user.status !== "ACTIVE") {
    await db.session.deleteMany({ where: { id } });
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    await db.session.update({
      where: { id },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_IDLE_MS) },
    });
  }

  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    avatarUpdatedAt: user.avatarUpdatedAt,
    sessionId: id,
  };
}

export async function logout(token: string, ip: string | null) {
  const id = hashSessionToken(token);
  const session = await db.session.findUnique({ where: { id } });
  if (!session) return;
  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { id } });
    await writeAudit(tx, { actorId: session.userId, action: "auth.logout", entityType: "User", entityId: session.userId, ip });
  });
}

export async function changeOwnPassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
  ip: string | null,
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User");
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw invalid("Your current password is not correct.");
  }
  const problem = passwordProblem(newPassword);
  if (problem) throw invalid(problem);
  if (newPassword === currentPassword) throw invalid("Choose a password different from the current one.");

  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
    // Sign out every other device.
    await tx.session.deleteMany({ where: { userId, id: { not: currentSessionId } } });
    await writeAudit(tx, { actorId: userId, action: "user.password_changed", entityType: "User", entityId: userId, ip });
  });
}

export async function deleteExpiredSessions(now = new Date()) {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}
