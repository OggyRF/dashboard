import type { Metadata } from "next";
import Link from "next/link";
import { ChannelList } from "@/components/chat/channel-list";
import { ChatRoom } from "@/components/chat/chat-room";
import { requirePermission } from "@/lib/auth/current-user";
import { channelView, listChannels } from "@/services/chat";

export const metadata: Metadata = { title: "Chat" };

export default async function ChannelPage({ params, searchParams }: PageProps<"/chat/[channelId]">) {
  const user = await requirePermission("chat.use");
  const { channelId } = await params;
  const sp = await searchParams;
  const thread = typeof sp.thread === "string" ? sp.thread : null;
  const initial = await channelView(user, channelId, thread).catch(() => null);
  const channels = await listChannels(user);
  if (!initial) {
    return (
      <div className="card mx-auto max-w-xl text-center">
        <h1 className="text-lg font-bold">Channel not found</h1>
        <p className="mt-1 text-sm text-muted">You may not be on this client&apos;s team.</p>
        <Link href="/chat" className="btn-secondary mt-4">All channels</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-7xl gap-5">
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="card sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto p-3">
          <ChannelList channels={channels} activeId={channelId} />
        </div>
      </aside>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href="/chat" className="text-sm text-muted hover:text-brand lg:hidden">← Channels</Link>
          <h1 className="page-title">#{initial.channel.name}</h1>
          {initial.channel.client && (
            <Link href={`/clients/${initial.channel.client.id}`} className="text-sm text-muted hover:text-brand">{initial.channel.client.name}</Link>
          )}
          <span className="text-xs text-muted">{initial.people.length} people can read this</span>
        </div>
        <ChatRoom key={channelId} initial={initial} meId={user.id} threadId={thread} heightClass="h-[calc(100dvh-25rem)] min-h-[24rem] md:h-[calc(100dvh-13rem)] md:min-h-[28rem]" />
      </div>
    </div>
  );
}
