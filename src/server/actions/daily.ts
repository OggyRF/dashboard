"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { addDailyTask, removeDailyTask, tickDaily, untickDaily } from "@/services/daily";
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
      { date: get("date"), assigneeId: get("assigneeId"), clientId: get("clientId"), work: get("work"), activityId: get("activityId"), qty: get("qty"), details: get("details") },
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

export async function tickDailyAction(id: string, proofUrl: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const r = await tickDaily(user, id, proofUrl, (await requestMeta()).ip);
    refresh();
    return { ok: r.linked ? "Done, and ticked in the client's off-page checklist." : r.noBoxLeft ? "Done. The off-page checklist has no open box left for this activity this month." : "Done." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function untickDailyAction(tickId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await untickDaily(user, tickId, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { ok: "Unticked." };
}
