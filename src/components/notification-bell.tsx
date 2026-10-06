"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { markNotificationsReadAction } from "@/server/actions/messages";

export type NotificationItem = { id: string; title: string; link: string | null; readAt: Date | string | null; createdAt: Date | string };

export function NotificationBell({ items, unread }: { items: NotificationItem[]; unread: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open && unread) void markNotificationsReadAction(); }}
        className="btn-secondary relative px-2.5"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        title="Alerts"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="brand-gradient absolute -top-1.5 -right-1.5 min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-bold text-brand-ink ring-2 ring-surface">{unread}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-4 top-16 z-20 max-h-[70vh] overflow-y-auto sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:max-h-96 sm:w-80 rounded-2xl border border-border bg-surface shadow-xl">
            <div className="border-b border-border px-4 py-3 text-sm font-bold">Alerts</div>
            {items.length === 0 ? (
              <p className="p-4 text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {items.map((n) => {
                  const body = (
                    <>
                      <span className={n.readAt ? "" : "font-semibold"}>{n.title}</span>
                      <span className="mt-0.5 block text-xs text-muted">{when(n.createdAt)}</span>
                    </>
                  );
                  return (
                    <li key={n.id} className="px-4 py-3 hover:bg-background">
                      {n.link ? <Link href={n.link} onClick={() => setOpen(false)} className="block">{body}</Link> : body}
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
