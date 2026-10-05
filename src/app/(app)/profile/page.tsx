import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { NameForm, PhotoForm } from "./profile-forms";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="page-title">My profile</h1>
      <section className="card flex flex-wrap items-center gap-6">
        <Avatar person={user} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold">{user.name}</div>
          <div className="text-sm text-muted">{user.email} · {ROLE_LABELS[user.role]}</div>
          <PhotoForm hasPhoto={!!user.avatarUpdatedAt} />
        </div>
      </section>
      <section className="card">
        <h2 className="text-lg font-bold">Name</h2>
        <p className="mt-1 text-sm text-muted">This is how the team sees you everywhere in the dashboard.</p>
        <NameForm name={user.name} />
      </section>
      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Password</h2>
          <p className="mt-1 text-sm text-muted">Changing it signs you out on your other devices.</p>
        </div>
        <Link href="/account/password" className="btn-secondary">
          <KeyRound className="h-4 w-4" />
          Change password
        </Link>
      </section>
    </div>
  );
}
