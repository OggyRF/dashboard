"use client";

import { useState } from "react";
import Link from "next/link";
import { markNotificationsReadAction } from "@/server/actions/messages";

export type NotificationItem = { id: string; title: string; link: string | null; readAt: Date | string | null; createdAt: Date | string };

export function NotificationBell({ items, unread }: { items: NotificationItem[]; unread: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open && unread) void markNotificationsReadAction(); }}
        className="btn-secondary relative py-1.5"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
      >
        Alerts
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-ink">{unread}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
            {items.length === 0 ? (
              <p className="p-4 text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {items.map((n) => {
                  const body = (
                    <>
                      <span className={n.readAt ? "" : "font-medium"}>{n.title}</span>
                      <span className="mt-0.5 block text-xs text-muted">{when(n.createdAt)}</span>
                    </>
                  );
                  return (
                    <li key={n.id} className="px-4 py-2.5">
                      {n.link ? <Link href={n.link} onClick={() => setOpen(false)} className="block hover:underline">{body}</Link> : body}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function when(date: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}
