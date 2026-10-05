import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { requireUser } from "@/lib/auth/current-user";
import { getThread } from "@/services/messages";
import { AutoRefresh, ChatReplyForm, ScrollToEnd } from "../message-forms";
import { MessagesShell } from "../shell";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: PageProps<"/messages/[threadId]">) {
  const user = await requireUser();
  const { threadId } = await params;
  const { thread, participants, messages } = await getThread(user, threadId);
  const others = participants.filter((p) => p.id !== user.id);

  return (
    <MessagesShell user={user} active={threadId}>
      <AutoRefresh seconds={10} />
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <Link href="/messages" className="rounded-lg p-1 text-muted hover:bg-background md:hidden" aria-label="Back to messages">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold">{thread.subject}</h2>
          <p className="truncate text-xs text-muted">With {others.map((p) => p.name).join(", ") || "only you"}</p>
        </div>
        <div className="hidden -space-x-2 sm:flex">
          {others.slice(0, 4).map((p) => <Avatar key={p.id} person={p} size="sm" className="ring-2 ring-surface" />)}
        </div>
      </div>
      <ScrollToEnd count={messages.length} className="flex-1 space-y-4 overflow-y-auto bg-background/50 px-5 py-5">
        {messages.map((m, i) => {
          const mine = m.author.id === user.id;
          const grouped = i > 0 && messages[i - 1].author.id === m.author.id && +m.createdAt - +messages[i - 1].createdAt < 5 * 60_000;
          return (
            <div key={m.id} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""} ${grouped ? "-mt-2.5" : ""}`}>
              {!mine && (grouped ? <span className="w-8 shrink-0" /> : <Avatar person={m.author} size="sm" />)}
              <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                {!grouped && (
                  <span className="mb-1 px-1 text-xs text-muted">
                    {mine ? "You" : m.author.name} · {when(m.createdAt)}
                  </span>
                )}
                <p className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${mine ? "brand-gradient rounded-br-md text-brand-ink" : "rounded-bl-md border border-border bg-surface"}`}>
                  {m.body}
                </p>
              </div>
            </div>
          );
        })}
      </ScrollToEnd>
      <ChatReplyForm threadId={threadId} />
    </MessagesShell>
  );
}

function when(date: Date) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
