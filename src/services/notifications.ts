import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/services/auth";

type Tx = Prisma.TransactionClient;

export async function notify(tx: Tx, userIds: string[], title: string, link?: string) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await tx.notification.createMany({ data: unique.map((userId) => ({ userId, title, link: link ?? null })) });
}

export async function activeOwnerIds(tx: Tx = db): Promise<string[]> {
  const owners = await tx.user.findMany({ where: { role: "OWNER", status: "ACTIVE" }, select: { id: true } });
  return owners.map((o) => o.id);
}

export function listNotifications(user: SessionUser, take = 30) {
  return db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take });
}

export function unreadNotificationCount(user: SessionUser) {
  return db.notification.count({ where: { userId: user.id, readAt: null } });
}

export async function markNotificationsRead(user: SessionUser) {
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
}
