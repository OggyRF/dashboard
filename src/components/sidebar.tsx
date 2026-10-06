"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  CalendarDays,
  ClipboardList,
  ListChecks,
  Clock3,
  FileText,
  Hash,
  House,
  Link2,
  Mail,
  Settings,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  "/": House,
  "/attendance": Clock3,
  "/leave": CalendarDays,
  "/messages": Mail,
  "/chat": Hash,
  "/clients": Briefcase,
  "/tasks": ClipboardList,
  "/daily": ListChecks,
  "/off-page": Link2,
  "/poa": Target,
  "/rankings": BarChart3,
  "/reports": FileText,
  "/team": Users,
  "/settings": Settings,
};

// Phases already built; later items show a "Soon" tag.
const BUILT_PHASE = 2;

export function Sidebar({
  items,
  badges,
  layout = "column",
}: {
  items: NavItem[];
  badges: Partial<Record<"leave" | "messages" | "chat", number>>;
  layout?: "column" | "row";
}) {
  const pathname = usePathname();
  const countFor = (item: NavItem) => (item.badge ? badges[item.badge] ?? 0 : 0);
  const row = layout === "row";

  return (
    <nav className={row ? "flex gap-1 p-2 text-sm" : "flex flex-col gap-1 px-3 py-4 text-sm"}>
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const count = countFor(item);
        const Icon = ICONS[item.href] ?? House;
        const soon = item.phase > BUILT_PHASE;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 whitespace-nowrap transition ${
              row
                ? active
                  ? "bg-brand/10 font-semibold text-brand"
                  : "text-muted hover:bg-background"
                : active
                  ? "bg-brand font-semibold text-white shadow-[0_8px_20px_-10px_var(--brand)]"
                  : "text-white/65 hover:bg-white/6 hover:text-white"
            }`}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            <span className="flex-1">{item.label}</span>
            {count > 0 ? (
              <span className={`rounded-full px-2 text-xs font-bold ${active && !row ? "bg-white text-brand" : "brand-gradient text-brand-ink"}`}>{count}</span>
            ) : (
              soon && !row && <span className="text-[10px] font-medium tracking-wide text-white/35 uppercase">Soon</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
