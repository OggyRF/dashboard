import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Logo } from "@/components/logo";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { needsSetup } from "@/services/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-time setup" };

// Only reachable while no account exists; afterwards it sends people to login.
export default async function SetupPage() {
  await connection();
  if (!(await needsSetup())) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Logo tone="dark" />
        </div>
        <div className="card">
          <p className="text-xs font-bold tracking-widest text-brand uppercase">First-time setup</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Create the owner account</h1>
          <p className="mt-2 text-sm text-muted">
            This screen appears only once, before anyone has an account. Use at least {MIN_PASSWORD_LENGTH} characters for the password.
            You can add the rest of the team from the Team page afterwards.
          </p>
          <SetupForm />
        </div>
      </div>
    </main>
  );
}
