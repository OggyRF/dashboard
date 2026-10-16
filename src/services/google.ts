import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { istDateKey, shiftMonth } from "@/lib/dates";
import { forbidden } from "@/lib/errors";
import { GoogleError, accessToken, googleConfigured, listGa4Properties, listSites, revokeToken, type Ga4Property, type GscSite } from "@/lib/google/api";
import { decryptSecret, encryptSecret } from "@/lib/google/crypto";
import type { SessionUser } from "@/services/auth";
import { logActivity, requireClient } from "@/services/clients";
import { activeOwnerIds, notify } from "@/services/notifications";

// ---------------------------------------------------------------------------
// The agency Google connection
// ---------------------------------------------------------------------------

export async function googleStatus(actor: SessionUser) {
  if (!can(actor.role, "google.connect") && !can(actor.role, "google.syncNow")) throw forbidden();
  const connection = await db.googleConnection.findUnique({
    where: { id: "agency" },
    select: { email: true, connectedAt: true, brokenAt: true, lastError: true },
  });
  return { configured: googleConfigured(), connection };
}

export async function isGoogleConnected() {
  return !!(await db.googleConnection.findFirst({ where: { brokenAt: null }, select: { id: true } }));
}

// Called by the OAuth callback after Google hands back a refresh token.
export async function saveConnection(actor: SessionUser, email: string, refreshToken: string, ip: string | null) {
  if (!can(actor.role, "google.connect")) throw forbidden();
  const refreshTokenEnc = encryptSecret(refreshToken);
  await db.$transaction(async (tx) => {
    const before = await tx.googleConnection.findUnique({ where: { id: "agency" }, select: { email: true } });
    await tx.googleConnection.upsert({
      where: { id: "agency" },
      create: { email, refreshTokenEnc, connectedById: actor.id },
      update: { email, refreshTokenEnc, connectedById: actor.id, connectedAt: new Date(), brokenAt: null, lastError: null },
    });
    // Sources that failed while the connection was down get another go.
    await tx.clientDataSource.updateMany({ where: { lastError: { not: null } }, data: { lastError: null } });
    await writeAudit(tx, { actorId: actor.id, action: "google.connect", entityType: "GoogleConnection", entityId: "agency", before: before ?? undefined, after: { email }, ip });
  });
}

export async function disconnectGoogle(actor: SessionUser, ip: string | null) {
  if (!can(actor.role, "google.connect")) throw forbidden();
  const connection = await db.googleConnection.findUnique({ where: { id: "agency" } });
  if (!connection) return;
  await db.$transaction(async (tx) => {
    await tx.googleConnection.delete({ where: { id: "agency" } });
    await writeAudit(tx, { actorId: actor.id, action: "google.disconnect", entityType: "GoogleConnection", entityId: "agency", before: { email: connection.email }, ip });
  });
  // Also tell Google to forget the sign-in. Saved data stays.
  try {
    await revokeToken(decryptSecret(connection.refreshTokenEnc));
  } catch {}
}

// A fresh access token for the agency account. When Google rejects the saved
// sign-in, the connection is marked broken and the owners are told once.
export async function googleAccessToken(): Promise<string> {
  const connection = await db.googleConnection.findUnique({ where: { id: "agency" } });
  if (!connection || connection.brokenAt) throw new GoogleError("Google is not connected.", 0);
  try {
    return await accessToken(decryptSecret(connection.refreshTokenEnc));
  } catch (e) {
    if (e instanceof GoogleError && e.tokenRevoked) {
      await db.$transaction(async (tx) => {
        await tx.googleConnection.update({ where: { id: "agency" }, data: { brokenAt: new Date(), lastError: e.message } });
        await notify(tx, await activeOwnerIds(tx), "Google connection stopped working. Reconnect it in Settings > Google.", "/settings/google");
      });
    }
    throw e;
  }
}

export async function listProperties(actor: SessionUser): Promise<GscSite[]> {
  if (!can(actor.role, "google.connect") && !can(actor.role, "clients.edit")) throw forbidden();
  return listSites(await googleAccessToken());
}

export async function listAnalyticsProperties(actor: SessionUser): Promise<Ga4Property[]> {
  if (!can(actor.role, "google.connect") && !can(actor.role, "clients.edit")) throw forbidden();
  return listGa4Properties(await googleAccessToken());
}

