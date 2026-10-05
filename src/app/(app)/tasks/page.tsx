import { ComingSoon } from "@/components/coming-soon";
import { requirePermission } from "@/lib/auth/current-user";

export default async function Page() {
  await requirePermission("tasks.manage");
  return <ComingSoon href="/tasks" />;
}
