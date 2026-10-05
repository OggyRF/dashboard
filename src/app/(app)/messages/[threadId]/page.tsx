import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/time";
import { getThread } from "@/services/messages";
import { ReplyForm } from "../message-forms";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: PageProps<"/messages/[threadId]">) {
  const user = await requireUser();
  const { threadId } = await params;
  const { thread, messages } = await getThread(user, threadId);

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/messages" className="text-sm text-muted hover:underline">← All messages</Link>
      <div>
        <h1 className="text-2xl font-semibold">{thread.subject}</h1>
        <p className="text-sm text-muted">Started by {thread.fromUser.name}</p>
      </div>
      <ul className="space-y-3">
        {messages.map((m) => (
          <li key={m.id} className={`card ${m.author.id === user.id ? "border-brand/30 bg-brand/5" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{m.author.id === user.id ? "You" : m.author.name}
                <span className="ml-2 text-xs text-muted">{ROLE_LABELS[m.author.role]}</span>
              </span>
              <span className="text-xs text-muted">{formatDateTime(m.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>
          </li>
        ))}
      </ul>
      <ReplyForm threadId={threadId} />
    </div>
  );
}
