import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { channelView, deleteMessage, editMessage, findMentions, listChannels, postMessage, toggleReaction, unreadChatCount } from "@/services/chat";
import { createClient, setAssignments } from "@/services/clients";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function person(role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name = role.toLowerCase()) {
  return asSessionUser((await makeUser({ role, name })).user);
}

async function setup() {
  const owner = await person("OWNER", "Aarif Hashmi");
  const saad = await person("EXECUTION", "Saad Shaikh");
  const huzaif = await person("OFFPAGE", "Huzaif");
  const fareen = await person("OFFPAGE", "Fareen");
  const client = await createClient(owner, { name: "IITB", type: "SEO", executionOwnerId: saad.id }, null);
  await setAssignments(owner, client.id, [{ userId: huzaif.id, responsibility: "OFFPAGE" }], null);
  const channel = await db.channel.findUniqueOrThrow({ where: { clientId: client.id } });
  return { owner, saad, huzaif, fareen, client, channel };
}

describe("chat", () => {
  it("shows each person #general and their clients' channels only", async () => {
    const { owner, huzaif, fareen } = await setup();
    expect((await listChannels(owner)).map((c) => c.name)).toEqual(["general", "iitb"]);
    expect((await listChannels(huzaif)).map((c) => c.name)).toEqual(["general", "iitb"]);
    expect((await listChannels(fareen)).map((c) => c.name)).toEqual(["general"]);
  });

  it("keeps outsiders out of a client channel", async () => {
    const { fareen, channel } = await setup();
    await expect(channelView(fareen, channel.id)).rejects.toThrow(/not found/);
    await expect(postMessage(fareen, channel.id, "hi")).rejects.toThrow(/not found/);
  });

  it("counts unread messages until the channel is opened", async () => {
    const { owner, huzaif, channel } = await setup();
    await postMessage(owner, channel.id, "Please post 3 guest posts today");
    await postMessage(owner, channel.id, "Thanks");
    expect(await unreadChatCount(huzaif)).toBe(2);
    expect(await unreadChatCount(owner)).toBe(0);
    await channelView(huzaif, channel.id);
    expect(await unreadChatCount(huzaif)).toBe(0);
  });

  it("notifies people mentioned by first or full name, only if they can see the channel", async () => {
    const { owner, saad, huzaif, fareen, channel } = await setup();
    await postMessage(owner, channel.id, "@Huzaif and @saad shaikh please check. @Fareen too");
    expect(await db.notification.count({ where: { userId: huzaif.id, title: { contains: "mentioned you" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: saad.id, title: { contains: "mentioned you" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: fareen.id } })).toBe(0);
    expect(findMentions("email me at a@saad.com", [{ id: "x", name: "Saad" }])).toEqual([]);
  });

  it("keeps replies in a thread and tells the original author", async () => {
    const { owner, huzaif, channel } = await setup();
    const parent = await postMessage(huzaif, channel.id, "Posted the first guest post");
    await postMessage(owner, channel.id, "Great, link?", parent.id);
    const view = await channelView(huzaif, channel.id, parent.id);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]!.replyCount).toBe(1);
    expect(view.thread?.replies.map((r) => r.body)).toEqual(["Great, link?"]);
    expect(await db.notification.count({ where: { userId: huzaif.id, title: { contains: "replied" } } })).toBe(1);
  });

  it("allows editing and deleting your own message for 15 minutes; owners can delete any", async () => {
    const { owner, huzaif, channel } = await setup();
    const t0 = new Date("2026-10-06T06:00:00Z");
    const m = await postMessage(huzaif, channel.id, "typo heer", null, t0);
    await editMessage(huzaif, m.id, "typo here", new Date(t0.getTime() + 5 * 60_000));
    await expect(editMessage(huzaif, m.id, "late", new Date(t0.getTime() + 16 * 60_000))).rejects.toThrow(/15 minutes/);
    await expect(editMessage(owner, m.id, "not mine")).rejects.toThrow(/permission/);
    await expect(deleteMessage(huzaif, m.id, null, new Date(t0.getTime() + 16 * 60_000))).rejects.toThrow(/permission/);
    await deleteMessage(owner, m.id, null);
    const view = await channelView(owner, channel.id);
    expect(view.messages[0]).toMatchObject({ deleted: true, body: "" });
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "chat.delete" } })).before).toMatchObject({ body: "typo here" });
  });

  it("toggles reactions", async () => {
    const { owner, huzaif, channel } = await setup();
    const m = await postMessage(owner, channel.id, "Weekly target done");
    await toggleReaction(huzaif, m.id, "🎉");
    await toggleReaction(owner, m.id, "🎉");
    let view = await channelView(huzaif, channel.id);
    expect(view.messages[0]!.reactions).toEqual([{ emoji: "🎉", count: 2, mine: true, names: expect.arrayContaining(["Huzaif", "Aarif Hashmi"]) }]);
    await toggleReaction(huzaif, m.id, "🎉");
    view = await channelView(huzaif, channel.id);
    expect(view.messages[0]!.reactions[0]).toMatchObject({ count: 1, mine: false });
    await expect(toggleReaction(huzaif, m.id, "💩")).rejects.toThrow(/offered/);
  });

  it("stops posting in a churned client's channel", async () => {
    const { owner, channel } = await setup();
    await db.channel.update({ where: { id: channel.id }, data: { archived: true } });
    await expect(postMessage(owner, channel.id, "hello")).rejects.toThrow(/archived/);
  });
});
