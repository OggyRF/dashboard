import type { Role } from "@/generated/prisma/enums";

// Role-level permissions from section 4 of the architecture plan. Client-scoped
// checks (assigned clients) are added on top of these when clients exist.
export const PERMISSIONS = {
  "attendance.own": ["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"],
  "attendance.viewAll": ["OWNER"],
  "attendance.correct": ["OWNER"],
  "leave.apply": ["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"],
  "leave.approve": ["OWNER"],
  "messages.sendToOwners": ["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"],
  "messages.ownerInbox": ["OWNER"],
  "chat.use": ["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"],
  "users.manage": ["OWNER"],
  "clients.viewAll": ["OWNER", "STRATEGY"],
  "clients.viewAssigned": ["OWNER", "STRATEGY", "EXECUTION"],
  "clients.edit": ["OWNER", "STRATEGY", "EXECUTION"],
  "offpage.plan": ["OWNER", "STRATEGY", "EXECUTION"],
  "offpage.tick": ["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"],
  "offpage.review": ["OWNER", "STRATEGY", "EXECUTION"],
  "google.connect": ["OWNER", "STRATEGY"],
  "google.syncNow": ["OWNER", "STRATEGY", "EXECUTION"],
  "strategy.edit": ["OWNER", "STRATEGY"],
  "strategy.view": ["OWNER", "STRATEGY", "EXECUTION"],
  "tasks.manage": ["OWNER", "STRATEGY", "EXECUTION"],
  "tasks.qa": ["OWNER", "STRATEGY", "EXECUTION"],
  "seoRecords.edit": ["OWNER", "STRATEGY", "EXECUTION"],
  "reports.edit": ["OWNER", "STRATEGY"],
  "reports.approve": ["OWNER", "STRATEGY"],
  "audit.view": ["OWNER"],
  "settings.manage": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  STRATEGY: "Strategy",
  EXECUTION: "Execution",
  OFFPAGE: "Off-page",
};
