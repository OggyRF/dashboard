"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { checkWebsiteNow, saveWebsiteMetrics } from "@/services/insights";
import { errorMessage, type ActionResult } from "./helpers";

export async function checkWebsiteAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(f.get("clientId"));
  let result;
  try {
    result = await checkWebsiteNow(user, clientId);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/clients/${clientId}/insights`);
  return result.ok ? { ok: "Checked. This month's figures are updated." } : { error: result.errors.join(" ") };
}

export async function saveWebsiteMetricsAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(f.get("clientId"));
  try {
    await saveWebsiteMetrics(user, clientId, Object.fromEntries([...f.entries()].filter(([k]) => k !== "clientId")), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/clients/${clientId}/insights`);
  return { ok: "Saved." };
}
