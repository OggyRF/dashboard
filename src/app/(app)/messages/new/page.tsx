import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/current-user";
import { listRecipients } from "@/services/messages";
import { ComposeForm } from "../message-forms";
import { MessagesShell } from "../shell";

export const metadata: Metadata = { title: "New message" };

export default async function NewMessagePage({ searchParams }: PageProps<"/messages/new">) {
  const user = await requirePermission("messages.sendToOwners");
  const recipients = await listRecipients(user);
  const to = (await searchParams).to;
  const preselected = typeof to === "string" ? [to] : [];
  return (
    <MessagesShell user={user} active="new">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <Link href="/messages" className="rounded-lg p-1 text-muted hover:bg-background md:hidden" aria-label="Back to messages">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h2 className="text-lg font-bold">New message</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <ComposeForm recipients={recipients} preselected={preselected} />
      </div>
    </MessagesShell>
  );
}
