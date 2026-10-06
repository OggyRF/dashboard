import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Add many clients" };

export default async function ImportClientsPage() {
  await requirePermission("clients.edit");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/clients" className="text-sm text-muted hover:text-brand">← Clients</Link>
        <h1 className="page-title mt-1">Add many clients</h1>
        <p className="text-sm text-muted">Paste your client list. Owners, team and off-page plans can be filled in on each client afterwards.</p>
      </div>
      <div className="card"><ImportForm /></div>
    </div>
  );
}
