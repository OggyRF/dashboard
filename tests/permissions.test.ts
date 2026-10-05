import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, type Permission } from "@/lib/auth/permissions";

type Role = "OWNER" | "STRATEGY" | "EXECUTION" | "OFFPAGE";
const ROLES: Role[] = ["OWNER", "STRATEGY", "EXECUTION", "OFFPAGE"];

// The expected matrix, written out by hand from section 4 of the plan. If a
// change to PERMISSIONS widens or narrows access, this test fails.
const EXPECTED: Record<Permission, Role[]> = {
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
};

describe("permission matrix", () => {
  it("covers every permission", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const permission of Object.keys(EXPECTED) as Permission[]) {
    for (const role of ROLES) {
      const allowed = EXPECTED[permission].includes(role);
      it(`${role} ${allowed ? "can" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(allowed);
      });
    }
  }
});
