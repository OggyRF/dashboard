import type { Permission } from "@/lib/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  permission: Permission;
  // Phase of the plan in which the page is built; shown on placeholders.
  phase: number;
};

// Sidebar from section 5 of the plan. Items a role cannot use are hidden;
// the server checks permissions again on every page and action.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", permission: "attendance.own", phase: 0 },
  { href: "/attendance", label: "Attendance", permission: "attendance.own", phase: 1 },
  { href: "/leave", label: "Leave", permission: "leave.apply", phase: 1 },
  { href: "/messages", label: "Messages", permission: "messages.sendToOwners", phase: 1 },
  { href: "/chat", label: "Chat", permission: "chat.use", phase: 2 },
  { href: "/clients", label: "Clients", permission: "clients.viewAssigned", phase: 2 },
  { href: "/tasks", label: "Tasks", permission: "tasks.manage", phase: 2 },
  { href: "/off-page", label: "Off-page", permission: "offpage.tick", phase: 2 },
  { href: "/poa", label: "POA", permission: "strategy.view", phase: 5 },
  { href: "/rankings", label: "Rankings", permission: "strategy.view", phase: 5 },
  { href: "/reports", label: "Reports", permission: "reports.edit", phase: 9 },
  { href: "/team", label: "Team", permission: "users.manage", phase: 0 },
  { href: "/settings", label: "Settings", permission: "settings.manage", phase: 0 },
];

export function navItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item ${href}`);
  return item;
}
