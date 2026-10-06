import "dotenv/config";
import { PgBoss } from "pg-boss";
import { deleteExpiredSessions } from "@/services/auth";
import { closeOpenDays } from "@/services/attendance";
import { ensureAllMonths } from "@/services/offpage";
import { notifyOverdueTasks } from "@/services/tasks";

// Background worker: runs scheduled jobs (Google syncs, reminders, reports in
// later phases). The web app only enqueues jobs; this process does the work.
const TIME_ZONE = "Asia/Kolkata";

const JOBS = {
  heartbeat: "system.heartbeat",
  sessionCleanup: "system.session-cleanup",
  attendanceClose: "attendance.close-open-days",
  offpageMonth: "offpage.create-month",
} as const;

function log(level: "info" | "error", message: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, service: "worker", message, ...extra }));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const boss = new PgBoss({ connectionString, application_name: "hid-worker" });
  boss.on("error", (error) => log("error", "pg-boss error", { error: String(error) }));
  await boss.start();

  for (const name of Object.values(JOBS)) await boss.createQueue(name);

  await boss.schedule(JOBS.heartbeat, "*/5 * * * *", null, { tz: TIME_ZONE });
  await boss.schedule(JOBS.sessionCleanup, "15 3 * * *", null, { tz: TIME_ZONE });
  // Just before midnight India time: close days nobody logged out of.
  await boss.schedule(JOBS.attendanceClose, "59 23 * * *", null, { tz: TIME_ZONE });
  // Shortly after midnight: make sure every client has this month's off-page checklist.
  await boss.schedule(JOBS.offpageMonth, "5 0 * * *", null, { tz: TIME_ZONE });

  await boss.work(JOBS.heartbeat, async () => {
    log("info", "heartbeat");
  });
  await boss.work(JOBS.sessionCleanup, async () => {
    const removed = await deleteExpiredSessions();
    log("info", "expired sessions removed", { removed });
  });
  await boss.work(JOBS.attendanceClose, async () => {
    const closed = await closeOpenDays();
    log("info", "attendance days closed automatically", { closed });
  });

  await boss.work(JOBS.offpageMonth, async () => {
    await ensureAllMonths();
    await notifyOverdueTasks();
    log("info", "off-page checklists checked");
  });

  log("info", "worker started", { queues: Object.values(JOBS) });

  const shutdown = async (signal: string) => {
    log("info", "worker stopping", { signal });
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  log("error", "worker crashed", { error: String(error) });
  process.exit(1);
});
