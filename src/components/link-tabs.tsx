"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Tabs as links; the one matching the current address is highlighted.
export function LinkTabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean; count?: number }[] }) {
  const pathname = usePathname();
  return (
    <div className="-mx-1 overflow-x-auto">
      <nav className="flex w-max gap-1 border-b border-border px-1">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm whitespace-nowrap transition ${
                active ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
              {!!t.count && <span className="brand-gradient rounded-full px-1.5 text-[11px] font-bold text-brand-ink">{t.count}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
