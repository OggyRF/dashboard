import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAvatar, imageType, MAX_AVATAR_BYTES, removeOwnAvatar, setOwnAvatar, updateOwnName } from "@/services/profile";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe("own profile", () => {
  it("changes your own name and records it", async () => {
    const { user } = await makeUser({ name: "Saad" });
    await updateOwnName(asSessionUser(user), "  Saad Khan ", null);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe("Saad Khan");
    expect(await db.auditLog.count({ where: { action: "profile.name_changed" } })).toBe(1);
    await expect(updateOwnName(asSessionUser(user), "S", null)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("stores a photo, versions it, and removes it", async () => {
    const { user } = await makeUser();
    const me = asSessionUser(user);
    await setOwnAvatar(me, jpeg, null);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.avatarUpdatedAt).not.toBeNull();
    const avatar = await getAvatar(me, user.id);
    expect(avatar.contentType).toBe("image/jpeg");
    expect(new Uint8Array(avatar.data)).toEqual(jpeg);

    await removeOwnAvatar(me, null);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).avatarUpdatedAt).toBeNull();
    await expect(getAvatar(me, user.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepts only real, small pictures", async () => {
    const me = asSessionUser((await makeUser()).user);
    await expect(setOwnAvatar(me, new TextEncoder().encode("<svg onload=alert(1)>"), null)).rejects.toMatchObject({ code: "VALIDATION" });
    const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
    big.set(jpeg);
    await expect(setOwnAvatar(me, big, null)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
  });
});
