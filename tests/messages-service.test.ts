import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getThread, listRecipients, listThreads, replyToThread, startThread, unreadThreadCount } from "@/services/messages";
import { deleteUser } from "@/services/users";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function person(role: "OWNER" | "EXECUTION" | "OFFPAGE" = "EXECUTION", name?: string) {
  const { user } = await makeUser({ role, name });
  return asSessionUser(user);
}

const message = { subject: "Laptop issue", body: "My laptop is very slow since yesterday." };

describe("conversations", () => {
  it("goes only to the people chosen, and notifies them", async () => {
    const aarif = await person("OWNER", "Aarif");
    const salman = await person("OWNER", "Salman");
    const u = await person("OFFPAGE", "Fareen");

    const thread = await startThread(u, { ...message, to: [aarif.id] });
    const notified = await db.notification.findMany();
    expect(notified.map((n) => n.userId)).toEqual([aarif.id]);
    expect(notified[0].link).toBe(`/messages/${thread.id}`);

    const inbox = await listThreads(aarif);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ subject: "Laptop issue", unread: true, lastAuthor: "Fareen" });
    expect(inbox[0].others.map((p) => p.name)).toEqual(["Fareen"]);
    // Salman was not chosen, so he cannot see it.
    expect(await listThreads(salman)).toHaveLength(0);
    await expect(getThread(salman, thread.id)).rejects.toThrow(/not found/i);
  });

  it("can include several people, teammates as well as owners", async () => {
    const owner = await person("OWNER", "Aarif");
    const saad = await person("EXECUTION", "Saad");
    const sohail = await person("EXECUTION", "Sohail");
    const thread = await startThread(saad, { ...message, to: [owner.id, sohail.id] });

    await replyToThread(sohail, thread.id, { body: "Same here." });
    const forReply = await db.notification.findMany({ where: { title: { contains: "replied" } } });
    expect(forReply.map((n) => n.userId).sort()).toEqual([owner.id, saad.id].sort());
    const { participants } = await getThread(owner, thread.id);
    expect(participants.map((p) => p.name).sort()).toEqual(["Aarif", "Saad", "Sohail"]);
  });

  it("keeps conversations private from everyone else", async () => {
    const owner = await person("OWNER");
    const u = await person("EXECUTION", "Saad");
    const other = await person("EXECUTION", "Sohail");
    const thread = await startThread(u, { ...message, to: [owner.id] });

    expect(await listThreads(other)).toHaveLength(0);
    await expect(getThread(other, thread.id)).rejects.toThrow(/not found/i);
    await expect(replyToThread(other, thread.id, { body: "hello" })).rejects.toThrow(/not found/i);
    await expect(getThread(u, thread.id)).resolves.toBeTruthy();
  });

  it("notifies the other side on a reply and marks it read when opened", async () => {
    const owner = await person("OWNER");
    const u = await person();
    const thread = await startThread(u, { ...message, to: [owner.id] });
    await db.notification.deleteMany();

    await replyToThread(owner, thread.id, { body: "We will order a new one." });
    const forMember = await db.notification.findFirstOrThrow();
    expect(forMember.userId).toBe(u.id);
    expect(await unreadThreadCount(u)).toBe(1);

    const opened = await getThread(u, thread.id);
    expect(opened.messages).toHaveLength(2);
    expect(await unreadThreadCount(u)).toBe(0);
    // Your own reply never shows as unread to you.
    await replyToThread(u, thread.id, { body: "Thank you." });
    expect(await unreadThreadCount(u)).toBe(0);
    expect(await unreadThreadCount(owner)).toBe(1);
  });

  it("needs at least one valid recipient and refuses removed people", async () => {
    const owner = await person("OWNER");
    const u = await person();
    const gone = await person("OFFPAGE");
    await deleteUser(owner, gone.id, null);

    await expect(startThread(u, { ...message, to: [] })).rejects.toThrow(/who to send/i);
    await expect(startThread(u, { ...message, to: [u.id] })).rejects.toThrow(/who to send/i);
    await expect(startThread(u, { ...message, to: [gone.id] })).rejects.toThrow(/who to send/i);
    await expect(startThread(u, { ...message, to: ["no-such-person"] })).rejects.toThrow(/who to send/i);
    expect((await listRecipients(u)).map((p) => p.id)).toEqual([owner.id]);
  });

  it("lists owners first among recipients", async () => {
    const u = await person("EXECUTION", "Aaron");
    await person("OFFPAGE", "Bina");
    await person("OWNER", "Zoya");
    expect((await listRecipients(u)).map((p) => p.name)).toEqual(["Zoya", "Bina"]);
  });

  it("rejects empty messages", async () => {
    const owner = await person("OWNER");
    const u = await person();
    await expect(startThread(u, { to: [owner.id], subject: "", body: "x" })).rejects.toThrow(/subject/i);
    const thread = await startThread(u, { ...message, to: [owner.id] });
    await expect(replyToThread(u, thread.id, { body: "   " })).rejects.toThrow(/write a message/i);
  });
});
