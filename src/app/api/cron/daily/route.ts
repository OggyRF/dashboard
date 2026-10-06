import { timingSafeEqual } from "node:crypto";
import { addDays, istDateKey, istDateTime } from "@/lib/dates";
import { closeOpenDays } from "@/services/attendance";
import { deleteExpiredSessions } from "@/services/auth";
import { ensureAllDailyPlans } from "@/services/daily";
import { ensureAllMonths } from "@/services/offpage";
import { notifyOverdueTasks } from "@/services/tasks";

// Nightly housekeeping for hosts without the background worker (Vercel Cron
// calls this once a day, shortly after midnight India time, sending
// "Authorization: Bearer <CRON_SECRET>"). Yesterday's open days are closed as
// of 23:59 that day, exactly as the worker would have done at the time.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const yesterday = addDays(istDateKey(new Date()), -1);
  const closed = await closeOpenDays(istDateTime(yesterday, "23:59"));
  const sessionsRemoved = await deleteExpiredSessions();
  // On the 1st this creates every client's off-page checklist for the new month.
  await ensureAllMonths();
  // Tasks that went past their due date yesterday alert their client's team.
  const overdue = await notifyOverdueTasks();
  // Today's automatic daily list for everyone with off-page work.
  const dailyPlans = await ensureAllDailyPlans();
  return Response.json({ closed, sessionsRemoved, overdue, dailyPlans });
}

function matches(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
