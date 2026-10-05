import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { notify } from "@/services/notifications";

// Private conversations with a subject, like email threads. Whoever starts
// one picks who is on it; only the people on a conversation can see it.

export const newThreadSchema = z.object({
  to: z.array(z.string().min(1)).min(1, "Choose who to send it to.").max(20),
  subject: z.string().trim().min(2, "Add a subject.").max(120),
  body: z.string().trim().min(1, "Write a message.").max(5000),
});
export const replySchema = z.object({ body: z.string().trim().min(1, "Write a message.").max(5000) });

const personSelect = { id: true, name: true, role: true, avatarUpdatedAt: true } as const;

// People a conversation can be sent to: everyone active except yourself,
// owners first.
export async function listRecipients(user: SessionUser) {
  if (!can(user.role, "messages.sendToOwners")) throw forbidden();
  const people = await db.user.findMany({
    where: { status: "ACTIVE", id: { not: user.id } },
    orderBy: { name: "asc" },
    select: personSelect,
  });
  return people.sort((a, b) => Number(b.role === "OWNER") - Number(a.role === "OWNER"));
}

export async function startThread(user: SessionUser, input: unknown) {
  if (!can(user.role, "messages.sendToOwners")) throw forbidden();
  const data = newThreadSchema.parse(input);
  const to = [...new Set(data.to)].filter((id) => id !== user.id);
  const valid = await db.user.findMany({ where: { id: { in: to }, status: "ACTIVE" }, select: { id: true } });
  if (valid.length !== to.length || to.length === 0) throw invalid("Choose who to send it to.");

  return db.$transaction(async (tx) => {
    const thread = await tx.messageThread.create({
      data: {
        fromUserId: user.id,
        subject: data.subject,
        messages: { create: { authorId: user.id, body: data.body } },
        participants: { create: [user.id, ...to].map((userId) => ({ userId })) },
      },
    });
    await tx.messageRead.create({ data: { threadId: thread.id, userId: user.id, lastReadAt: new Date() } });
    await notify(tx, to, `New message from ${user.name}: ${data.subject}`, `/messages/${thread.id}`);
    return thread;
  });
}

async function threadForUser(user: SessionUser, threadId: string) {
  const thread = await db.messageThread.findUnique({
    where: { id: threadId },
    include: {
      fromUser: { select: { id: true, name: true } },
      participants: { include: { user: { select: personSelect } } },
    },
  });
  // Someone not on the conversation gets the same answer as for a missing one.
  if (!thread || !thread.participants.some((p) => p.userId === user.id)) throw notFound("Conversation");
  return thread;
}

export async function replyToThread(user: SessionUser, threadId: string, input: unknown) {
  const thread = await threadForUser(user, threadId);
  const data = replySchema.parse(input);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.message.create({ data: { threadId, authorId: user.id, body: data.body, createdAt: now } });
    await tx.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
    await tx.messageRead.upsert({
      where: { threadId_userId: { threadId, userId: user.id } },
      create: { threadId, userId: user.id, lastReadAt: now },
      update: { lastReadAt: now },
    });
    const others = thread.participants.filter((p) => p.userId !== user.id).map((p) => p.userId);
    await notify(tx, others, `${user.name} replied: ${thread.subject}`, `/messages/${threadId}`);
  });
}

export async function getThread(user: SessionUser, threadId: string) {
  const thread = await threadForUser(user, threadId);
  const messages = await db.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: personSelect } },
  });
  await db.messageRead.upsert({
    where: { threadId_userId: { threadId, userId: user.id } },
    create: { threadId, userId: user.id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  return { thread, participants: thread.participants.map((p) => p.user), messages };
}

export type ThreadListItem = Awaited<ReturnType<typeof listThreads>>[number];

export async function listThreads(user: SessionUser) {
  if (!can(user.role, "messages.sendToOwners")) throw forbidden();
  const threads = await db.messageThread.findMany({
    where: { participants: { some: { userId: user.id } } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      participants: { include: { user: { select: personSelect } } },
      reads: { where: { userId: user.id } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, authorId: true, author: { select: { name: true } } } },
    },
  });
  return threads.map((t) => {
    const lastReadAt = t.reads[0]?.lastReadAt;
    const last = t.messages[0];
    const others = t.participants.map((p) => p.user).filter((p) => p.id !== user.id);
    return {
      id: t.id,
      subject: t.subject,
      others,
      lastMessageAt: t.lastMessageAt,
      lastAuthor: last ? (last.authorId === user.id ? "You" : last.author.name.split(" ")[0]) : "",
      preview: last?.body.slice(0, 140) ?? "",
      unread: !!last && last.authorId !== user.id && (!lastReadAt || lastReadAt < t.lastMessageAt),
    };
  });
}

export async function unreadThreadCount(user: SessionUser) {
  if (!can(user.role, "messages.sendToOwners")) return 0;
  return (await listThreads(user)).filter((t) => t.unread).length;
}
