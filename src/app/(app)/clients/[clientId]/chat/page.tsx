import { ChatRoom } from "@/components/chat/chat-room";
import { requireUser } from "@/lib/auth/current-user";
import { channelView, clientChannelId } from "@/services/chat";
import { requireClient } from "@/services/clients";

export default async function ClientChat({ params, searchParams }: PageProps<"/clients/[clientId]/chat">) {
  const user = await requireUser();
  const { clientId } = await params;
  const sp = await searchParams;
  await requireClient(user, clientId, "offpage");
  const channelId = await clientChannelId(clientId);
  if (!channelId) return <div className="card text-sm text-muted">This client has no chat channel.</div>;
  const thread = typeof sp.thread === "string" ? sp.thread : null;
  const initial = await channelView(user, channelId, thread);
  return <ChatRoom initial={initial} meId={user.id} threadId={thread} heightClass="h-[calc(100dvh-30rem)] min-h-[24rem] md:h-[calc(100dvh-20rem)] md:min-h-[28rem]" />;
}
