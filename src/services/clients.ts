import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ClientStatus, ClientType, Responsibility } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { dateFromKey, istDateKey, isValidKey, keyFromDbDate } from "@/lib/dates";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";

type Tx = Prisma.TransactionClient;

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = { SEO: "SEO", GMB: "GMB", BOTH: "SEO + GMB" };
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  PAUSED: "Paused",
  CHURNED: "Churned",
};
import { RESPONSIBILITY_LABELS } from "@/lib/client-labels";
export { RESPONSIBILITY_LABELS };

// ---------------------------------------------------------------------------
// Who can see a client
// ---------------------------------------------------------------------------

// "full": the whole workspace. "offpage": only the Off-page and Chat tabs
// (off-page staff on their assigned clients).
export type ClientAccess = "full" | "offpage";

export async function accessTo(user: SessionUser, clientId: string, tx: Tx = db): Promise<ClientAccess | null> {
  if (can(user.role, "clients.viewAll")) return "full";
  const rows = await tx.clientAssignment.findMany({ where: { clientId, userId: user.id }, select: { responsibility: true } });
  if (!rows.length) return null;
  return can(user.role, "clients.viewAssigned") ? "full" : "offpage";
}

// Loads a client the user may see at the needed level; anything else looks
// like a missing client.
export async function requireClient(user: SessionUser, clientId: string, need: ClientAccess = "full", tx: Tx = db) {
  const client = await tx.client.findUnique({ where: { id: clientId } });
  const access = client ? await accessTo(user, clientId, tx) : null;
  if (!client || !access || (need === "full" && access !== "full")) throw notFound("Client");
  return { client, access };
}

export function visibleClients(user: SessionUser): Prisma.ClientWhereInput {
  return can(user.role, "clients.viewAll") ? {} : { assignments: { some: { userId: user.id } } };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function logActivity(tx: Tx, clientId: string, actorId: string | null, type: string, summary: string, link?: string) {
  return tx.activityEvent.create({ data: { clientId, actorId, type, summary, link: link ?? null } });
}

export async function listActivity(user: SessionUser, clientId: string, take = 100) {
  await requireClient(user, clientId);
  return db.activityEvent.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { id: true, name: true, avatarUpdatedAt: true } } },
  });
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null);

export const clientSchema = z.object({
  name: z.string().trim().min(2, "Add the client's name.").max(120),
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
      try {
        const url = new URL(withScheme);
        if (!url.hostname.includes(".")) throw new Error();
        return url.toString().replace(/\/$/, "");
      } catch {
        ctx.addIssue({ code: "custom", message: "That website address does not look right." });
        return z.NEVER;
      }
    }),
  type: z.enum(["SEO", "GMB", "BOTH"], { message: "Pick SEO, GMB or both." }),
  status: z.enum(["ONBOARDING", "ACTIVE", "PAUSED", "CHURNED"]).default("ACTIVE"),
  industry: optionalText(120),
  location: optionalText(120),
  startDate: z
    .string()
    .optional()
    .refine((v) => !v || isValidKey(v), "Pick a valid start date.")
    .transform((v) => (v ? dateFromKey(v) : null)),
  goals: optionalText(2000),
  notes: optionalText(2000),
  strategicOwnerId: optionalId,
  executionOwnerId: optionalId,
  offpageOwnerId: optionalId,
});

type Leads = { strategicOwnerId: string | null; executionOwnerId: string | null; offpageOwnerId: string | null };

async function checkOwners(tx: Tx, data: Leads) {
  for (const [id, roles, label] of [
    [data.strategicOwnerId, ["OWNER", "STRATEGY"], "SEO Strategist"],
    [data.executionOwnerId, ["OWNER", "STRATEGY", "EXECUTION"], "SEO Project Manager"],
    [data.offpageOwnerId, ["STRATEGY", "EXECUTION", "OFFPAGE"], "Off-Page SEO Specialist"],
  ] as const) {
    if (!id) continue;
    const person = await tx.user.findUnique({ where: { id } });
    if (!person || person.status !== "ACTIVE" || !(roles as readonly string[]).includes(person.role)) {
      throw invalid(`Pick an active team member as the ${label}.`);
    }
  }
}

