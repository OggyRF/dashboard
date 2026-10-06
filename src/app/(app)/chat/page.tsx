import type { Metadata } from "next";
import { ChannelList } from "@/components/chat/channel-list";
import { requirePermission } from "@/lib/auth/current-user";
import { listChannels } from "@/services/chat";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const user = await requirePermission("chat.use");
  const channels = await listChannels(user);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Chat</h1>
        <p className="text-sm text-muted">#general is for the whole team. Each client has its own channel for everyone working on it.</p>
      </div>
      <div className="card p-3"><ChannelList channels={channels} /></div>
    </div>
  );
}
