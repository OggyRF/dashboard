import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getThread, listThreads, replyToThread, startThread, unreadThreadCount } from "@/services/messages";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function person(role: "OWNER" | "EXECUTION" | "OFFPAGE" = "EXECUTION", name?: string) {
  const { user } = await makeUser({ role, name });
  return asSessionUser(user);
}

const message = { subject: "Laptop issue", body: "My laptop is very slow since yesterday." };

describe("messages to the owners", () => {
  it("notifies every owner and shows in their inbox", async () => {
    const aarif = await person("OWNER", "Aarif");
    const salman = await person("OWNER", "Salman");
    const u = await person("OFFPAGE", "Fareen");

    const thread = await startThread(u, message);
    const notified = await db.notification.findMany();
    expect(notified.map((n) => n.userId).sort()).toEqual([aarif.id, salman.id].sort());
    expect(notified[0].link).toBe(`/messages/${thread.id}`);

    const inbox = await listThreads(aarif);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ subject: "Laptop issue", fromName: "Fareen", unread: true });
  });

  it("keeps conversations private from other team members", async () => {
    const u = await person("EXECUTION", "Saad");
    const other = await person("EXECUTION", "Sohail");
    const thread = await startThread(u, message);

    expect(await listThreads(other)).toHaveLength(0);
    await expect(getThread(other, thread.id)).rejects.toThrow(/not found/i);
    await expect(replyToThread(other, thread.id, { body: "hello" })).rejects.toThrow(/not found/i);
    await expect(getThread(u, thread.id)).resolves.toBeTruthy();
  });

  it("notifies the other side on a reply and marks it read when opened", async () => {
    const owner = await person("OWNER");
    const u = await person();
    const thread = await startThread(u, message);
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

  it("rejects empty messages", async () => {
    const u = await person();
    await expect(startThread(u, { subject: "", body: "x" })).rejects.toThrow(/subject/i);
    const thread = await startThread(u, message);
    await expect(replyToThread(u, thread.id, { body: "   " })).rejects.toThrow(/write a message/i);
  });
});