// The three leads always appear in the client's team.
async function syncOwnerAssignments(tx: Tx, clientId: string, leads: Leads) {
  const rows: { userId: string; responsibility: Responsibility }[] = [];
  if (leads.strategicOwnerId) rows.push({ userId: leads.strategicOwnerId, responsibility: "STRATEGY" });
  if (leads.executionOwnerId) rows.push({ userId: leads.executionOwnerId, responsibility: "EXECUTION" });
  if (leads.offpageOwnerId) rows.push({ userId: leads.offpageOwnerId, responsibility: "OFFPAGE" });
  if (rows.length) await tx.clientAssignment.createMany({ data: rows.map((r) => ({ ...r, clientId })), skipDuplicates: true });
}

export function channelSlug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "client"
  );
}

async function uniqueChannelName(tx: Tx, base: string) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!(await tx.channel.findUnique({ where: { name } }))) return name;
  }
}

export async function createClient(user: SessionUser, input: unknown, ip: string | null, tx?: Tx) {
  if (!can(user.role, "clients.edit")) throw forbidden();
  const data = clientSchema.parse(input);
  const run = async (tx: Tx) => {
    await checkOwners(tx, data);
    const client = await tx.client.create({ data: { ...data, createdById: user.id } });
    await syncOwnerAssignments(tx, client.id, data);
    // Execution staff only see assigned clients, so whoever adds one joins it.
    if (!can(user.role, "clients.viewAll")) {
      await tx.clientAssignment.createMany({ data: [{ clientId: client.id, userId: user.id, responsibility: "EXECUTION" }], skipDuplicates: true });
    }
    await tx.channel.create({
      data: { name: await uniqueChannelName(tx, channelSlug(client.name)), kind: "CLIENT", clientId: client.id, archived: client.status === "CHURNED" },
    });
    await logActivity(tx, client.id, user.id, "client.created", `${user.name} added ${client.name}`);
    await writeAudit(tx, { actorId: user.id, action: "client.create", entityType: "Client", entityId: client.id, after: clientAudit(client), ip });
    return client;
  };
  return tx ? run(tx) : db.$transaction(run);
}

export async function updateClient(user: SessionUser, clientId: string, input: unknown, ip: string | null) {
  if (!can(user.role, "clients.edit")) throw forbidden();
  const { client: before } = await requireClient(user, clientId);
  const data = clientSchema.parse(input);
  return db.$transaction(async (tx) => {
    await checkOwners(tx, data);
    const client = await tx.client.update({ where: { id: clientId }, data });
    await syncOwnerAssignments(tx, clientId, data);
    await tx.channel.updateMany({ where: { clientId }, data: { archived: client.status === "CHURNED" } });
    const changes = describeChanges(before, client);
    if (changes) await logActivity(tx, clientId, user.id, "client.updated", `${user.name} changed ${changes}`);
    await writeAudit(tx, { actorId: user.id, action: "client.update", entityType: "Client", entityId: clientId, before: clientAudit(before), after: clientAudit(client), ip });
    return client;
  });
}

function describeChanges(a: Prisma.ClientGetPayload<object>, b: Prisma.ClientGetPayload<object>) {
  const labels: [keyof typeof a, string][] = [
    ["name", "the name"],
    ["website", "the website"],
    ["type", "the type"],
    ["status", "the status"],
    ["industry", "the industry"],
    ["location", "the location"],
    ["goals", "the goals"],
    ["notes", "the notes"],
    ["strategicOwnerId", "the SEO Strategist"],
    ["executionOwnerId", "the SEO Project Manager"],
    ["offpageOwnerId", "the Off-Page SEO Specialist"],
  ];
  const changed = labels.filter(([k]) => String(a[k] ?? "") !== String(b[k] ?? "")).map(([, l]) => l);
  if (a.status !== b.status) changed[changed.indexOf("the status")] = `the status to ${CLIENT_STATUS_LABELS[b.status]}`;
  return changed.length ? changed.join(", ") : null;
}

