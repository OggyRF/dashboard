"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { addDailyTask, completeUnit, removeDailyTask, startUnit, undoUnit } from "@/services/daily";
import { errorMessage, type ActionResult } from "./helpers";

function refresh() {
  revalidatePath("/daily");
  revalidatePath("/off-page");
  revalidatePath("/clients", "layout");
}

export async function addDailyTaskAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const get = (k: string) => String(f.get(k) ?? "");
  try {
    await addDailyTask(
      user,
      { date: get("date"), assigneeId: get("assigneeId"), clientId: get("clientId"), work: get("work"), activityId: get("activityId"), qty: get("qty"), details: get("details"), followUpId: get("followUpId") },
      (await requestMeta()).ip,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Added." };
}

export async function removeDailyTaskAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await removeDailyTask(user, id, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Removed." };
}

export async function startUnitAction(id: string, n: number): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await startUnit(user, id, n, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Working on it." };
}

export async function completeUnitAction(id: string, n: number, proofUrl: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const r = await completeUnit(user, id, n, proofUrl, (await requestMeta()).ip);
    refresh();
    return { ok: r.linked ? "Completed, and ticked in the client's off-page checklist." : r.noBoxLeft ? "Completed. The off-page checklist has no open box left for this activity this month." : "Completed." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function undoUnitAction(tickId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await undoUnit(user, tickId, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Undone." };
}
