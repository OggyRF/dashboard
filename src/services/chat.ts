import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { forbidden, invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";
import { notify } from "@/services/notifications";

type Tx = Prisma.TransactionClient;

// Discord-style channels: one per client plus #general for everyone. A client
// channel is open to the client's team; owners and strategy can open them all.

export const EDIT_WINDOW_MINUTES = 15;
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"] as const;
const MESSAGES_SHOWN = 150;

function channelWhere(user: SessionUser): Prisma.ChannelWhereInput {
  if (can(user.role, "clients.viewAll")) return {};
  return { OR: [{ kind: "TEAM" }, { client: { assignments: { some: { userId: user.id } } } }] };
}

async function loadChannel(user: SessionUser, channelId: string) {
  if (!can(user.role, "chat.use")) throw forbidden();
  const channel = await db.channel.findFirst({ where: { AND: [{ id: channelId }, channelWhere(user)] }, include: { client: { select: { id: true, name: true, status: true } } } });
  if (!channel) throw notFound("Channel");
  return channel;
}

// People who can read a channel, for @mentions and notifications.
async function channelPeople(tx: Tx, channel: { kind: string; clientId: string | null }) {
  const where: Prisma.UserWhereInput =
    channel.kind === "TEAM" || !channel.clientId
      ? { status: "ACTIVE" }
      : { status: "ACTIVE", OR: [{ role: { in: ["OWNER", "STRATEGY"] } }, { clientAssignments: { some: { clientId: channel.clientId } } }] };
  return tx.user.findMany({ where, select: { id: true, name: true, role: true, avatarUpdatedAt: true }, orderBy: { name: "asc" } });
}

export async function listChannels(user: SessionUser) {
  if (!can(user.role, "chat.use")) throw forbidden();
  const channels = await db.channel.findMany({
    where: { AND: [channelWhere(user), { archived: false }] },
    include: { client: { select: { id: true, name: true } }, reads: { where: { userId: user.id } } },
  });
  const unread = await Promise.all(
    channels.map((c) =>
      db.chatMessage.count({
        where: { channelId: c.id, deletedAt: null, authorId: { not: user.id }, createdAt: { gt: c.reads[0]?.lastReadAt ?? new Date(0) } },
      }),
    ),
  );
  const last = await db.chatMessage.groupBy({ by: ["channelId"], where: { channelId: { in: channels.map((c) => c.id) } }, _max: { createdAt: true } });
  const lastBy = new Map(last.map((l) => [l.channelId, l._max.createdAt]));
  return channels
    .map((c, i) => ({ id: c.id, name: c.name, kind: c.kind, client: c.client, unread: unread[i]!, lastMessageAt: lastBy.get(c.id) ?? null }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "TEAM" ? -1 : 1) || (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
}

export async function unreadChatCount(user: SessionUser) {
  if (!can(user.role, "chat.use")) return 0;
  return (await listChannels(user)).reduce((s, c) => s + c.unread, 0);
}

const messageInclude = {
  author: { select: { id: true, name: true, avatarUpdatedAt: true } },
  reactions: { select: { emoji: true, userId: true, user: { select: { name: true } } } },
  _count: { select: { replies: { where: { deletedAt: null } } } },
} as const;

type RawMessage = Prisma.ChatMessageGetPayload<{ include: typeof messageInclude }>;

export type ChatMessageView = {
  id: string;
  body: string;
  author: { id: string; name: string; avatarUpdatedAt: Date | null };
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyCount: number;
  lastReplyAt: string | null;
  reactions: { emoji: string; count: number; mine: boolean; names: string[] }[];
  canEdit: boolean;
  canDelete: boolean;
};

function view(user: SessionUser, m: RawMessage, now: Date, lastReplyAt?: Date | null): ChatMessageView {
  const fresh = now.getTime() - m.createdAt.getTime() < EDIT_WINDOW_MINUTES * 60_000;
  const grouped = new Map<string, { count: number; mine: boolean; names: string[] }>();
  for (const r of m.reactions) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false, names: [] };
    g.count++;
    g.mine ||= r.userId === user.id;
    g.names.push(r.user.name);
    grouped.set(r.emoji, g);
  }
  const mine = m.authorId === user.id;
  return {
    id: m.id,
    body: m.deletedAt ? "" : m.body,
    author: m.author,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deleted: !!m.deletedAt,
    replyCount: m._count.replies,
    lastReplyAt: lastReplyAt?.toISOString() ?? null,
    reactions: REACTIONS.filter((e) => grouped.has(e)).map((emoji) => ({ emoji, ...grouped.get(emoji)! })),
    canEdit: !m.deletedAt && mine && fresh,
    canDelete: !m.deletedAt && ((mine && fresh) || user.role === "OWNER"),
  };
}

// Everything the chat screen needs; the browser asks again every few seconds.
export async function channelView(user: SessionUser, channelId: string, threadId?: string | null, now = new Date()) {
  const channel = await loadChannel(user, channelId);
  const recent = await db.chatMessage.findMany({
    where: { channelId, parentId: null },
    orderBy: { createdAt: "desc" },
    take: MESSAGES_SHOWN,
    include: messageInclude,
  });
  recent.reverse();
  const lastReplies = await db.chatMessage.groupBy({ by: ["parentId"], where: { parentId: { in: recent.map((m) => m.id) }, deletedAt: null }, _max: { createdAt: true } });
  const lastReplyBy = new Map(lastReplies.map((r) => [r.parentId, r._max.createdAt]));
  let thread: { parent: ChatMessageView; replies: ChatMessageView[] } | null = null;
  if (threadId) {
    const parent = await db.chatMessage.findFirst({ where: { id: threadId, channelId, parentId: null }, include: messageInclude });
    if (parent) {
      const replies = await db.chatMessage.findMany({ where: { parentId: parent.id }, orderBy: { createdAt: "asc" }, include: messageInclude });
      thread = { parent: view(user, parent, now), replies: replies.map((r) => view(user, r, now)) };
    }
  }
  await db.channelRead.upsert({
    where: { channelId_userId: { channelId, userId: user.id } },
    create: { channelId, userId: user.id, lastReadAt: now },
    update: { lastReadAt: now },
  });
  const people = await channelPeople(db, channel);
  return {
    channel: { id: channel.id, name: channel.name, kind: channel.kind, client: channel.client, archived: channel.archived },
    messages: recent.map((m) => view(user, m, now, lastReplyBy.get(m.id))),
    thread,
    people: people.map((p) => ({ id: p.id, name: p.name, avatarUpdatedAt: p.avatarUpdatedAt })),
    canMakeTask: can(user.role, "tasks.manage") && !!channel.clientId,
  };
}

export type ChannelView = Awaited<ReturnType<typeof channelView>>;

const bodySchema = z.string().trim().min(1, "Write a message.").max(4000, "Keep a message under 4,000 characters.");

// "@Saad" or "@Saad Shaikh" (case-insensitive) mention someone on the channel.
export function findMentions(body: string, people: { id: string; name: string }[]) {
  const text = body.toLowerCase();
  const found = new Set<string>();
  for (const p of people) {
    const full = p.name.toLowerCase();
    const first = full.split(/\s+/)[0]!;
    const pattern = (s: string) => new RegExp(`(^|[^\\w@])@${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i");
    if (pattern(full).test(text) || pattern(full.replace(/\s+/g, "")).test(text) || pattern(first).test(text)) found.add(p.id);
  }
  return [...found];
}

export async function postMessage(user: SessionUser, channelId: string, body: unknown, parentId: string | null = null, now = new Date()) {
  const channel = await loadChannel(user, channelId);
  if (channel.archived) throw invalid("This channel is archived.");
  const text = bodySchema.parse(body);
  let parent: { id: string; authorId: string } | null = null;
  if (parentId) {
    parent = await db.chatMessage.findFirst({ where: { id: parentId, channelId, parentId: null, deletedAt: null }, select: { id: true, authorId: true } });
    if (!parent) throw notFound("Message");
  }
  return db.$transaction(async (tx) => {
    const message = await tx.chatMessage.create({ data: { channelId, authorId: user.id, body: text, parentId: parent?.id ?? null, createdAt: now } });
    const people = await channelPeople(tx, channel);
    const link = `/chat/${channelId}${parent ? `?thread=${parent.id}` : ""}`;
    const mentioned = findMentions(text, people).filter((id) => id !== user.id);
    await notify(tx, mentioned, `${user.name} mentioned you in #${channel.name}: ${text.slice(0, 80)}`, link);
    if (parent && parent.authorId !== user.id && !mentioned.includes(parent.authorId)) {
      await notify(tx, [parent.authorId], `${user.name} replied to your message in #${channel.name}: ${text.slice(0, 80)}`, link);
    }
    await tx.channelRead.upsert({
      where: { channelId_userId: { channelId, userId: user.id } },
      create: { channelId, userId: user.id, lastReadAt: now },
      update: { lastReadAt: now },
    });
    return message;
  });
}

async function ownMessage(user: SessionUser, messageId: string) {
  const message = await db.chatMessage.findUnique({ where: { id: messageId } });
  if (!message) throw notFound("Message");
  await loadChannel(user, message.channelId);
  return message;
}

export async function editMessage(user: SessionUser, messageId: string, body: unknown, now = new Date()) {
  const message = await ownMessage(user, messageId);
  if (message.authorId !== user.id || message.deletedAt) throw forbidden();
  if (now.getTime() - message.createdAt.getTime() > EDIT_WINDOW_MINUTES * 60_000) throw invalid(`Messages can only be edited for ${EDIT_WINDOW_MINUTES} minutes.`);
  const text = bodySchema.parse(body);
  return db.chatMessage.update({ where: { id: messageId }, data: { body: text, editedAt: now } });
}

export async function deleteMessage(user: SessionUser, messageId: string, ip: string | null, now = new Date()) {
  const message = await ownMessage(user, messageId);
  if (message.deletedAt) return;
  const fresh = now.getTime() - message.createdAt.getTime() <= EDIT_WINDOW_MINUTES * 60_000;
  if (!(message.authorId === user.id && fresh) && user.role !== "OWNER") throw forbidden();
  await db.$transaction(async (tx) => {
    await tx.chatMessage.update({ where: { id: messageId }, data: { deletedAt: now, body: "" } });
    await writeAudit(tx, { actorId: user.id, action: "chat.delete", entityType: "ChatMessage", entityId: messageId, before: { authorId: message.authorId, body: message.body, channelId: message.channelId }, ip });
  });
}

export async function toggleReaction(user: SessionUser, messageId: string, emoji: string) {
  if (!(REACTIONS as readonly string[]).includes(emoji)) throw invalid("Pick one of the offered reactions.");
  const message = await ownMessage(user, messageId);
  if (message.deletedAt) return;
  const key = { messageId_userId_emoji: { messageId, userId: user.id, emoji } };
  const existing = await db.chatReaction.findUnique({ where: key });
  if (existing) await db.chatReaction.delete({ where: key });
  else await db.chatReaction.create({ data: { messageId, userId: user.id, emoji } });
}

// Turns a chat message into a task form's starting values.
export async function messageForTask(user: SessionUser, messageId: string) {
  const message = await ownMessage(user, messageId);
  const channel = await db.channel.findUniqueOrThrow({ where: { id: message.channelId }, select: { clientId: true } });
  if (!channel.clientId || message.deletedAt) return null;
  return { clientId: channel.clientId, body: message.body, messageId: message.id };
}

// Which channel a client's Chat tab shows.
export async function clientChannelId(clientId: string) {
  return (await db.channel.findUnique({ where: { clientId }, select: { id: true } }))?.id ?? null;
}
