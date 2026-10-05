import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { invalid, notFound } from "@/lib/errors";
import type { SessionUser } from "@/services/auth";

// Everyone manages their own name and photo. Photos are resized to a small
// square in the browser before upload and stored in the database.

export const MAX_AVATAR_BYTES = 300 * 1024;

export const nameSchema = z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use at most 80 characters.");

export async function updateOwnName(user: SessionUser, input: unknown, ip: string | null) {
  const parsed = nameSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Enter your name.");
  const name = parsed.data;
  if (name === user.name) return;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { name } });
    await writeAudit(tx, { actorId: user.id, action: "profile.name_changed", entityType: "User", entityId: user.id, before: { name: user.name }, after: { name }, ip });
  });
}

// Accepts only real JPEG, PNG or WebP files, checked by their first bytes.
export function imageType(bytes: Uint8Array): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function setOwnAvatar(user: SessionUser, bytes: Uint8Array, ip: string | null) {
  if (bytes.length === 0) throw invalid("Choose a photo.");
  if (bytes.length > MAX_AVATAR_BYTES) throw invalid("That photo is too large. Try a smaller one.");
  const contentType = imageType(bytes);
  if (!contentType) throw invalid("Use a JPG, PNG or WebP photo.");
  const data = Buffer.from(bytes);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.userAvatar.upsert({ where: { userId: user.id }, create: { userId: user.id, data, contentType }, update: { data, contentType } });
    await tx.user.update({ where: { id: user.id }, data: { avatarUpdatedAt: now } });
    await writeAudit(tx, { actorId: user.id, action: "profile.photo_changed", entityType: "User", entityId: user.id, ip });
  });
}

export async function removeOwnAvatar(user: SessionUser, ip: string | null) {
  await db.$transaction(async (tx) => {
    await tx.userAvatar.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { avatarUpdatedAt: null } });
    await writeAudit(tx, { actorId: user.id, action: "profile.photo_removed", entityType: "User", entityId: user.id, ip });
  });
}

// Any signed-in teammate may see anyone's photo.
export async function getAvatar(viewer: SessionUser, userId: string) {
  void viewer;
  const avatar = await db.userAvatar.findUnique({ where: { userId } });
  if (!avatar) throw notFound("Photo");
  return avatar;
}
