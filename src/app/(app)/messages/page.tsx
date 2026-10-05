import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { requirePermission } from "@/lib/auth/current-user";
import { MessagesShell } from "./shell";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const user = await requirePermission("messages.sendToOwners");
  return (
    <MessagesShell user={user} active={null}>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <MessagesSquare className="h-7 w-7" />
        </span>
        <p className="font-semibold">Pick a conversation</p>
        <p className="max-w-xs text-sm text-muted">Or press New to start one. Only the people you add can see it.</p>
      </div>
    </MessagesShell>
  );
}
