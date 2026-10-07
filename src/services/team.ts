import { db } from "@/lib/db";
import type { AttendanceState } from "@/lib/attendance/compute";
import { can } from "@/lib/auth/permissions";
import { RESPONSIBILITY_LABELS } from "@/lib/client-labels";
import { dateFromKey, istDateKey, isValidKey, keyFromDbDate } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { teamToday } from "@/services/attendance";
import { ensureAllDailyPlans } from "@/services/daily";
import { currentMonth } from "@/services/offpage";

// The team at a glance (Aarif, 7 Oct 2026). Owners, strategists and project
// managers see everyone's day as a short list of names; each person opens
// into a full profile. A person belongs to the team of each project manager
// whose clients they work on ("Saad's team"); strategists and managers also
// get a card for everything they oversee.

const personSelect = { id: true, name: true, role: true, avatarUpdatedAt: true } as const;
type Person = { id: string; name: string; role: string; avatarUpdatedAt: Date | null };

export type Progress = { done: number; planned: number };
export type PersonCard = Person & {
  today: Progress & { working: number };
  attendance: { state: AttendanceState; workedMinutes: number; onLeave: boolean } | null;
  openTasks: number;
  overdueTasks: number;
  // First names of the managers whose team they are in.
  teams: { id: string; name: string }[];
};

type ClientLinks = { id: string; name: string; executionOwnerId: string | null; strategicOwnerId: string | null; offpageOwnerId: string | null; assignments: { userId: string }[] };

// Each person's managers (the project managers of the clients they work on)
// and each lead's people and clients.
function teamsFrom(clients: ClientLinks[], people: Map<string, Person>) {
  const managersOf = new Map<string, Set<string>>();
  const led = new Map<string, { clients: ClientLinks[]; members: Set<string>; asManager: boolean; asStrategist: boolean }>();
  for (const c of clients) {
    const onClient = new Set([...c.assignments.map((a) => a.userId), c.offpageOwnerId].filter((id): id is string => !!id && people.has(id)));
    for (const [leadId, kind] of [
      [c.executionOwnerId, "manager"],
      [c.strategicOwnerId, "strategist"],
    ] as const) {
      if (!leadId || !people.has(leadId)) continue;
      const entry = led.get(leadId) ?? { clients: [], members: new Set<string>(), asManager: false, asStrategist: false };
      if (!entry.clients.includes(c)) entry.clients.push(c);
      if (kind === "manager") entry.asManager = true;
      else entry.asStrategist = true;
      for (const id of onClient) if (id !== leadId && !(kind === "manager" && id === c.strategicOwnerId)) entry.members.add(id);
      led.set(leadId, entry);
    }
    if (c.executionOwnerId && people.has(c.executionOwnerId)) {
      for (const id of onClient) {
        // The client's strategist sits above its manager, not in their team.
        if (id === c.executionOwnerId || id === c.strategicOwnerId) continue;
        managersOf.set(id, (managersOf.get(id) ?? new Set()).add(c.executionOwnerId));
      }
    }
  }
  return { managersOf, led };
}

async function loadTeam() {
  const [people, clients] = await Promise.all([
    db.user.findMany({ where: { status: "ACTIVE", role: { not: "OWNER" } }, orderBy: { name: "asc" }, select: personSelect }),
    db.client.findMany({
      where: { status: { not: "CHURNED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, executionOwnerId: true, strategicOwnerId: true, offpageOwnerId: true, assignments: { select: { userId: true } } },
    }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  return { people, byId, clients, ...teamsFrom(clients, byId) };
}

async function dayProgress(date: string, userIds: string[]) {
  const lines = await db.dailyTask.findMany({
    where: { date: dateFromKey(date), assigneeId: { in: userIds } },
    select: { assigneeId: true, qty: true, ticks: { select: { doneAt: true } } },
  });
  const out = new Map<string, Progress & { working: number }>();
  for (const l of lines) {
    const p = out.get(l.assigneeId) ?? { done: 0, planned: 0, working: 0 };
    p.planned += l.qty;
    p.done += l.ticks.filter((k) => k.doneAt).length;
    p.working += l.ticks.filter((k) => !k.doneAt).length;
    out.set(l.assigneeId, p);
  }
  return out;
}

async function taskCountsByPerson(userIds: string[], now: Date) {
  const today = dateFromKey(istDateKey(now));
  const [open, overdue] = await Promise.all([
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: userIds }, status: { not: "COMPLETED" } }, _count: { _all: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: userIds }, status: { not: "COMPLETED" }, dueDate: { lt: today } }, _count: { _all: true } }),
  ]);
  return {
    open: new Map(open.map((r) => [r.assigneeId!, r._count._all])),
    overdue: new Map(overdue.map((r) => [r.assigneeId!, r._count._all])),
  };
}