// ---------------------------------------------------------------------------
// Which Search Console property belongs to which client
// ---------------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// Best property for a client's website: the domain property first, then the
// exact URL-prefix property (with or without www).
export function suggestProperty(website: string | null, sites: string[]): string | null {
  const host = website ? hostOf(website) : "";
  if (!host) return null;
  const domain = sites.find((s) => s === `sc-domain:${host}`);
  if (domain) return domain;
  return sites.find((s) => s.startsWith("http") && hostOf(s) === host) ?? null;
}

const propertySchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^sc-domain:[a-z0-9.-]+$/i.test(v) || /^https?:\/\/\S+\/$/.test(v), "That is not a Search Console property.");

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

// GA4 properties have no website on them, so match on their name: the
// website's main word ("iitb" for iitb.ac.in) or the client's name.
export function suggestGa4Property(clientName: string, website: string | null, properties: Ga4Property[]): string | null {
  const word = squash((website ? hostOf(website) : "").split(".")[0] ?? "");
  const name = squash(clientName);
  const hit = (p: Ga4Property) => {
    const n = squash(p.name);
    return (word.length >= 3 && n.includes(word)) || (name.length >= 3 && (n.includes(name) || name.includes(n)));
  };
  return properties.find(hit)?.property ?? null;
}

const ga4Schema = z
  .string()
  .trim()
  .max(60)
  .refine((v) => v === "" || /^properties\/\d+$/.test(v), "That is not a Google Analytics property.");

export type PropertyKind = "GSC" | "GA4";

// How far back history is pulled: Search Console keeps 16 months.
export const HISTORY_MONTHS = 16;

export function historyStartMonth(todayKey: string) {
  return shiftMonth(todayKey.slice(0, 7), -(HISTORY_MONTHS - 1));
}

// Sets (or clears, with "") a client's Search Console or GA4 property.
// Changing a Search Console property drops the old data and starts a fresh pull.
export async function setClientProperty(actor: SessionUser, clientId: string, input: unknown, ip: string | null, now = new Date(), kind: PropertyKind = "GSC") {
  if (!can(actor.role, "clients.edit")) throw forbidden();
  const siteUrl = (kind === "GA4" ? ga4Schema : propertySchema).parse(input);
  const gsc = kind === "GSC";
  await requireClient(actor, clientId);
  return db.$transaction(async (tx) => {
    const current = await tx.clientDataSource.findUnique({ where: { clientId_kind: { clientId, kind } } });
    if ((current?.externalId ?? "") === siteUrl) return false;
    if (current) await tx.clientDataSource.delete({ where: { id: current.id } });
    if (siteUrl) {
      await tx.clientDataSource.create({
        data: { clientId, kind, externalId: siteUrl, createdById: actor.id, backfillMonth: gsc ? shiftMonth(istDateKey(now).slice(0, 7), -1) : null },
      });
    }
    await writeAudit(tx, { actorId: actor.id, action: gsc ? "client.gscProperty" : "client.ga4Property", entityType: "Client", entityId: clientId, before: { property: current?.externalId ?? null }, after: { property: siteUrl || null }, ip });
    const product = gsc ? "Search Console" : "Google Analytics";
    await logActivity(tx, clientId, actor.id, gsc ? "gsc.property" : "ga4.property", siteUrl ? `${product} linked to ${siteUrl}` : `${product} unlinked`, `/clients/${clientId}/${gsc ? "search-console" : "analytics"}`);
    return true;
  });
}

const manySchema = z.array(z.object({ clientId: z.string().min(1), property: z.string(), kind: z.enum(["GSC", "GA4"]).default("GSC") })).max(1000);

export async function setManyProperties(actor: SessionUser, input: unknown, ip: string | null, now = new Date()) {
  const pairs = manySchema.parse(input);
  let changed = 0;
  for (const pair of pairs) {
    if (await setClientProperty(actor, pair.clientId, pair.property, ip, now, pair.kind)) changed++;
  }
  return changed;
}

// Every client with its current property, for the matching table in Settings.
export async function propertyBoard(actor: SessionUser) {
  if (!can(actor.role, "google.connect")) throw forbidden();
  const clients = await db.client.findMany({
    where: { status: { not: "CHURNED" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      website: true,
      dataSources: { select: { kind: true, externalId: true, lastSyncAt: true, lastError: true, recentSyncedOn: true, backfillMonth: true } },
    },
  });
  return clients.map(({ dataSources, ...c }) => ({
    ...c,
    source: dataSources.find((d) => d.kind === "GSC") ?? null,
    ga4: dataSources.find((d) => d.kind === "GA4")?.externalId ?? "",
  }));
}

