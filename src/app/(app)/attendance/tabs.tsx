import { Tabs } from "@/components/tabs";

export function AttendanceTabs({ active, owner }: { active: string; owner: boolean }) {
  const tabs = [{ href: "/attendance", label: "My attendance" }];
  if (owner) tabs.push({ href: "/attendance/team", label: "Team" });
  return <Tabs tabs={tabs} active={active} />;
}
