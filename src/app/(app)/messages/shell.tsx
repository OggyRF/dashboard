import Link from "next/link";
import { PenSquare } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { SessionUser } from "@/services/auth";
import { listThreads } from "@/services/messages";

// Two panes like an email inbox: conversations on the left, the open one (or
// the compose form) on the right. On phones only one pane shows at a time.
export async function MessagesShell({ user, active, children }: { user: SessionUser; active: string | null; children: React.ReactNode }) {
  const threads = await listThreads(user);
  return (
    <div className="mx-auto flex h-[calc(100vh-9.5rem)] min-h-[34rem] max-w-6xl overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-[0_8px_24px_-12px_rgba(16,24,64,0.08)]">
      <aside className={`${active ? "hidden md:flex" : "flex"} w-full flex-col border-r border-border md:w-80 lg:w-96`}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h1 className="text-lg font-bold">Messages</h1>
          <Link href="/messages/new" className="btn-primary py-1.5">
            <PenSquare className="h-4 w-4" />
            New
          </Link>
        </div>
        {threads.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No conversations yet. Press New to write to anyone on the team.</p>
        ) : (
          <ul className="flex-1 divide-y divide-border overflow-y-auto">
            {threads.map((t) => {
              const first = t.others[0];
              return (
                <li key={t.id}>
                  <Link
                    href={`/messages/${t.id}`}
                    className={`flex gap-3 px-4 py-3 transition ${t.id === active ? "bg-brand/8" : "hover:bg-background"}`}
                  >
                    {first ? <Avatar person={first} /> : <span className="h-9 w-9" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${t.unread ? "font-bold" : "font-medium"}`}>
                          {t.others.map((p) => p.name.split(" ")[0]).join(", ") || "Only you"}
                        </span>
                        <span className={`shrink-0 text-xs ${t.unread ? "font-semibold text-brand" : "text-muted"}`}>{shortWhen(t.lastMessageAt)}</span>
                      </div>
                      <div className={`truncate text-sm ${t.unread ? "font-semibold" : ""}`}>{t.subject}</div>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs text-muted">{t.lastAuthor}: {t.preview}</span>
                        {t.unread && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-brand" />}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      <section className={`${active ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>{children}</section>
    </div>
  );
}

// "14:05" today, "3 Oct" earlier, in India time.
function shortWhen(date: Date) {
  const tz = "Asia/Kolkata";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const sameDay = day(date) === day(new Date());
  return new Intl.DateTimeFormat("en-IN", sameDay ? { timeZone: tz, hour: "2-digit", minute: "2-digit" } : { timeZone: tz, day: "numeric", month: "short" }).format(date);
}
