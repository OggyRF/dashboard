"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { removeOwnAvatar, setOwnAvatar, updateOwnEmail, updateOwnName } from "@/services/profile";
import { errorMessage, type ActionResult } from "./helpers";

export async function updateNameAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await updateOwnName(user, formData.get("name"), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "Name saved." };
}

export async function updateEmailAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await updateOwnEmail(user, { email: formData.get("email"), password: formData.get("password") }, (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "Email saved. Use it the next time you sign in." };
}

export async function uploadAvatarAction(_s: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const file = formData.get("photo");
  if (!(file instanceof Blob)) return { error: "Choose a photo." };
  try {
    await setOwnAvatar(user, new Uint8Array(await file.arrayBuffer()), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "Photo saved." };
}

export async function removeAvatarAction(): Promise<ActionResult> {
  const user = await requireUser();
  await removeOwnAvatar(user, (await requestMeta()).ip);
  revalidatePath("/", "layout");
  return { ok: "Photo removed." };
}