const sum = (cards: PersonCard[]): Progress => ({ done: cards.reduce((s, c) => s + c.today.done, 0), planned: cards.reduce((s, c) => s + c.today.planned, 0) });

// Everyone's day as cards, grouped into each project manager's team.
export async function teamBoard(actor: SessionUser, date: string, now = new Date()) {
  if (!can(actor.role, "team.overview")) throw forbidden();
  if (!isValidKey(date)) throw invalid("Pick a valid day.");
  const isToday = date === istDateKey(now);
  if (isToday) await ensureAllDailyPlans(now);
  const team = await loadTeam();
  const ids = team.people.map((p) => p.id);
  const [progress, tasks, attendance] = await Promise.all([dayProgress(date, ids), taskCountsByPerson(ids, now), isToday ? teamToday(actor, now) : Promise.resolve([])]);
  const present = new Map(attendance.map((a) => [a.userId, a]));

  const cards = new Map<string, PersonCard>(
    team.people.map((p) => {
      const a = present.get(p.id);
      return [
        p.id,
        {
          ...p,
          today: progress.get(p.id) ?? { done: 0, planned: 0, working: 0 },
          attendance: a ? { state: a.summary.state, workedMinutes: a.summary.workedMinutes, onLeave: a.onLeave } : null,
          openTasks: tasks.open.get(p.id) ?? 0,
          overdueTasks: tasks.overdue.get(p.id) ?? 0,
          teams: [...(team.managersOf.get(p.id) ?? [])].map((id) => ({ id, name: team.byId.get(id)!.name })).sort((x, y) => x.name.localeCompare(y.name)),
        },
      ];
    }),
  );

  // Strategists and managers with what they oversee.
  const leads = [...team.led.entries()]
    .map(([id, l]) => {
      const members = [...l.members].map((m) => cards.get(m)!).filter(Boolean);
      return {
        person: cards.get(id)!,
        label: l.asManager && l.asStrategist ? "Strategist & manager" : l.asManager ? "Project manager" : "Strategist",
        clients: l.clients.length,
        people: members.length,
        team: sum(members),
        mine: id === actor.id,
      };
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine) || (a.person.role === b.person.role ? a.person.name.localeCompare(b.person.name) : a.person.role === "STRATEGY" ? -1 : 1));

  // One section per project manager; the viewer's own team first.
  const teams = [...team.led.entries()]
    .filter(([, l]) => l.asManager)
    .map(([id]) => {
      // Other leads have their own card above, so teams list the people doing the work.
      const members = team.people.filter((p) => !team.led.has(p.id) && team.managersOf.get(p.id)?.has(id)).map((p) => cards.get(p.id)!);
      return { lead: cards.get(id)!, members, total: sum(members), mine: id === actor.id };
    })
    .filter((t) => t.members.length)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.lead.name.localeCompare(b.lead.name));
  const leadIds = new Set(team.led.keys());
  const others = team.people.filter((p) => !team.managersOf.get(p.id)?.size && !leadIds.has(p.id)).map((p) => cards.get(p.id)!);

  return { date, isToday, leads, teams, others, everyone: sum([...cards.values()]) };
}

