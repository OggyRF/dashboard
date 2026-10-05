import { timingSafeEqual } from "node:crypto";
import { addDays, istDateKey, istDateTime } from "@/lib/dates";
import { closeOpenDays } from "@/services/attendance";
import { deleteExpiredSessions } from "@/services/auth";

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
  return Response.json({ closed, sessionsRemoved });
}

function matches(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
