import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Link href="/settings/audit" className="card block hover:border-brand">
        <div className="font-medium">Audit log</div>
        <div className="text-sm text-muted">Every sign-in, account change and, later, every change to client work.</div>
      </Link>
      <Link href="/settings/holidays" className="card block hover:border-brand">
        <div className="font-medium">Holidays</div>
        <div className="text-sm text-muted">Days that do not count as working days in leave requests.</div>
      </Link>
      <div className="card text-sm text-muted">
        Google connection, ranking API and health rules are added in later phases.
      </div>
    </div>
  );
}