function clientAudit(c: Prisma.ClientGetPayload<object>) {
  return {
    name: c.name,
    website: c.website,
    type: c.type,
    status: c.status,
    strategicOwnerId: c.strategicOwnerId,
    executionOwnerId: c.executionOwnerId,
    offpageOwnerId: c.offpageOwnerId,
    startDate: c.startDate ? keyFromDbDate(c.startDate) : null,
  };
}

export const assignmentsSchema = z.array(
  z.object({ userId: z.string().min(1), responsibility: z.enum(["STRATEGY", "EXECUTION", "OFFPAGE", "QA"]) }),
).max(60);

// Replaces the client's team. The three leads stay on it.
export async function setAssignments(user: SessionUser, clientId: string, input: unknown, ip: string | null) {
  if (!can(user.role, "clients.edit")) throw forbidden();
  const { client } = await requireClient(user, clientId);
  const rows = assignmentsSchema.parse(input);
  const people = await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) }, status: "ACTIVE" } });
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const r of rows) {
    const p = byId.get(r.userId);
    if (!p) throw invalid("Pick active team members only.");
    if (p.role === "OFFPAGE" && r.responsibility !== "OFFPAGE") throw invalid(`${p.name} is off-page staff and can only be added as an Off-Page SEO Specialist.`);
  }
  return db.$transaction(async (tx) => {
    const before = await tx.clientAssignment.findMany({ where: { clientId } });
    await tx.clientAssignment.deleteMany({ where: { clientId } });
    await tx.clientAssignment.createMany({ data: rows.map((r) => ({ ...r, clientId })), skipDuplicates: true });
    await syncOwnerAssignments(tx, clientId, client);
    const after = await tx.clientAssignment.findMany({ where: { clientId }, include: { user: { select: { name: true } } } });
    const key = (r: { userId: string; responsibility: string }) => `${r.userId}:${r.responsibility}`;
    const old = new Set(before.map(key));
    const added = after.filter((r) => !old.has(key(r)));
    const kept = new Set(after.map(key));
    const removed = before.filter((r) => !kept.has(key(r)));
    if (added.length || removed.length) {
      const names = await tx.user.findMany({ where: { id: { in: removed.map((r) => r.userId) } }, select: { id: true, name: true } });
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      const parts = [
        ...added.map((r) => `added ${r.user.name} (${RESPONSIBILITY_LABELS[r.responsibility]})`),
        ...removed.map((r) => `removed ${nameOf.get(r.userId) ?? "someone"} (${RESPONSIBILITY_LABELS[r.responsibility]})`),
      ];
      await logActivity(tx, clientId, user.id, "client.team", `${user.name} ${parts.join(", ")}`);
    }
    await writeAudit(tx, { actorId: user.id, action: "client.assignments", entityType: "Client", entityId: clientId, before: before.map(key), after: after.map(key), ip });
  });
}

// Adds someone to a client's team if they are not on it yet (e.g. when they
// are given a task or an off-page activity there).
export async function ensureAssigned(tx: Tx, clientId: string, userId: string, responsibility: Responsibility) {
  await tx.clientAssignment.createMany({ data: [{ clientId, userId, responsibility }], skipDuplicates: true });
}

const personSelect = { id: true, name: true, role: true, avatarUpdatedAt: true } as const;

export async function getClient(user: SessionUser, clientId: string) {
  const { access } = await requireClient(user, clientId, "offpage");
  const client = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      strategicOwner: { select: personSelect },
      executionOwner: { select: personSelect },
      offpageOwner: { select: personSelect },
      assignments: { include: { user: { select: { ...personSelect, status: true } } }, orderBy: { createdAt: "asc" } },
      channel: { select: { id: true, name: true } },
    },
  });
  return { client, access };
}

