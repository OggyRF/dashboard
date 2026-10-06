import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { listTeam } from "@/services/clients";
import { ClientForm, EMPTY_CLIENT } from "../client-form";

export const metadata: Metadata = { title: "Add client" };

export default async function NewClientPage() {
  await requirePermission("clients.edit");
  const people = await listTeam();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/clients" className="text-sm text-muted hover:text-brand">← Clients</Link>
        <h1 className="page-title mt-1">Add a client</h1>
        <p className="text-sm text-muted">A chat channel is made for the client automatically. You can add the rest of the team and the off-page plan next.</p>
      </div>
      <div className="card">
        <ClientForm values={EMPTY_CLIENT} people={people} />
      </div>
    </div>
  );
}
