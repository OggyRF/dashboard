"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

export function Sidebar({ items, badges }: { items: NavItem[]; badges: Partial<Record<"leave" | "messages", number>> }) {
  const pathname = usePathname();
  const countFor = (item: NavItem) => (item.badge ? badges[item.badge] ?? 0 : 0);
  return (
    <nav className="flex flex-col gap-0.5 p-3 text-sm">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const count = countFor(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between rounded-lg px-3 py-2 ${
              active ? "bg-brand/10 font-medium text-brand" : "text-foreground hover:bg-background"
            }`}
          >
            {item.label}
            {count > 0 && (
              <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-ink">{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
