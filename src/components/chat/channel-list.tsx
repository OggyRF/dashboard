import Link from "next/link";
import { Hash } from "lucide-react";

type Channel = { id: string; name: string; kind: string; unread: number; client: { name: string } | null };

export function ChannelList({ channels, activeId }: { channels: Channel[]; activeId?: string }) {
  const team = channels.filter((c) => c.kind === "TEAM");
  const clients = channels.filter((c) => c.kind === "CLIENT");
  return (
    <nav className="space-y-4 text-sm">
      <Group title="Team" channels={team} activeId={activeId} />
      <Group title="Clients" channels={clients} activeId={activeId} empty="You are not on any client yet." />
    </nav>
  );
}

function Group({ title, channels, activeId, empty }: { title: string; channels: Channel[]; activeId?: string; empty?: string }) {
  return (
    <div>
      <div className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted uppercase">{title}</div>
      {channels.length === 0 && empty && <p className="px-3 text-xs text-muted">{empty}</p>}
      <ul className="space-y-0.5">
        {channels.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                title={c.client?.name}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 transition ${active ? "bg-brand/10 font-semibold text-brand" : c.unread ? "font-semibold hover:bg-background" : "text-muted hover:bg-background hover:text-foreground"}`}
              >
                <Hash className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.unread > 0 && !active && <span className="brand-gradient rounded-full px-1.5 text-[11px] font-bold text-brand-ink">{c.unread}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
