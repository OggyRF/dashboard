import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-2xl font-semibold">
          {user.mustChangePassword ? "Set your password" : "Change password"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {user.mustChangePassword
            ? `Welcome, ${user.name}. Replace the temporary password with your own.`
            : "Other devices will be signed out."}{" "}
          Use at least {MIN_PASSWORD_LENGTH} characters.
        </p>
        <PasswordForm />
        {!user.mustChangePassword && (
          <Link href="/" className="mt-4 block text-center text-sm text-muted hover:underline">Back to dashboard</Link>
        )}
      </div>
    </main>
  );
}
