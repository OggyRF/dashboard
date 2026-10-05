"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  clearSessionCookie,
  requestMeta,
  requireUser,
  sessionToken,
  setSessionCookie,
} from "@/lib/auth/current-user";
import { changeOwnPassword, login, logout } from "@/services/auth";

// `email` is echoed back so the login form keeps it after a failed attempt.
export type FormState = { error?: string; ok?: string; email?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

export async function loginAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "").slice(0, 200);
  if (!parsed.success) return { error: "Enter your email and password.", email };

  const meta = await requestMeta();
  const result = await login({ ...parsed.data, ...meta });
  if (!result.ok) {
    if (result.reason === "locked") return { error: "Too many wrong attempts. Try again in 15 minutes, or ask an owner to reset your password.", email };
    if (result.reason === "rate_limited") return { error: "Too many attempts from this network. Try again in 15 minutes.", email };
    return { error: "That email and password do not match an active account.", email };
  }
  await setSessionCookie(result.token);
  redirect(result.mustChangePassword ? "/account/password" : "/");
}

export async function logoutAction() {
  const token = await sessionToken();
  if (token) await logout(token, (await requestMeta()).ip);
  await clearSessionCookie();
  redirect("/login");
}

const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string(),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "The new passwords do not match." });

export async function changePasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = changePasswordSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  try {
    await changeOwnPassword(user.id, user.sessionId, parsed.data.current, parsed.data.next, (await requestMeta()).ip);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect("/?password=changed");
}