export const clientFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(["SEO", "GMB", "BOTH"]).optional().catch(undefined),
  status: z.enum(["ONBOARDING", "ACTIVE", "PAUSED", "CHURNED", "ALL"]).optional().catch(undefined),
});

export async function listClients(user: SessionUser, filters: z.input<typeof clientFilterSchema> = {}, now = new Date()) {
  if (!can(user.role, "clients.viewAssigned")) throw forbidden();
  const f = clientFilterSchema.parse(filters);
  const where: Prisma.ClientWhereInput = {
    AND: [
      visibleClients(user),
      f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { website: { contains: f.q, mode: "insensitive" } }] } : {},
      // SEO matches SEO and BOTH, and the same for GMB.
      f.type === "SEO" ? { type: { in: ["SEO", "BOTH"] } } : f.type === "GMB" ? { type: { in: ["GMB", "BOTH"] } } : f.type ? { type: f.type } : {},
      f.status === "ALL" ? {} : f.status ? { status: f.status } : { status: { not: "CHURNED" } },
    ],
  };
  const clients = await db.client.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      strategicOwner: { select: personSelect },
      executionOwner: { select: personSelect },
      offpageOwner: { select: personSelect },
      _count: { select: { assignments: true } },
    },
  });
  const ids = clients.map((c) => c.id);
  const today = dateFromKey(istDateKey(now));
  const [open, overdue] = await Promise.all([
    db.task.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: { not: "COMPLETED" } }, _count: true }),
    db.task.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: { not: "COMPLETED" }, dueDate: { lt: today } }, _count: true }),
  ]);
  const openBy = new Map(open.map((o) => [o.clientId, o._count]));
  const overdueBy = new Map(overdue.map((o) => [o.clientId, o._count]));
  return clients.map((c) => ({ ...c, openTasks: openBy.get(c.id) ?? 0, overdueTasks: overdueBy.get(c.id) ?? 0 }));
}

// People who can be picked for client roles, tasks and off-page work.
export function listTeam() {
  return db.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: personSelect });
}

// Bulk add: one client per line, "Name, website, type". Website and type are
// optional (type defaults to SEO). Lines that fail are reported, not added.
export async function importClients(user: SessionUser, text: string, ip: string | null) {
  if (!can(user.role, "clients.edit")) throw forbidden();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw invalid("Paste at least one client, one per line.");
  if (lines.length > 200) throw invalid("Add at most 200 clients at a time.");
  const existing = new Set((await db.client.findMany({ select: { name: true } })).map((c) => c.name.toLowerCase()));
  const added: string[] = [];
  const problems: string[] = [];
  for (const [i, line] of lines.entries()) {
    const [name = "", website = "", rawType = ""] = line.split(/\t|,/).map((p) => p.trim());
    const t = rawType.toUpperCase().replace(/[^A-Z+]/g, "");
    const type = !t ? "SEO" : t === "SEO" ? "SEO" : t === "GMB" || t === "GBP" ? "GMB" : t === "BOTH" || t === "SEO+GMB" || t === "GMB+SEO" ? "BOTH" : null;
    if (!type) {
      problems.push(`Line ${i + 1} (${name || line}): type should be SEO, GMB or BOTH.`);
      continue;
    }
    if (existing.has(name.toLowerCase())) {
      problems.push(`Line ${i + 1}: ${name} is already in the list.`);
      continue;
    }
    const parsed = clientSchema.safeParse({ name, website, type });
    if (!parsed.success) {
      problems.push(`Line ${i + 1} (${name || line}): ${parsed.error.issues[0]?.message}`);
      continue;
    }
    await createClient(user, { name, website, type }, ip);
    existing.add(name.toLowerCase());
    added.push(name);
  }
  return { added, problems };
}
