import { can, type Permission } from "@/lib/auth/permissions";
import type { Role } from "@/generated/prisma/enums";

export type NavItem = {
  href: string;
  label: string;
  // Shown when the role has any of these.
  permission: Permission | Permission[];
  // Name of the count shown beside the item, when it has one.
  badge?: "leave" | "messages" | "chat";
  // Phase of the plan in which the page is built; shown on placeholders.
  phase: number;
};

// Sidebar from section 5 of the plan. Items a role cannot use are hidden;
// the server checks permissions again on every page and action.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", permission: "dashboard.view", phase: 0 },
  { href: "/attendance", label: "Attendance", permission: ["attendance.own", "attendance.viewAll"], phase: 1 },
  { href: "/leave", label: "Leave", permission: "leave.apply", phase: 1, badge: "leave" },
  { href: "/messages", label: "Messages", permission: "messages.sendToOwners", phase: 1, badge: "messages" },
  { href: "/chat", label: "Chat", permission: "chat.use", phase: 2, badge: "chat" },
  { href: "/clients", label: "Clients", permission: "clients.browse", phase: 2 },
  { href: "/tasks", label: "Tasks", permission: "tasks.manage", phase: 2 },
  { href: "/daily", label: "Daily task", permission: ["daily.own", "daily.assign"], phase: 2 },
  { href: "/off-page", label: "Off-page", permission: "offpage.tick", phase: 2 },
  { href: "/poa", label: "POA", permission: "strategy.view", phase: 5 },
  { href: "/rankings", label: "Rankings", permission: "strategy.view", phase: 5 },
  { href: "/reports", label: "Reports", permission: "reports.edit", phase: 9 },
  { href: "/team", label: "Team", permission: "users.manage", phase: 0 },
  { href: "/settings", label: "Settings", permission: "settings.manage", phase: 0 },
];

export function canSee(role: Role, item: NavItem): boolean {
  const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
  return needed.some((p) => can(role, p));
}

export function navItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item ${href}`);
  return item;
}
