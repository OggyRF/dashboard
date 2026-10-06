"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { createUser, deleteUser, resetPassword, signOutEverywhere, updateUser } from "@/services/users";

export type UserFormState = { error?: string; ok?: string; temporaryPassword?: string; forEmail?: string } | undefined;

function message(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the form.";
  throw e;
}

export async function createUserAction(_s: UserFormState, formData: FormData): Promise<UserFormState> {
  const actor = await requireUser();
  try {
    const { user, temporaryPassword } = await createUser(
      actor,
      { name: formData.get("name"), email: formData.get("email"), role: formData.get("role") },
      (await requestMeta()).ip,
    );
    revalidatePath("/team");
    return { ok: `Account created for ${user.name}.`, temporaryPassword, forEmail: user.email };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function updateUserAction(_s: UserFormState, formData: FormData): Promise<UserFormState> {
  const actor = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const input: Record<string, unknown> = {};
  if (formData.get("role")) input.role = formData.get("role");
  if (formData.get("status")) input.status = formData.get("status");
  if (formData.get("email")) input.email = formData.get("email");
  try {
    await updateUser(actor, userId, input, (await requestMeta()).ip);
    revalidatePath("/team");
    return { ok: "Saved." };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function resetPasswordAction(_s: UserFormState, formData: FormData): Promise<UserFormState> {
  const actor = await requireUser();
  try {
    const { temporaryPassword } = await resetPassword(actor, String(formData.get("userId") ?? ""), (await requestMeta()).ip);
    revalidatePath("/team");
    return { ok: "Password reset. They have been signed out.", temporaryPassword, forEmail: String(formData.get("email") ?? "") };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function signOutEverywhereAction(_s: UserFormState, formData: FormData): Promise<UserFormState> {
  const actor = await requireUser();
  try {
    await signOutEverywhere(actor, String(formData.get("userId") ?? ""), (await requestMeta()).ip);
    return { ok: "Signed out on all devices." };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function deleteUserAction(_s: UserFormState, formData: FormData): Promise<UserFormState> {
  const actor = await requireUser();
  try {
    await deleteUser(actor, String(formData.get("userId") ?? ""), (await requestMeta()).ip);
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/team");
  return { ok: "Deleted." };
}
