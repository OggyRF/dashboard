import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accessTo, createClient, getClient, importClients, listActivity, listClients, setAssignments, updateClient } from "@/services/clients";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function person(role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name = role.toLowerCase()) {
  return asSessionUser((await makeUser({ role, name })).user);
}

describe("clients", () => {
  it("adds a client with its own chat channel and owners on its team", async () => {
    const owner = await person("OWNER");
    const sameer = await person("STRATEGY", "Sameer");
    const saad = await person("EXECUTION", "Saad");
    const c = await createClient(owner, { name: "IITB WashU", website: "iitbwashu.org", type: "SEO", strategicOwnerId: sameer.id, executionOwnerId: saad.id }, null);
    expect(c.website).toBe("https://iitbwashu.org");
    const channel = await db.channel.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(channel.name).toBe("iitb-washu");
    const team = await db.clientAssignment.findMany({ where: { clientId: c.id } });
    expect(team.map((t) => `${t.userId}:${t.responsibility}`).sort()).toEqual([`${saad.id}:EXECUTION`, `${sameer.id}:STRATEGY`].sort());
    expect((await listActivity(owner, c.id))[0]?.summary).toMatch(/added IITB WashU/);
    expect(await db.auditLog.count({ where: { action: "client.create" } })).toBe(1);
  });

  it("gives clients with the same name their own channel names", async () => {
    const owner = await person("OWNER");
    await createClient(owner, { name: "Acme", type: "GMB" }, null);
    await createClient(owner, { name: "ACME!", type: "GMB" }, null);
    expect((await db.channel.findMany({ where: { kind: "CLIENT" }, orderBy: { name: "asc" } })).map((c) => c.name)).toEqual(["acme", "acme-2"]);
  });

  it("shows execution staff only their clients, and off-page staff only the off-page side", async () => {
    const owner = await person("OWNER");
    const saad = await person("EXECUTION", "Saad");
    const huzaif = await person("OFFPAGE", "Huzaif");
    const strategy = await person("STRATEGY");
    const mine = await createClient(owner, { name: "Mine", type: "SEO", executionOwnerId: saad.id }, null);
    await createClient(owner, { name: "Other", type: "SEO" }, null);
    expect((await listClients(saad)).map((c) => c.name)).toEqual(["Mine"]);
    expect((await listClients(strategy)).map((c) => c.name)).toEqual(["Mine", "Other"]);
    await expect(listClients(huzaif)).rejects.toThrow(/permission/);
    expect(await accessTo(huzaif, mine.id)).toBeNull();
    await setAssignments(owner, mine.id, [{ userId: huzaif.id, responsibility: "OFFPAGE" }], null);
    expect(await accessTo(huzaif, mine.id)).toBe("offpage");
    expect((await getClient(huzaif, mine.id)).access).toBe("offpage");
    // The execution lead stays on the team even when left out of the new list.
    expect(await accessTo(saad, mine.id)).toBe("full");
  });

  it("refuses to put off-page staff on non off-page work", async () => {
    const owner = await person("OWNER");
    const huzaif = await person("OFFPAGE");
    const c = await createClient(owner, { name: "X Co", type: "SEO" }, null);
    await expect(setAssignments(owner, c.id, [{ userId: huzaif.id, responsibility: "EXECUTION" }], null)).rejects.toThrow(/off-page/);
  });

  it("lets execution staff add a client and keeps them on it", async () => {
    const saad = await person("EXECUTION");
    const c = await createClient(saad, { name: "New One", type: "BOTH" }, null);
    expect(await accessTo(saad, c.id)).toBe("full");
  });

  it("archives the channel when a client is churned and logs the change", async () => {
    const owner = await person("OWNER");
    const c = await createClient(owner, { name: "Gone", type: "SEO" }, null);
    await updateClient(owner, c.id, { name: "Gone", type: "SEO", status: "CHURNED" }, null);
    expect((await db.channel.findUniqueOrThrow({ where: { clientId: c.id } })).archived).toBe(true);
    expect((await listActivity(owner, c.id))[0]?.summary).toMatch(/status to Churned/);
    expect(await listClients(owner)).toHaveLength(0);
    expect(await listClients(owner, { status: "ALL" })).toHaveLength(1);
  });

  it("filters SEO to include SEO + GMB clients", async () => {
    const owner = await person("OWNER");
    await createClient(owner, { name: "Alpha", type: "SEO" }, null);
    await createClient(owner, { name: "Beta", type: "GMB" }, null);
    await createClient(owner, { name: "Cee Co", type: "BOTH" }, null);
    expect((await listClients(owner, { type: "SEO" })).map((c) => c.name)).toEqual(["Alpha", "Cee Co"]);
    expect((await listClients(owner, { q: "bet" })).map((c) => c.name)).toEqual(["Beta"]);
  });

  it("imports a pasted list and reports bad lines", async () => {
    const owner = await person("OWNER");
    await createClient(owner, { name: "Existing", type: "SEO" }, null);
    const result = await importClients(owner, "IITB WashU, iitbwashu.org, SEO\nCafe Bloom,,GMB\nBoth Co\tboth.com\tSEO+GMB\nExisting\nBad Type, x.com, PPC", null);
    expect(result.added).toEqual(["IITB WashU", "Cafe Bloom", "Both Co"]);
    expect(result.problems).toHaveLength(2);
    expect((await db.client.findFirstOrThrow({ where: { name: "Both Co" } })).type).toBe("BOTH");
  });

  it("checks the people picked as owners", async () => {
    const owner = await person("OWNER");
    const offpage = await person("OFFPAGE");
    await expect(createClient(owner, { name: "Yoyo", type: "SEO", strategicOwnerId: offpage.id }, null)).rejects.toThrow(/SEO Strategist/);
    await expect(createClient(owner, { name: "Yoyo", type: "SEO", executionOwnerId: offpage.id }, null)).rejects.toThrow(/SEO Project Manager/);
    await expect(createClient(owner, { name: "Yoyo", type: "SEO", offpageOwnerId: owner.id }, null)).rejects.toThrow(/Off-Page SEO Specialist/);
    await expect(createClient(owner, { name: "Yoyo", type: "SEO", website: "not a site" }, null)).rejects.toThrow(/website/);
  });

  it("puts the three leads on the client's team", async () => {
    const owner = await person("OWNER");
    const sameer = await person("STRATEGY", "Sameer");
    const saad = await person("EXECUTION", "Saad");
    const huzaif = await person("OFFPAGE", "Huzaif");
    const c = await createClient(owner, { name: "Printery Dubai", type: "SEO", strategicOwnerId: sameer.id, executionOwnerId: saad.id, offpageOwnerId: huzaif.id }, null);
    const team = await db.clientAssignment.findMany({ where: { clientId: c.id } });
    expect(team.map((t) => `${t.userId}:${t.responsibility}`).sort()).toEqual([`${sameer.id}:STRATEGY`, `${saad.id}:EXECUTION`, `${huzaif.id}:OFFPAGE`].sort());
    expect(await accessTo(huzaif, c.id)).toBe("offpage");
  });
});
