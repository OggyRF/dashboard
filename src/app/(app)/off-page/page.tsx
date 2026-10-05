import { ComingSoon } from "@/components/coming-soon";
import { requirePermission } from "@/lib/auth/current-user";

export default async function Page() {
  await requirePermission("offpage.tick");
  return <ComingSoon href="/off-page" />;
}
