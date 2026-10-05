import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarCheck2, LineChart, MessagesSquare } from "lucide-react";
import { Logo } from "@/components/logo";
import { getCurrentUser } from "@/lib/auth/current-user";
import { needsSetup } from "@/services/setup";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Team login" };

const POINTS = [
  { icon: CalendarCheck2, text: "Attendance, breaks and leave in one place" },
  { icon: LineChart, text: "Every client's SEO and GMB progress" },
  { icon: MessagesSquare, text: "Client channels and messages to the owners" },
];

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  if (await needsSetup()) redirect("/setup");
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="sidebar-gradient relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="brand-gradient pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full opacity-40 blur-3xl" />
        <div className="brand-gradient pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full opacity-25 blur-3xl" />
        <Logo />
        <div className="relative">
          <h2 className="max-w-md text-4xl leading-tight font-extrabold text-white">
            Everything the team needs, <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">in one dashboard.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/80">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-brand-2">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">HI Digital Solution LLP · Internal use only</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo tone="dark" />
          </div>
          <p className="text-xs font-bold tracking-widest text-brand uppercase">HI Digital Solution LLP</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-muted">Sign in with the email and password your owner set up.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
