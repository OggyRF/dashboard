import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, ExternalLink } from "lucide-react";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { ClientPropertyForm, SyncNowButton } from "@/components/google-forms";
import { TrendChart } from "@/components/trend-chart";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { formatDayKey, formatMonth, shiftMonth } from "@/lib/dates";
import { GoogleError, googleConfigured, type GscSite } from "@/lib/google/api";
import { countryName, deviceName, formatCount, formatCtr, formatPosition, siteLabel, syncLabel } from "@/lib/gsc-labels";
import { formatDateTime } from "@/lib/time";
import { getClient } from "@/services/clients";
import { isGoogleConnected, listProperties, suggestProperty } from "@/services/google";
import { RANGES, clientSearchConsole, type BreakdownRow, type Totals } from "@/services/gsc";

export const maxDuration = 60;

export default async function SearchConsolePage({ params, searchParams }: PageProps<"/clients/[clientId]/search-console">) {
  const user = await requireUser();
  const { clientId } = await params;
  const query = await searchParams;
  const { client, access } = await getClient(user, clientId);
  if (access !== "full") redirect(`/clients/${clientId}`);
  const view = await clientSearchConsole(user, clientId, { range: String(query.range ?? ""), month: String(query.month ?? "") });
  const canEdit = can(user.role, "clients.edit");
  const base = `/clients/${clientId}/search-console`;

  // Picking (or changing) the property.
  if (!view.source || query.change) {
    const connected = googleConfigured() && (await isGoogleConnected());
    let sites: GscSite[] = [];
    let error: string | null = null;
    if (connected && canEdit) {
      try {
        sites = await listProperties(user);
      } catch (e) {
        if (!(e instanceof GoogleError)) throw e;
        error = e.message;
      }
    }
    return (
      <section className="card max-w-xl space-y-3">
        <h2 className="text-lg font-bold">{view.source ? "Change Search Console property" : "Link Search Console"}</h2>
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
            <p className="text-sm text-muted">Pick this client&apos;s property. Its last 16 months of data are then pulled in the background.</p>
            <ClientPropertyForm clientId={clientId} sites={sites} current={view.source?.externalId ?? ""} suggested={suggestProperty(client.website, sites.map((s) => s.siteUrl))} />
          </>
        )}
        {view.source && <Link href={base} className="inline-block text-sm text-muted hover:text-brand">← Back to the data</Link>}
      </section>
    );
  }

  const status = syncLabel(view.source);
  const href = (changes: Record<string, string>) => `${base}?${new URLSearchParams({ range: view.range, ...(("month" in view && view.month) ? { month: view.month } : {}), ...changes })}`;

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{siteLabel(view.source.externalId)}</span>
            <a href={`https://search.google.com/search-console?resource_id=${encodeURIComponent(view.source.externalId)}`} target="_blank" rel="noreferrer" className="text-muted hover:text-brand" title="Open in Search Console">
              <ExternalLink className="h-4 w-4" />
            </a>
            {canEdit && <Link href={`${base}?change=1`} className="text-sm text-brand hover:underline">Change</Link>}
          </div>
          <div className={`text-sm ${status.tone === "danger" ? "text-danger" : status.tone === "success" ? "text-success" : "text-muted"}`}>
            {status.text}
            {view.source.lastSyncAt && <span className="text-muted"> · last pulled {formatDateTime(view.source.lastSyncAt)}</span>}
          </div>
        </div>
        {can(user.role, "google.syncNow") && <SyncNowButton clientId={clientId} />}
      </section>

      {!view.latest ? (
        <section className="card text-sm text-muted">No data yet. It appears here after the first pull; press Sync now to start it straight away.</section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(RANGES).map(([key, r]) => (
                <Link key={key} href={href({ range: key })} className={`rounded-full border px-3 py-1 text-sm transition ${view.range === key ? "border-brand bg-brand text-white" : "border-border bg-surface hover:border-brand"}`}>
                  {r.label}
                </Link>
              ))}
            </div>
            <p className="text-xs text-muted">
              {formatDayKey(view.window.start, { day: "numeric", month: "short", year: "numeric" })} – {formatDayKey(view.window.end, { day: "numeric", month: "short", year: "numeric" })}, compared with the period before
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Clicks" value={formatCount(view.totals.clicks)} now={view.totals.clicks} before={view.previous?.clicks} tone="brand" />
            <Stat label="Impressions" value={formatCount(view.totals.impressions)} now={view.totals.impressions} before={view.previous?.impressions} />
            <Stat label="Average CTR" value={formatCtr(view.totals.ctr)} now={view.totals.ctr} before={view.previous?.ctr} />
            <Stat label="Average position" value={formatPosition(view.totals.position)} now={view.totals.position} before={view.previous?.position} lowerIsBetter />
          </div>

          <section className="card">
            <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-brand" />Clicks</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-foreground/55" />Impressions</span>
              {view.bucket > 1 && <span className="text-muted">Shown by week</span>}
            </div>
            <TrendChart points={view.series} weekly={view.bucket > 1} />
          </section>

          {view.month && view.breakdowns && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Top searches and pages</h2>
                <form className="flex items-center gap-2">
                  <input type="hidden" name="range" value={view.range} />
                  <label htmlFor="month" className="text-sm text-muted">Month</label>
                  <AutoSubmitSelect id="month" name="month" defaultValue={view.month} className="field w-auto py-1.5">
                    {view.months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
                  </AutoSubmitSelect>
                  <noscript><button type="submit" className="btn-secondary">Show</button></noscript>
                </form>
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <Breakdown title="Searches" head="Search" rows={view.breakdowns.queries} month={view.month} expand />
                <Breakdown title="Pages" head="Page" rows={view.breakdowns.pages} month={view.month} label={(k) => k.replace(/^https?:\/\/[^/]+/, "") || "/"} />
                <Breakdown title="Devices" head="Device" rows={view.breakdowns.devices} month={view.month} label={deviceName} />
                <Breakdown title="Countries" head="Country" rows={view.breakdowns.countries} month={view.month} label={countryName} />
              </div>
              <p className="text-xs text-muted">
                Searches Google keeps private are not listed, so rows add up to less than the totals above. Older months keep the top 100 rows; the last 3 months keep the top 500.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, now, before, tone, lowerIsBetter = false }: { label: string; value: string; now: number; before?: number; tone?: "brand"; lowerIsBetter?: boolean }) {
  let change: { text: string; good: boolean; up: boolean } | null = null;
  if (before !== undefined && before > 0) {
    const pct = ((now - before) / before) * 100;
    if (Math.abs(pct) >= 0.05) change = { text: `${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`, up: pct > 0, good: lowerIsBetter ? pct < 0 : pct > 0 };
  }
  return (
    <div className={`card ${tone === "brand" ? "brand-gradient text-brand-ink" : ""}`}>
      <div className={`text-xs font-semibold tracking-wide uppercase ${tone ? "opacity-80" : "text-muted"}`}>{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {change ? (
        <div className={`mt-1 inline-flex items-center gap-0.5 text-xs font-semibold ${tone ? "" : change.good ? "text-success" : "text-danger"}`}>
          {change.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {change.text}
        </div>
      ) : (
        <div className={`mt-1 text-xs ${tone ? "opacity-80" : "text-muted"}`}>{before === undefined ? "No earlier data" : "No change"}</div>
      )}
    </div>
  );
}

// "+15 vs Sept": this row's clicks against the month before.
function Change({ now, before, month }: { now: number; before: number | null; month: string }) {
  if (before === null) return null;
  const diff = now - before;
  return (
    <span className={`text-xs whitespace-nowrap ${diff > 0 ? "text-success" : diff < 0 ? "text-danger" : "text-muted"}`} title="Clicks compared with the month before">
      {diff > 0 ? "+" : diff < 0 ? "−" : "±"}{formatCount(Math.abs(diff), true)} vs {formatMonth(shiftMonth(month, -1)).split(" ")[0]}
    </span>
  );
}

function Metrics({ row }: { row: Totals }) {
  return (
    <>
      <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCount(row.clicks, true)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatCount(row.impressions, true)}</td>
      <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{formatCtr(row.ctr)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatPosition(row.position)}</td>
    </>
  );
}

function Breakdown({ title, head, rows, month, label = (k) => k, expand = false }: { title: string; head: string; rows: BreakdownRow[]; month: string; label?: (key: string) => string; expand?: boolean }) {
  const showChange = rows.some((r) => r.prevClicks !== null);
  return (
    <section className="card overflow-hidden p-0">
      <h3 className="border-b border-border px-4 py-3 font-bold">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Nothing this month.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{head}</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">Clicks</th>
                <th className="w-16 px-2 py-2 text-right font-semibold">Impr.</th>
                <th className="hidden w-16 px-2 py-2 text-right font-semibold sm:table-cell">CTR</th>
                <th className="w-14 px-2 py-2 text-right font-semibold">Pos.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key} className="align-top">
                  <td className="px-3 py-2">
                    {expand && r.pages?.length ? (
                      <details>
                        <summary className="cursor-pointer truncate" title={r.key}>{label(r.key)}</summary>
                        <ul className="mt-1 space-y-0.5 text-xs text-muted">
                          {r.pages.map((p) => (
                            <li key={p.key} className="truncate" title={p.key}>
                              {p.key.replace(/^https?:\/\/[^/]+/, "") || "/"} · {formatCount(p.clicks)} clicks · pos {formatPosition(p.position)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <div className="truncate" title={r.key}>{label(r.key)}</div>
                    )}
                    {showChange && <Change now={r.clicks} before={r.prevClicks} month={month} />}
                  </td>
                  <Metrics row={r} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