// Everything about one person: who they work for, their clients, their
// off-page month, and (for leads) what they oversee.
export async function personProfile(actor: SessionUser, personId: string, now = new Date()) {
  if (actor.id !== personId && !can(actor.role, "team.overview")) throw forbidden();
  const person = await db.user.findUnique({ where: { id: personId }, select: { ...personSelect, email: true, status: true, createdAt: true } });
  if (!person || person.status === "DELETED") throw notFound("Team member");
  const month = currentMonth(now);
  const todayKey = istDateKey(now);
  const team = await loadTeam();
  const lead = team.led.get(personId);

  const [assignments, boxes, leave, ledBoxes] = await Promise.all([
    db.clientAssignment.findMany({
      where: { userId: personId, client: { status: { not: "CHURNED" } } },
      select: { responsibility: true, client: { select: { id: true, name: true, type: true, status: true } } },
      orderBy: { client: { name: "asc" } },
    }),
    db.offpageItem.findMany({
      where: { month, OR: [{ assigneeId: personId }, { assigneeId: null, client: { offpageOwnerId: personId } }] },
      select: { clientId: true, doneAt: true, week: true, client: { select: { name: true } }, activity: { select: { name: true } } },
    }),
    db.leaveRequest.findMany({
      where: { userId: personId, status: { in: ["PENDING", "APPROVED"] }, toDate: { gte: dateFromKey(todayKey) } },
      orderBy: { fromDate: "asc" },
      take: 5,
      select: { id: true, fromDate: true, toDate: true, halfDay: true, status: true, type: true },
    }),
    lead ? db.offpageItem.groupBy({ by: ["clientId"], where: { month, clientId: { in: lead.clients.map((c) => c.id) } }, _count: { _all: true, doneAt: true } }) : Promise.resolve([]),
  ]);

  // Clients they work on, with their responsibilities there.
  const clientMap = new Map<string, { client: (typeof assignments)[number]["client"]; roles: string[] }>();
  for (const a of assignments) {
    const e = clientMap.get(a.client.id) ?? { client: a.client, roles: [] };
    e.roles.push(RESPONSIBILITY_LABELS[a.responsibility]);
    clientMap.set(a.client.id, e);
  }

  // Their off-page boxes this month, one row per client and activity.
  const offpage = new Map<string, { client: { id: string; name: string }; activities: Map<string, Progress>; total: Progress }>();
  for (const b of boxes) {
    const g = offpage.get(b.clientId) ?? { client: { id: b.clientId, name: b.client.name }, activities: new Map(), total: { done: 0, planned: 0 } };
    const a = g.activities.get(b.activity.name) ?? { done: 0, planned: 0 };
    a.planned++;
    g.total.planned++;
    if (b.doneAt) {
      a.done++;
      g.total.done++;
    }
    g.activities.set(b.activity.name, a);
    offpage.set(b.clientId, g);
  }

  const counts = new Map(ledBoxes.map((r) => [r.clientId, { done: r._count.doneAt, planned: r._count._all }]));
  return {
    person,
    month,
    teams: [...(team.managersOf.get(personId) ?? [])].map((id) => team.byId.get(id)!).sort((a, b) => a.name.localeCompare(b.name)),
    clients: [...clientMap.values()],
    offpage: [...offpage.values()]
      .map((g) => ({ ...g, activities: [...g.activities.entries()].map(([name, p]) => ({ name, ...p })) }))
      .sort((a, b) => a.client.name.localeCompare(b.client.name)),
    offpageTotal: { done: boxes.filter((b) => b.doneAt).length, planned: boxes.length },
    leave: leave.map((l) => ({ ...l, from: keyFromDbDate(l.fromDate), to: keyFromDbDate(l.toDate) })),
    leads: lead
      ? {
          label: lead.asManager && lead.asStrategist ? "Strategist & manager" : lead.asManager ? "Project manager" : "Strategist",
          clients: lead.clients.map((c) => ({ id: c.id, name: c.name, manager: c.executionOwnerId === personId, offpage: counts.get(c.id) ?? { done: 0, planned: 0 } })),
          members: [...lead.members].map((id) => team.byId.get(id)!).sort((a, b) => a.name.localeCompare(b.name)),
        }
      : null,
  };
}
