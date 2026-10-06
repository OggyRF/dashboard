"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { addHoliday, applyForLeave, cancelLeave, decideLeave, removeHoliday, updateHoliday } from "@/services/leave";
import { errorMessage, type ActionResult } from "./helpers";

export async function applyForLeaveAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await applyForLeave(
      user,
      {
        fromDate: formData.get("fromDate"),
        toDate: formData.get("toDate") || formData.get("fromDate"),
        halfDay: formData.get("halfDay") === "on",
        type: formData.get("type"),
        reason: formData.get("reason"),
      },
      (await requestMeta()).ip,
    );
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/leave");
  return { ok: "Leave requested. The owners have been notified." };
}

export async function cancelLeaveAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let wasApproved = false;
  try {
    ({ wasApproved } = await cancelLeave(user, String(formData.get("id")), (await requestMeta()).ip));
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/leave");
  return { ok: wasApproved ? "Leave cancelled. The owners have been told." : "Request cancelled." };
}

export async function decideLeaveAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const approve = formData.get("decision") === "approve";
  try {
    await decideLeave(user, String(formData.get("id")), { approve, note: String(formData.get("note") ?? "") || undefined }, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/leave");
  return { ok: approve ? "Approved." : "Rejected." };
}

export async function addHolidayAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await addHoliday(user, { date: formData.get("date"), name: formData.get("name") }, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/settings/holidays");
  return { ok: "Holiday added." };
}

export async function removeHolidayAction(formData: FormData) {
  const user = await requireUser();
  await removeHoliday(user, String(formData.get("id")), (await requestMeta()).ip);
  revalidatePath("/settings/holidays");
}

export async function updateHolidayAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await updateHoliday(user, String(formData.get("id") ?? ""), { date: formData.get("date"), name: formData.get("name") }, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/settings/holidays");
  return { ok: "Saved." };
}
