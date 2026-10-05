import { Tabs } from "@/components/tabs";

// Members see only their own record; owners see only the team.
export function AttendanceTabs({ active, owner }: { active: string; owner: boolean }) {
  const tabs = owner ? [{ href: "/attendance/team", label: "Team" }] : [{ href: "/attendance", label: "My attendance" }];
  return <Tabs tabs={tabs} active={active} />;
}
