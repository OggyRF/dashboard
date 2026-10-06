"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { createClient, importClients, setAssignments, updateClient } from "@/services/clients";
import { errorMessage, type ActionResult } from "./helpers";

function clientFields(f: FormData) {
  const get = (k: string) => (f.get(k) === null ? undefined : String(f.get(k)));
  return {
    name: get("name"),
    website: get("website"),
    type: get("type"),
    status: get("status"),
    industry: get("industry"),
    location: get("location"),
    startDate: get("startDate"),
    goals: get("goals"),
    notes: get("notes"),
    strategicOwnerId: get("strategicOwnerId"),
    executionOwnerId: get("executionOwnerId"),
    offpageOwnerId: get("offpageOwnerId"),
  };
}

export async function createClientAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let id: string;
  try {
    id = (await createClient(user, clientFields(f), (await requestMeta()).ip)).id;
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/clients/${id}`);
}

export async function updateClientAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = String(f.get("clientId"));
  try {
    await updateClient(user, id, clientFields(f), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/clients/${id}`, "layout");
  return { ok: "Saved." };
}

export async function setAssignmentsAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = String(f.get("clientId"));
  // Each checkbox is "userId:RESPONSIBILITY".
  const rows = f.getAll("member").map(String).map((v) => {
    const [userId, responsibility] = v.split(":");
    return { userId, responsibility };
  });
  try {
    await setAssignments(user, id, rows, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/clients/${id}`, "layout");
  return { ok: "Team saved." };
}

export type ImportResult = { error?: string; added?: string[]; problems?: string[] } | undefined;

export async function importClientsAction(_s: ImportResult, f: FormData): Promise<ImportResult> {
  const user = await requireUser();
  try {
    const result = await importClients(user, String(f.get("lines") ?? ""), (await requestMeta()).ip);
    revalidatePath("/clients");
    return result;
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
