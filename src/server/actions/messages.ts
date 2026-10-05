"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { replyToThread, startThread } from "@/services/messages";
import { markNotificationsRead } from "@/services/notifications";
import { errorMessage, type ActionResult } from "./helpers";

export async function startThreadAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let threadId: string;
  try {
    threadId = (await startThread(user, { to: formData.getAll("to").map(String), subject: formData.get("subject"), body: formData.get("body") })).id;
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/messages/${threadId}`);
}

export async function replyAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const threadId = String(formData.get("threadId"));
  try {
    await replyToThread(user, threadId, { body: formData.get("body") });
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/messages", "layout");
  return { ok: "Sent." };
}

export async function markNotificationsReadAction() {
  const user = await requireUser();
  await markNotificationsRead(user);
  revalidatePath("/", "layout");
}
