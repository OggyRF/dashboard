import "dotenv/config";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { istDateKey, istDateTime } from "@/lib/dates";
import { recordEvent } from "@/services/attendance";
import { applyForLeave } from "@/services/leave";
import { startThread } from "@/services/messages";
import type { SessionUser } from "@/services/auth";

// Fills a development database with the real team and a day of activity so the
// screens can be looked at. Never run against production.
const PASSWORD = "demo passphrase 1";

const TEAM: { name: string; email: string; role: SessionUser["role"] }[] = [
  { name: "Aarif", email: "aarif@hidigital.co.in", role: "OWNER" },
  { name: "Salman", email: "salman@hidigital.co.in", role: "OWNER" },
  { name: "Sameer", email: "sameer@example.com", role: "STRATEGY" },
  { name: "Afraz", email: "afraz@example.com", role: "STRATEGY" },
  { name: "Saad", email: "saad@example.com", role: "EXECUTION" },
  { name: "Sohail", email: "sohail@example.com", role: "EXECUTION" },
  { name: "Itesh", email: "itesh@example.com", role: "OFFPAGE" },
  { name: "Huzaif", email: "huzaif@example.com", role: "OFFPAGE" },
  { name: "Muzammil", email: "muzammil@example.com", role: "OFFPAGE" },
  { name: "Fareen", email: "fareen@example.com", role: "OFFPAGE" },
];

async function main() {
  const passwordHash = await hashPassword(PASSWORD);
  const people = new Map<string, SessionUser>();
  for (const member of TEAM) {
    const user = await db.user.upsert({
      where: { email: member.email },
      create: { ...member, passwordHash, mustChangePassword: false },
      update: { role: member.role, passwordHash, mustChangePassword: false, status: "ACTIVE" },
    });
    people.set(member.name, { ...user, sessionId: "seed" });
  }
  const get = (name: string) => people.get(name)!;
  const today = istDateKey(new Date());
  const at = (hhmm: string) => istDateTime(today, hhmm);

  for (const [name, events] of [
    ["Saad", [["LOGIN", "09:28"], ["BREAK_START", "13:05"], ["BREAK_END", "13:48"]]],
    ["Sohail", [["LOGIN", "09:45"], ["BREAK_START", "14:10"]]],
    ["Huzaif", [["LOGIN", "10:02"], ["BREAK_START", "13:30"], ["BREAK_END", "14:05"]]],
    ["Itesh", [["LOGIN", "09:15"], ["LOGOUT", "17:40"]]],
    ["Sameer", [["LOGIN", "09:05"]]],
  ] as [string, [string, string][]][]) {
    for (const [type, time] of events) {
      const when = at(time);
      if (when > new Date()) continue;
      await recordEvent(get(name), type as "LOGIN", "203.0.113.10", when).catch(() => {});
    }
  }

  await applyForLeave(get("Fareen"), { fromDate: nextWorkday(2), toDate: nextWorkday(3), halfDay: false, type: "CASUAL", reason: "family function out of town" }, null).catch(() => {});
  await applyForLeave(get("Muzammil"), { fromDate: nextWorkday(1), toDate: nextWorkday(1), halfDay: true, type: "SICK", reason: "doctor appointment in the morning" }, null).catch(() => {});
  await startThread(get("Huzaif"), { to: [get("Aarif").id, get("Salman").id], subject: "Laptop running very slow", body: "My laptop has been very slow since yesterday. It takes a long time to open sheets. Can it be checked?" }).catch(() => {});

  console.log(`Seeded ${TEAM.length} people. Password for everyone: ${PASSWORD}`);
  await db.$disconnect();
}

function nextWorkday(offset: number) {
  const d = new Date();
  let added = 0;
  while (added < offset) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) added++;
  }
  return istDateKey(d);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
