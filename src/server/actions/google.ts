"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { GoogleError } from "@/lib/google/api";
import { requireClient } from "@/services/clients";
import { disconnectGoogle, setClientProperty, setManyProperties } from "@/services/google";
import { runGscSync } from "@/services/gsc-sync";
import { errorMessage, type ActionResult } from "./helpers";

function googleMessage(e: unknown) {
  return e instanceof GoogleError ? e.message : errorMessage(e);
}

export async function disconnectGoogleAction(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await disconnectGoogle(user, (await requestMeta()).ip);
  } catch (e) {
    return { error: googleMessage(e) };
  }
  revalidatePath("/settings/google");
  return { ok: "Google disconnected. Saved data stays." };
}

export async function saveClientPropertyAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(f.get("clientId"));
  try {
    await setClientProperty(user, clientId, String(f.get("property") ?? ""), (await requestMeta()).ip);
  } catch (e) {
    return { error: googleMessage(e) };
  }
  revalidatePath(`/clients/${clientId}/search-console`);
  return { ok: "Saved. Data starts coming in now." };
}

export async function savePropertiesAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const pairs = [...f.entries()]
    .filter(([k]) => k.startsWith("p:"))
    .map(([k, v]) => ({ clientId: k.slice(2), property: String(v) }));
  let changed: number;
  try {
    changed = await setManyProperties(user, pairs, (await requestMeta()).ip);
  } catch (e) {
    return { error: googleMessage(e) };
  }
  revalidatePath("/settings/google");
  return { ok: changed ? `Saved ${changed} client${changed === 1 ? "" : "s"}. Data starts coming in now.` : "Nothing changed." };
}

// Pulls data straight away: one client's property, or everyone's.
export async function syncNowAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(f.get("clientId") ?? "");
  let result;
  try {
    if (!can(user.role, "google.syncNow")) throw forbidden();
    let sourceId: string | undefined;
    if (clientId) {
      await requireClient(user, clientId);
      sourceId = (await db.clientDataSource.findUnique({ where: { clientId_kind: { clientId, kind: "GSC" } }, select: { id: true } }))?.id;
      if (!sourceId) return { error: "Pick a Search Console property first." };
      // A manual sync retries a property that failed before.
      await db.clientDataSource.update({ where: { id: sourceId }, data: { lastError: null } });
    }
    result = await runGscSync({ budgetMs: 25_000, sourceId, force: true });
  } catch (e) {
    return { error: googleMessage(e) };
  }
  revalidatePath(clientId ? `/clients/${clientId}/search-console` : "/settings/google");
  if (result.status === "not-connected") return { error: "Google is not connected. An owner can connect it in Settings > Google." };
  if (result.status === "busy") return { ok: "A sync is already running. Refresh in a minute." };
  if (result.errors) return { error: "Google returned an error. See the message on this page." };
  return { ok: result.status === "done" ? "Up to date." : "Pulled the latest data. Older months keep loading in the background." };
}
