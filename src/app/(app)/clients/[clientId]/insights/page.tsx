import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckWebsiteButton, MonthFiguresForm } from "@/components/insight-forms";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { formatMonth } from "@/lib/dates";
import { formatCount } from "@/lib/gsc-labels";
import { mozConfigured } from "@/lib/seo-tools";
import { formatDateTime } from "@/lib/time";
import { getClient } from "@/services/clients";
import { clientInsights, type InsightRow } from "@/services/insights";

export const maxDuration = 60;

const n = (v: number | null) => (v === null ? "–" : formatCount(v));
const plain = (v: number | null) => (v === null ? "–" : v.toLocaleString("en-IN"));

export default async function InsightsPage({ params }: PageProps<"/clients/[clientId]/insights">) {
  const user = await requireUser();
  const { clientId } = await params;
  const { access } = await getClient(user, clientId);
  if (access !== "full") redirect(`/clients/${clientId}`);
  const data = await clientInsights(user, clientId);
  const canEdit = can(user.role, "clients.edit");
  const base = `/clients/${clientId}`;

  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm">
          <div className="font-semibold">Month on month</div>
          <div className="text-muted">
            {data.lastCheck ? `Website last checked ${formatDateTime(data.lastCheck)}.` : "This month's website check hasn't run yet."} DA, backlinks and spam score come from Moz; speed is Google PageSpeed (score out of 100). They are checked automatically once a month.
          </div>
          {data.lastError && <div className="text-danger">{data.lastError}</div>}
          {!mozConfigured() && <div className="text-muted">The Moz key is not added yet, so DA/PA, backlinks, ref domains and spam score are not filled in automatically.</div>}
        </div>
        {canEdit && data.client.website && <CheckWebsiteButton clientId={clientId} />}
      </section>

      {(!data.hasGa4 || !data.hasGsc || data.ga4Error) && (
        <p className="text-sm text-muted">
          {!data.hasGa4 && <>Organic and AI traffic appear once <Link href={`${base}/analytics`} className="text-brand">Google Analytics is linked</Link>. </>}
          {!data.hasGsc && <>Clicks and impressions appear once <Link href={`${base}/search-console`} className="text-brand">Search Console is linked</Link>. </>}
          {data.ga4Error && <span className="text-danger">{data.ga4Error}</span>}
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="bg-brand text-left text-xs text-white">
            <tr>
              {["Month", "Organic users", "Organic sessions", "AI traffic", "Clicks", "Impressions", "DA/PA", "Backlinks", "Ref domains", "Spam score", "Mobile speed", "Desktop speed"].map((h, i) => (
                <th key={h} className={`px-3 py-2.5 font-semibold ${i ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rows.map((r, i) => (
              <Row key={r.month} row={r} prev={data.rows[i + 1]} backlinksHref={`${base}/insights/backlinks`} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Green and red show the change from the month before. This month is counted up to yesterday. Spam score: lower is better.</p>

      {canEdit && (
        <MonthFiguresForm
          clientId={clientId}
          months={data.rows.map((r) => ({ month: r.month, label: formatMonth(r.month), da: r.da, pa: r.pa, backlinks: r.backlinks, refDomains: r.refDomains, spamScore: r.spamScore, mobileSpeed: r.mobileSpeed, desktopSpeed: r.desktopSpeed }))}
        />
      )}
    </div>
  );
}

function Cell({ now, before, text, lowerIsBetter = false }: { now: number | null; before: number | null | undefined; text: string; lowerIsBetter?: boolean }) {
  const moved = now !== null && before !== null && before !== undefined && now !== before;
  const good = moved && (lowerIsBetter ? now! < before! : now! > before!);
  return <td className={`px-3 py-2 text-right tabular-nums ${moved ? (good ? "text-success" : "text-danger") : ""}`}>{text}</td>;
}

function Row({ row: r, prev: p, backlinksHref }: { row: InsightRow; prev?: InsightRow; backlinksHref: string }) {
  return (
    <tr>
      <td className="px-3 py-2 font-semibold whitespace-nowrap">{formatMonth(r.month)}</td>
      <Cell now={r.organicUsers} before={p?.organicUsers} text={plain(r.organicUsers)} />
      <Cell now={r.organicSessions} before={p?.organicSessions} text={plain(r.organicSessions)} />
      <Cell now={r.aiSessions} before={p?.aiSessions} text={plain(r.aiSessions)} />
      <Cell now={r.clicks} before={p?.clicks} text={plain(r.clicks)} />
      <Cell now={r.impressions} before={p?.impressions} text={n(r.impressions)} />
      <Cell now={r.da} before={p?.da} text={r.da === null && r.pa === null ? "–" : `${r.da ?? "–"}/${r.pa ?? "–"}`} />
      <td className="px-3 py-2 text-right tabular-nums">
        {r.backlinks === null ? "–" : <Link href={backlinksHref} className="font-medium text-brand hover:underline">{plain(r.backlinks)}</Link>}
      </td>
      <Cell now={r.refDomains} before={p?.refDomains} text={plain(r.refDomains)} />
      <Cell now={r.spamScore} before={p?.spamScore} text={r.spamScore === null ? "–" : `${r.spamScore}%`} lowerIsBetter />
      <Cell now={r.mobileSpeed} before={p?.mobileSpeed} text={plain(r.mobileSpeed)} />
      <Cell now={r.desktopSpeed} before={p?.desktopSpeed} text={plain(r.desktopSpeed)} />
    </tr>
  );
}
