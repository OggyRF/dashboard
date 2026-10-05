import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/time";
import { listThreads } from "@/services/messages";
import { NewThreadForm } from "./message-forms";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const user = await requirePermission("messages.sendToOwners");
  const threads = await listThreads(user);
  const owner = can(user.role, "messages.ownerInbox");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">Messages</h1>
        <p className="text-sm text-muted">
          {owner ? "Private conversations between the team and the owners." : "Write privately to Aarif and Salman. Only the owners can see these."}
        </p>
      </div>
      <NewThreadForm />
      <section className="card p-0">
        <h2 className="border-b border-border px-4 py-3 font-semibold">{owner ? "Inbox" : "My conversations"}</h2>
        {threads.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No conversations yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`/messages/${t.id}`} className="block px-4 py-3 hover:bg-background">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {t.unread && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand align-middle" />}
                      {t.subject}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{formatDateTime(t.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted">{owner ? `${t.fromName}: ` : ""}{t.preview}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
