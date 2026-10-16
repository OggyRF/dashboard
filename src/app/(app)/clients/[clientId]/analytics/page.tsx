import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { ClientPropertyForm } from "@/components/google-forms";
import { Stat } from "@/components/stat-tile";
import { TrendChart } from "@/components/trend-chart";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { formatDayKey } from "@/lib/dates";
import { GoogleError, googleConfigured, type Ga4Property } from "@/lib/google/api";
import { formatCount } from "@/lib/gsc-labels";
import { getClient } from "@/services/clients";
import { GA4_RANGES, clientAnalytics, type Ga4Row } from "@/services/ga4";
import { isGoogleConnected, listAnalyticsProperties, suggestGa4Property } from "@/services/google";

export const maxDuration = 60;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/clients/[clientId]/analytics">) {
  const user = await requireUser();
  const { clientId } = await params;
  const query = await searchParams;
  const { client, access } = await getClient(user, clientId);
  if (access !== "full") redirect(`/clients/${clientId}`);
  const data = await clientAnalytics(user, clientId, { range: String(query.range ?? "") });
  const canEdit = can(user.role, "clients.edit");
  const base = `/clients/${clientId}/analytics`;

  // Picking (or changing) the property.
  if (!data.source || query.change) {
    const connected = googleConfigured() && (await isGoogleConnected());
    let properties: Ga4Property[] = [];
    let error: string | null = null;
    if (connected && canEdit) {
      try {
        properties = await listAnalyticsProperties(user);
      } catch (e) {
        if (!(e instanceof GoogleError)) throw e;
        error = e.status === 403 ? "Google Analytics is not allowed on the Google connection yet. An owner needs to press Reconnect in Settings › Google once." : e.message;
      }
    }
    return (
      <section className="card max-w-xl space-y-3">
        <h2 className="text-lg font-bold">{data.source ? "Change Google Analytics property" : "Link Google Analytics"}</h2>
        {!connected ? (
          <p className="text-sm text-muted">
            Google is not connected yet.{" "}
            {can(user.role, "google.connect") ? <Link href="/settings/google" className="font-semibold text-brand">Connect it in Settings › Google</Link> : "An owner can connect it in Settings › Google."}
          </p>
        ) : !canEdit ? (
          <p className="text-sm text-muted">No property is linked yet. The strategist or project manager can link one.</p>
        ) : error ? (
          <p role="alert" className="text-sm text-danger">{error}</p>
        ) : (
          <>
            <p className="text-sm text-muted">Pick this client&apos;s GA4 property. Missing? Give the agency Gmail Viewer access to it in Google Analytics, then reload.</p>
            <ClientPropertyForm
              kind="GA4"
              clientId={clientId}
              choices={properties.map((p) => ({ value: p.property, label: p.account && p.account !== p.name ? `${p.name} (${p.account})` : p.name }))}
              current={data.source?.externalId ?? ""}
              suggested={suggestGa4Property(client.name, client.website, properties)}
            />
          </>
        )}
        {data.source && <Link href={base} className="inline-block text-sm text-muted hover:text-brand">← Back to the data</Link>}
      </section>
    );
  }

  const propertyId = data.source.externalId.replace("properties/", "");
  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center gap-2">
        <span className="font-semibold">GA4 property {propertyId}</span>
        <a href={`https://analytics.google.com/analytics/web/#/p${propertyId}/reports/intelligenthome`} target="_blank" rel="noreferrer" className="text-muted hover:text-brand" title="Open in Google Analytics">
          <ExternalLink className="h-4 w-4" />
        </a>
        {canEdit && <Link href={`${base}?change=1`} className="text-sm text-brand hover:underline">Change</Link>}
      </section>

      {data.error || !data.view ? (
        <section role="alert" className="card text-sm text-danger">{data.error ?? "Google Analytics returned nothing."}</section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(GA4_RANGES).map(([key, r]) => (
                <Link key={key} href={`${base}?range=${key}`} className={`rounded-full border px-3 py-1 text-sm transition ${data.range === key ? "border-brand bg-brand text-white" : "border-border bg-surface hover:border-brand"}`}>
                  {r.label}
                </Link>
              ))}
            </div>
            <p className="text-xs text-muted">
              {formatDayKey(data.view.window.start, { day: "numeric", month: "short", year: "numeric" })} – {formatDayKey(data.view.window.end, { day: "numeric", month: "short", year: "numeric" })}, compared with the period before
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Users" value={formatCount(data.view.totals.users)} now={data.view.totals.users} before={data.view.previous?.users} tone="brand" />
            <Stat label="Sessions" value={formatCount(data.view.totals.sessions)} now={data.view.totals.sessions} before={data.view.previous?.sessions} />
            <Stat label="Engagement rate" value={pct(data.view.totals.engagementRate)} now={data.view.totals.engagementRate} before={data.view.previous?.engagementRate} />
            <Stat label="Key events" value={formatCount(data.view.totals.keyEvents)} now={data.view.totals.keyEvents} before={data.view.previous?.keyEvents} />
          </div>

          <section className="card">
            <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-brand" />Sessions</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-foreground/55" />Engaged sessions</span>
              {data.view.weekly && <span className="text-muted">Shown by week</span>}
            </div>
            <TrendChart points={data.view.series} weekly={data.view.weekly} names={["Sessions", "Engaged sessions"]} />
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <RowTable title="Where visitors come from" head="Channel" rows={data.view.channels} highlight="Organic Search" />
            <RowTable title="Top pages from Google search" head="Landing page" rows={data.view.organicPages} />
          </div>
          <p className="text-xs text-muted">Read live from Google Analytics and refreshed every 30 minutes. Today is left out because Google is still counting it.</p>
        </>
      )}
    </div>
  );
}

function RowTable({ title, head, rows, highlight }: { title: string; head: string; rows: Ga4Row[]; highlight?: string }) {
  return (
    <section className="card overflow-hidden p-0">
      <h3 className="px-4 pt-4 pb-2 font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">No visits in this period.</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">{head}</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Sessions</th>
              <th className="hidden w-24 px-2 py-2 text-right font-medium sm:table-cell">Engaged</th>
              <th className="w-20 px-4 py-2 text-right font-medium">Key events</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.key} className={r.key === highlight ? "bg-brand/5 font-semibold" : ""}>
                <td className="truncate px-4 py-2" title={r.key}>{r.key || "(not set)"}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {formatCount(r.sessions)}
                  <Change now={r.sessions} before={r.prevSessions} />
                </td>
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{pct(r.engagementRate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCount(r.keyEvents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Change({ now, before }: { now: number; before: number | null }) {
  if (before === null || now === before) return null;
  const up = now > before;
  return <div className={`text-xs font-normal ${up ? "text-success" : "text-danger"}`}>{up ? "+" : "−"}{formatCount(Math.abs(now - before))}</div>;
}
