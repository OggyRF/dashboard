"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requestMeta, requirePermission, requireUser } from "@/lib/auth/current-user";
import type { EventType } from "@/lib/attendance/compute";
import { correctDay, ensureDay, recordEvent, type TodayView } from "@/services/attendance";
import { errorMessage, type ActionResult } from "./helpers";

const TYPES: EventType[] = ["LOGIN", "BREAK_START", "BREAK_END", "LOGOUT"];

export async function pressAttendanceButton(type: EventType): Promise<{ today?: TodayView; error?: string }> {
  const user = await requireUser();
  if (!TYPES.includes(type)) return { error: "Unknown action." };
  try {
    const today = await recordEvent(user, type, (await requestMeta()).ip);
    revalidatePath("/", "layout");
    return { today };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export type CorrectionState = (ActionResult & { time?: string; reason?: string }) | undefined;

export async function correctDayAction(_s: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const actor = await requirePermission("attendance.correct");
  const dayId = String(formData.get("dayId") ?? "");
  try {
    await correctDay(
      actor,
      dayId,
      {
        kind: formData.get("kind"),
        eventId: formData.get("eventId") || undefined,
        type: formData.get("type") || undefined,
        time: formData.get("time") || undefined,
        reason: formData.get("reason"),
      },
      (await requestMeta()).ip,
    );
  } catch (e) {
    return { error: errorMessage(e), time: String(formData.get("time") ?? ""), reason: String(formData.get("reason") ?? "") };
  }
  revalidatePath(`/attendance/days/${dayId}`);
  return { ok: "Correction saved." };
}

export async function openDayAction(formData: FormData) {
  const actor = await requirePermission("attendance.correct");
  const dayId = await ensureDay(actor, String(formData.get("userId")), String(formData.get("key")));
  redirect(`/attendance/days/${dayId}`);
}
