import "dotenv/config";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { istDateKey, istDateTime } from "@/lib/dates";
import { recordEvent } from "@/services/attendance";
import { applyForLeave } from "@/services/leave";
import { startThread } from "@/services/messages";
import { postMessage } from "@/services/chat";
import { createClient, setAssignments } from "@/services/clients";
import { addActivity, clientMonth, currentMonth, tickItem } from "@/services/offpage";
import { changeTaskStatus, createTask } from "@/services/tasks";
import { addDailyTask, completeUnit, ensureDailyPlan, startUnit } from "@/services/daily";
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
      await recordEvent(get(name), type as "LOGIN", "203.0.113.10", when, undefined, "Off-page uploads for IITB WashU and Cafe Bloom listings").catch(() => {});
    }
  }

  await applyForLeave(get("Fareen"), { fromDate: nextWorkday(2), toDate: nextWorkday(3), halfDay: false, type: "CASUAL", reason: "family function out of town" }, null).catch(() => {});
  await applyForLeave(get("Muzammil"), { fromDate: nextWorkday(1), toDate: nextWorkday(1), halfDay: true, type: "SICK", reason: "doctor appointment in the morning" }, null).catch(() => {});
  await startThread(get("Huzaif"), { to: [get("Aarif").id, get("Salman").id], subject: "Laptop running very slow", body: "My laptop has been very slow since yesterday. It takes a long time to open sheets. Can it be checked?" }).catch(() => {});

  if ((await db.client.count()) === 0) await seedClients(get);

  console.log(`Seeded ${TEAM.length} people. Password for everyone: ${PASSWORD}`);
  await db.$disconnect();
}

// A few clients with teams, an off-page plan, tasks and chat (Phase 2).
async function seedClients(get: (name: string) => SessionUser) {
  const aarif = get("Aarif");
  const iitb = await createClient(aarif, { name: "IITB WashU", website: "iitbwashu.org", type: "SEO", industry: "Education", location: "Mumbai", strategicOwnerId: get("Sameer").id, executionOwnerId: get("Saad").id, offpageOwnerId: get("Huzaif").id, goals: "More admission enquiries from organic search." }, null);
  const cafe = await createClient(aarif, { name: "Cafe Bloom", website: "cafebloom.in", type: "GMB", location: "Pune", strategicOwnerId: get("Afraz").id, executionOwnerId: get("Sohail").id }, null);
  await createClient(aarif, { name: "Sharma Dental", website: "sharmadental.com", type: "BOTH", status: "ONBOARDING", strategicOwnerId: get("Sameer").id, executionOwnerId: get("Saad").id }, null);
  await setAssignments(aarif, iitb.id, [{ userId: get("Itesh").id, responsibility: "OFFPAGE" }, { userId: get("Sohail").id, responsibility: "EXECUTION" }], null);
  for (const [name, qty] of [["Guest Posting", 10], ["Web 2.0", 10], ["Image Submission", 20], ["Social Bookmarking", 20], ["Quora Answers", 20], ["Reddit Post", 5]] as const) {
    await addActivity(aarif, iitb.id, { name, monthlyQty: qty, assigneeId: get("Huzaif").id, reviewerId: get("Saad").id, applyNow: true }, null);
  }
  await addActivity(aarif, cafe.id, { name: "Business Listing", monthlyQty: 8, assigneeId: get("Fareen").id, applyNow: true }, null);
  const view = await clientMonth(aarif, iitb.id, currentMonth());
  for (const item of view.rows.flatMap((r) => r.weeks[0]!.slice(0, 2))) await tickItem(get("Huzaif"), item.id, "https://example.com/proof", null);

  const t1 = await createTask(get("Sameer"), { clientId: iitb.id, title: "Fix canonical tags on blog pages", category: "TECHNICAL", priority: "HIGH", assigneeId: get("Saad").id, followUpId: get("Sohail").id, dueDate: istDateKey(new Date(Date.now() + 2 * 86400_000)) }, null);
  await changeTaskStatus(get("Saad"), t1.number, "progress", "", null);
  await createTask(get("Sameer"), { clientId: iitb.id, title: "Write admissions FAQ page", category: "CONTENT", assigneeId: get("Sohail").id, dueDate: istDateKey(new Date(Date.now() - 86400_000)) }, null);
  await createTask(get("Afraz"), { clientId: cafe.id, title: "Reply to new Google reviews", category: "GMB", assigneeId: get("Sohail").id }, null);

  const channel = await db.channel.findUniqueOrThrow({ where: { clientId: iitb.id } });
  await postMessage(get("Sameer"), channel.id, "Focus this week: admissions pages. @Saad please take #1 first.");
  await postMessage(get("Huzaif"), channel.id, "Posted the first two guest posts, links are in the off-page tab.");
  await postMessage(aarif, "general", "Welcome to the new team chat! Each client has its own channel too.");

  // Today's list for Huzaif: the automatic share of the off-page plan, with
  // one piece being worked on and one done, plus extra work from the leads.
  const today = istDateKey(new Date());
  await ensureDailyPlan(get("Huzaif").id);
  const auto = await db.dailyTask.findMany({ where: { assigneeId: get("Huzaif").id, auto: true }, orderBy: [{ work: "asc" }, { createdAt: "asc" }] });
  if (auto[0]) {
    await completeUnit(get("Huzaif"), auto[0].id, 1, auto[0].work === "UPLOADING" ? "https://example.com/live-post" : "", null);
    if (auto[0].qty > 1) await startUnit(get("Huzaif"), auto[0].id, 2, null);
  }
  await addDailyTask(get("Sohail"), { date: today, assigneeId: get("Huzaif").id, clientId: iitb.id, work: "OTHER", qty: 1, details: "SERP update" }, null);
  await addDailyTask(aarif, { date: today, assigneeId: get("Huzaif").id, clientId: cafe.id, work: "OTHER", qty: 2, details: "Reply to GMB reviews" }, null);
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
