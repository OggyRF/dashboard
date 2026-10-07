"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requestMeta, requirePermission, requireUser } from "@/lib/auth/current-user";
import type { EventType } from "@/lib/attendance/compute";
import { isMobileUserAgent } from "@/lib/attendance/presence";
import { correctDay, ensureDay, heartbeat, recordEvent, saveWorkNote, type Device, type TodayView } from "@/services/attendance";
import { backgroundGscSync } from "@/services/gsc-sync";
import { errorMessage, type ActionResult } from "./helpers";

const TYPES: EventType[] = ["LOGIN", "BREAK_START", "BREAK_END", "LOGOUT"];

// workNote is required for LOGOUT.
export async function pressAttendanceButton(type: EventType, workNote?: string): Promise<{ today?: TodayView; error?: string }> {
  const user = await requireUser();
  if (!TYPES.includes(type)) return { error: "Unknown action." };
  try {
    const meta = await requestMeta();
    const today = await recordEvent(user, type, meta.ip, new Date(), device(meta), workNote);
    revalidatePath("/", "layout");
    return { today };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveWorkNoteAction(key: string, note: string): Promise<{ today?: TodayView; error?: string }> {
  const user = await requireUser();
  try {
    const today = await saveWorkNote(user, key, note, (await requestMeta()).ip);
    revalidatePath("/attendance");
    return { today };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

function device(meta: { userAgent: string | null; mobileHint: string | null }): Device {
  return { mobile: isMobileUserAgent(meta.userAgent, meta.mobileHint) };
}

// Called by the open dashboard once a minute while the person is clocked in.
export async function heartbeatAction(): Promise<TodayView | null> {
  const user = await requireUser();
  // The once-a-minute check-in also keeps Search Console data topping up.
  after(backgroundGscSync);
  return heartbeat(user, device(await requestMeta()));
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
