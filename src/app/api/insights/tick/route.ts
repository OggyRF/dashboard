import { getCurrentUser } from "@/lib/auth/current-user";
import { runWebsiteChecks } from "@/services/insights";

export const maxDuration = 60;

// Called in the background by open dashboards: checks the next client's
// website (Moz and PageSpeed) if this month's figures are still missing.
export async function POST() {
  if (!(await getCurrentUser())) return new Response(null, { status: 401 });
  try {
    const result = await runWebsiteChecks({ budgetMs: 50_000 });
    return Response.json(result);
  } catch (e) {
    console.error("Website check failed", e);
    return Response.json({ checked: 0 }, { status: 500 });
  }
}
