import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/services/auth";

export async function resetDatabase() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_logs", "login_attempts", "sessions", "notifications",
      "message_reads", "message_participants", "messages", "message_threads", "user_avatars", "leave_requests", "holidays",
      "attendance_corrections", "attendance_events", "attendance_days",
      "daily_plan_runs", "daily_task_ticks", "daily_tasks", "offpage_month_qtys", "chat_attachments",
      "chat_reactions", "chat_messages", "channel_reads", "channels", "task_comments", "tasks",
      "offpage_items", "offpage_months", "offpage_activities", "activity_events", "client_assignments", "clients", "users"
     RESTART IDENTITY CASCADE`,
  );
  await db.channel.create({ data: { id: "general", name: "general", kind: "TEAM" } });
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
