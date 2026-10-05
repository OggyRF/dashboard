import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { forbidden, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { activeOwnerIds, notify } from "@/services/notifications";

// Private conversations between a team member and the owners. Both owners see
// every thread; a member sees only the threads they started.

export const newThreadSchema = z.object({
  subject: z.string().trim().min(2, "Add a subject.").max(120),
  body: z.string().trim().min(1, "Write a message.").max(5000),
});
export const replySchema = z.object({ body: z.string().trim().min(1, "Write a message.").max(5000) });

function isOwnerView(user: SessionUser) {
  return can(user.role, "messages.ownerInbox");
}

export async function startThread(user: SessionUser, input: unknown) {
  if (!can(user.role, "messages.sendToOwners")) throw forbidden();
  const data = newThreadSchema.parse(input);
  return db.$transaction(async (tx) => {
    const thread = await tx.messageThread.create({
      data: { fromUserId: user.id, subject: data.subject, messages: { create: { authorId: user.id, body: data.body } } },
    });
    await tx.messageRead.create({ data: { threadId: thread.id, userId: user.id, lastReadAt: new Date() } });
    const owners = (await activeOwnerIds(tx)).filter((id) => id !== user.id);
    await notify(tx, owners, `New message from ${user.name}: ${data.subject}`, `/messages/${thread.id}`);
    return thread;
  });
}

async function threadForUser(user: SessionUser, threadId: string) {
  const thread = await db.messageThread.findUnique({ where: { id: threadId }, include: { fromUser: { select: { id: true, name: true } } } });
  if (!thread) throw notFound("Conversation");
  if (thread.fromUserId !== user.id && !isOwnerView(user)) throw notFound("Conversation");
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
    const recipients =
      user.id === thread.fromUserId
        ? (await activeOwnerIds(tx)).filter((id) => id !== user.id)
        : [thread.fromUserId];
    await notify(tx, recipients, `${user.name} replied: ${thread.subject}`, `/messages/${threadId}`);
  });
}

export async function getThread(user: SessionUser, threadId: string) {
  const thread = await threadForUser(user, threadId);
  const messages = await db.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  await db.messageRead.upsert({
    where: { threadId_userId: { threadId, userId: user.id } },
    create: { threadId, userId: user.id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  return { thread, messages };
}

export async function listThreads(user: SessionUser) {
  if (!can(user.role, "messages.sendToOwners")) throw forbidden();
  const threads = await db.messageThread.findMany({
    where: isOwnerView(user) ? {} : { fromUserId: user.id },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      fromUser: { select: { name: true } },
      reads: { where: { userId: user.id } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, authorId: true } },
    },
  });
  return threads.map((t) => {
    const lastReadAt = t.reads[0]?.lastReadAt;
    const last = t.messages[0];
    return {
      id: t.id,
      subject: t.subject,
      fromName: t.fromUser.name,
      lastMessageAt: t.lastMessageAt,
      preview: last?.body.slice(0, 140) ?? "",
      unread: !!last && last.authorId !== user.id && (!lastReadAt || lastReadAt < t.lastMessageAt),
    };
  });
}

export async function unreadThreadCount(user: SessionUser) {
  if (!can(user.role, "messages.sendToOwners")) return 0;
  return (await listThreads(user)).filter((t) => t.unread).length;
}
