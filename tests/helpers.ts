import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/services/auth";

export async function resetDatabase() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_logs", "login_attempts", "sessions", "notifications",
      "message_reads", "messages", "message_threads", "leave_requests", "holidays",
      "attendance_corrections", "attendance_events", "attendance_days", "users"
     RESTART IDENTITY CASCADE`,
  );
}

export async function makeUser(overrides: Partial<{ name: string; email: string; role: SessionUser["role"]; password: string; mustChangePassword: boolean }> = {}) {
  const password = overrides.password ?? "correct horse battery";
  const user = await db.user.create({
    data: {
      name: overrides.name ?? "Test Person",
      email: overrides.email ?? `person${Math.random().toString(36).slice(2, 8)}@example.com`,
      role: overrides.role ?? "EXECUTION",
      passwordHash: await hashPassword(password),
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  });
  return { user, password };
}

export function asSessionUser(user: { id: string; name: string; email: string; role: SessionUser["role"] }): SessionUser {
  return { ...user, mustChangePassword: false, sessionId: "test-session" };
}
