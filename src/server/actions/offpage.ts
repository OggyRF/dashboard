"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { addActivity, copyActivities, rejectItem, removeActivity, tickItem, untickItem, updateActivity } from "@/services/offpage";
import { errorMessage, type ActionResult } from "./helpers";

function activityFields(f: FormData) {
  return {
    name: String(f.get("name") ?? ""),
    monthlyQty: String(f.get("monthlyQty") ?? ""),
    assigneeId: String(f.get("assigneeId") ?? ""),
    reviewerId: String(f.get("reviewerId") ?? ""),
    applyNow: f.get("applyNow") === "on",
  };
}

function refresh() {
  revalidatePath("/clients", "layout");
  revalidatePath("/off-page");
}

export async function addActivityAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await addActivity(user, String(f.get("clientId")), activityFields(f), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Added." };
}

export async function updateActivityAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await updateActivity(user, String(f.get("activityId")), activityFields(f), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Saved." };
}

export async function removeActivityAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await removeActivity(user, String(f.get("activityId")), f.get("applyNow") === "on", (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Removed." };
}

export async function copyActivitiesAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const n = await copyActivities(user, String(f.get("fromClientId")), String(f.get("clientId")), (await requestMeta()).ip);
    refresh();
    return { ok: `Copied ${n} activit${n === 1 ? "y" : "ies"}.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function tickItemAction(itemId: string, done: boolean, proofUrl?: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const ip = (await requestMeta()).ip;
    if (done) await tickItem(user, itemId, proofUrl ?? "", ip);
    else await untickItem(user, itemId, ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: done ? "Ticked." : "Unticked." };
}

export async function rejectItemAction(itemId: string, reason: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await rejectItem(user, itemId, reason, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Sent back." };
}
