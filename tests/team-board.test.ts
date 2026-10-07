import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { istDateTime } from "@/lib/dates";
import { recordEvent } from "@/services/attendance";
import { createClient } from "@/services/clients";
import { addDailyTask, completeUnit, personDay } from "@/services/daily";
import { addActivity } from "@/services/offpage";
import { personProfile, teamBoard } from "@/services/team";
import { asSessionUser, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const on = (day: string, time = "11:00") => istDateTime(day, time);
async function person(role: "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE", name: string) {
  return asSessionUser((await makeUser({ role, name })).user);
}

async function setup() {
  const aarif = await person("OWNER", "Aarif");
  const sameer = await person("STRATEGY", "Sameer");
  const saad = await person("EXECUTION", "Saad");
  const sohail = await person("EXECUTION", "Sohail");
  const uzma = await person("OFFPAGE", "Uzma");
  const huzaif = await person("OFFPAGE", "Huzaif");
  const fareen = await person("OFFPAGE", "Fareen");
  const now = on("2026-10-06");
  const iitb = await createClient(aarif, { name: "IIT Bombay", type: "SEO", strategicOwnerId: sameer.id, executionOwnerId: saad.id, offpageOwnerId: uzma.id }, null);
  const printery = await createClient(aarif, { name: "Printery", type: "SEO", strategicOwnerId: sameer.id, executionOwnerId: sohail.id, offpageOwnerId: uzma.id }, null);
  await createClient(aarif, { name: "Cafe Bloom", type: "GMB", executionOwnerId: sohail.id, offpageOwnerId: huzaif.id }, null);
  return { aarif, sameer, saad, sohail, uzma, huzaif, fareen, iitb, printery, now };
}

describe("team board", () => {
  it("groups people into each manager's team and shows what leads oversee", async () => {
    const { aarif, saad, uzma, huzaif, now, iitb } = await setup();
    await recordEvent(uzma, "LOGIN", null, on("2026-10-06", "10:59"));
    const line = await addDailyTask(saad, { date: "2026-10-06", assigneeId: uzma.id, clientId: iitb.id, work: "OTHER", qty: 2, details: "SERP update" }, null, now);
    await completeUnit(uzma, line.id, 1, "", null, now);

    const board = await teamBoard(aarif, "2026-10-06", now);
    expect(board.teams.map((t) => [t.lead.name, t.members.map((m) => m.name)])).toEqual([
      ["Saad", ["Uzma"]],
      ["Sohail", ["Huzaif", "Uzma"]],
    ]);
    const uzmaCard = board.teams[0]!.members[0]!;
    expect(uzmaCard.today).toEqual({ done: 1, planned: 2, working: 0 });
    expect(uzmaCard.attendance?.state).toBe("WORKING");
    expect(uzmaCard.teams.map((t) => t.name)).toEqual(["Saad", "Sohail"]);
    expect(board.leads.map((l) => [l.person.name, l.label, l.clients, l.people])).toEqual([
      ["Sameer", "Strategist", 2, 3],
      ["Saad", "Project manager", 1, 1],
      ["Sohail", "Project manager", 2, 2],
    ]);
    expect(board.others.map((p) => p.name)).toEqual(["Fareen"]);
    expect(board.teams.find((t) => t.lead.name === "Saad")?.total).toEqual({ done: 1, planned: 2 });
    void huzaif;
  });

  it("lets every manager see everyone, with their own team first", async () => {
    const { sohail, uzma } = await setup();
    const board = await teamBoard(sohail, "2026-10-06", on("2026-10-06"));
    expect(board.teams[0]).toMatchObject({ mine: true, lead: { name: "Sohail" } });
    expect(board.teams).toHaveLength(2);
    await expect(teamBoard(uzma, "2026-10-06")).rejects.toThrow(/permission/);
  });

  it("builds a person's profile with clients, off-page month and their list", async () => {
    const { aarif, saad, sameer, uzma, huzaif, iitb, now } = await setup();
    await addActivity(aarif, iitb.id, { name: "Guest Posting", monthlyQty: 8, assigneeId: uzma.id, applyNow: true }, null, now);
    const profile = await personProfile(saad, uzma.id, now);
    expect(profile.teams.map((t) => t.name)).toEqual(["Saad", "Sohail"]);
    expect(profile.clients.map((c) => c.client.name)).toEqual(["IIT Bombay", "Printery"]);
    expect(profile.offpage.map((g) => [g.client.name, g.total.planned])).toEqual([["IIT Bombay", 8]]);
    const lead = await personProfile(aarif, sameer.id, now);
    expect(lead.leads?.clients.map((c) => c.name)).toEqual(["IIT Bombay", "Printery"]);
    // A strategist oversees the managers on their clients too.
    expect(lead.leads?.members.map((m) => m.name)).toEqual(["Saad", "Sohail", "Uzma"]);
    expect((await personDay(saad, uzma.id, "2026-10-06", now)).progress.planned).toBeGreaterThan(0);
    await expect(personProfile(huzaif, uzma.id, now)).rejects.toThrow(/permission/);
  });
});
