import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, PlugZap } from "lucide-react";
import { DisconnectButton, PropertyBoardForm, SyncNowButton, type BoardRow } from "@/components/google-forms";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { siteChoices, syncLabel } from "@/lib/gsc-labels";
import { formatDateTime } from "@/lib/time";
import { GoogleError, type Ga4Property, type GscSite } from "@/lib/google/api";
import { googleStatus, listAnalyticsProperties, listProperties, propertyBoard, suggestGa4Property, suggestProperty } from "@/services/google";

export const metadata: Metadata = { title: "Google" };
export const maxDuration = 60;

const ERRORS: Record<string, string> = {
  keys: "The Google keys are not in Vercel yet, so connecting is not possible.",
  state: "The connection took too long or was opened twice. Please press Connect again.",
  denied: "Google access was not allowed. Press Connect again and tick Search Console access.",
};

export default async function GooglePage({ searchParams }: PageProps<"/settings/google">) {
  const user = await requirePermission("google.connect");
  const query = await searchParams;
  const { configured, connection } = await googleStatus(user);
  const connected = !!connection && !connection.brokenAt;
  let sites: GscSite[] = [];
  let sitesError: string | null = null;
  if (connected) {
    try {
      sites = await listProperties(user);
    } catch (e) {
      if (!(e instanceof GoogleError)) throw e;
      sitesError = e.message;
    }
  }
  // Analytics is listed separately: a connection made before GA4 was added
  // still works for Search Console until it is reconnected.
  let ga4: Ga4Property[] | null = null;
  let ga4Error: string | null = null;
  if (connected) {
    try {
      ga4 = await listAnalyticsProperties(user);
    } catch (e) {
      if (!(e instanceof GoogleError)) throw e;
      ga4Error = e.status === 403 ? "Press Reconnect above once to also allow Google Analytics. Search Console keeps working meanwhile." : e.message;
    }
  }
  const board = connected ? await propertyBoard(user) : [];
  const siteUrls = sites.map((s) => s.siteUrl);
  const rows: BoardRow[] = board.map((c) => ({
    id: c.id,
    name: c.name,
    website: c.website,
    current: c.source?.externalId ?? "",
    suggested: c.source ? null : suggestProperty(c.website, siteUrls),
    status: c.source ? syncLabel(c.source).text : "",
    ga4: c.ga4,
    ga4Suggested: c.ga4 || !ga4 ? null : suggestGa4Property(c.name, c.website, ga4),
  }));
  const linked = board.filter((c) => c.source).length;
  const errorText = typeof query.error === "string" ? (query.error === "google" ? String(query.message ?? "Google returned an error.") : ERRORS[query.error]) : null;

  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/settings" className="text-sm text-muted hover:underline">← Settings</Link>
      <div>
        <h1 className="page-title">Google</h1>
        <p className="text-sm text-muted">One agency Google account reads every client&apos;s Search Console and Google Analytics. Access is read-only: the dashboard can never change anything in Google.</p>
      </div>
      {query.connected && <p className="card border-success/40 text-sm text-success">Google connected. Now link each client to its property below.</p>}
      {errorText && <p role="alert" className="card border-danger/40 text-sm text-danger">{errorText}</p>}

      <section className="card space-y-3">
        {!configured ? (
          <>
            <div className="flex items-center gap-2 font-semibold"><PlugZap className="h-5 w-5 text-muted" />Waiting for the Google keys</div>
            <p className="text-sm text-muted">
              Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>TOKEN_ENCRYPTION_KEY</code> in Vercel under Settings › Environment Variables, then redeploy. The steps are in the project chat.
            </p>
          </>
        ) : connected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-success" />Connected as {connection.email}</div>
              <div className="flex items-center gap-4">
                <a href="/api/google/connect" className="text-sm font-medium text-brand hover:underline">Reconnect</a>
                <DisconnectButton />
              </div>
            </div>
            <p className="text-sm text-muted">Since {formatDateTime(connection.connectedAt)}. {linked} of {board.length} clients linked. New data is pulled every night and while the team is using the dashboard.</p>
            {can(user.role, "google.syncNow") && linked > 0 && <SyncNowButton label="Sync all now" />}
          </>
        ) : (
          <>
            {connection?.brokenAt ? (
              <div className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle className="h-5 w-5" />Google stopped accepting the connection for {connection.email}</div>
            ) : (
              <div className="flex items-center gap-2 font-semibold"><PlugZap className="h-5 w-5 text-muted" />Not connected</div>
            )}
            <p className="text-sm text-muted">Sign in with the agency Gmail that has access to your clients&apos; Search Console and Google Analytics. You will be asked to allow read-only access.</p>
            <a href="/api/google/connect" className="btn-primary inline-flex">{connection ? "Reconnect Google" : "Connect Google"}</a>
          </>
        )}
      </section>

      {connected && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">Link clients to their Google properties</h2>
            <p className="text-sm text-muted">
              {sites.length} Search Console{ga4 ? ` and ${ga4.length} Google Analytics` : ""} properties found in this Google account. Matches from each client&apos;s website are filled in for you; check them and press Save all. Missing a property? Add {connection.email} as a user on it in Search Console or Google Analytics, then reload this page.
            </p>
          </div>
          {ga4Error && <p role="alert" className="card border-warning/40 text-sm">{ga4Error}</p>}
          {sitesError ? (
            <p role="alert" className="text-sm text-danger">{sitesError}</p>
          ) : (
            <PropertyBoardForm rows={rows} sites={siteChoices(sites)} ga4={ga4 && ga4.map((p) => ({ value: p.property, label: ga4Label(p) }))} />
          )}
        </section>
      )}
    </div>
  );
}

function ga4Label(p: Ga4Property) {
  return p.account && p.account !== p.name ? `${p.name} (${p.account})` : p.name;
}
