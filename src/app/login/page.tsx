import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Team login" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">HI Digital Solution LLP</p>
        <h1 className="mt-1 text-2xl font-semibold">Team login</h1>
        <p className="mt-1 text-sm text-muted">Sign in with the email and password your owner set up.</p>
        <LoginForm />
      </div>
    </main>
  );
}
