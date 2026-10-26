import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { AppError } from "@/lib/errors";
import { SeoToolError } from "@/lib/seo-tools";
import { getClient } from "@/services/clients";
import { clientBacklinks } from "@/services/insights";

export const maxDuration = 60;

export default async function BacklinksPage({ params, searchParams }: PageProps<"/clients/[clientId]/insights/backlinks">) {
  const user = await requireUser();
  const { clientId } = await params;
  const query = await searchParams;
  const { access } = await getClient(user, clientId);
  if (access !== "full") redirect(`/clients/${clientId}`);
  const after = typeof query.after === "string" ? query.after : null;
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const back = `/clients/${clientId}/insights`;

  let data: Awaited<ReturnType<typeof clientBacklinks>> | null = null;
  let error: string | null = null;
  try {
    data = await clientBacklinks(user, clientId, after);
  } catch (e) {
    if (!(e instanceof AppError) && !(e instanceof SeoToolError)) throw e;
    error = e.message;
  }

  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm text-muted hover:underline">← Website insights</Link>
      {error || !data ? (
        <p role="alert" className="card text-sm text-danger">{error}</p>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-bold">Backlinks to {data.domain}</h2>
            <p className="text-sm text-muted">From Moz, strongest sites first, 50 per page (links {(page - 1) * 50 + 1}–{(page - 1) * 50 + data.links.length}).</p>
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[44rem] table-fixed text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Linking page</th>
                  <th className="w-56 px-2 py-2 font-medium">Anchor text</th>
                  <th className="w-14 px-2 py-2 text-right font-medium">DA</th>
                  <th className="w-24 px-2 py-2 font-medium">Type</th>
                  <th className="w-28 px-4 py-2 font-medium">First seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.links.map((l, i) => (
                  <tr key={`${l.source}-${i}`}>
                    <td className="truncate px-4 py-2" title={l.source}>
                      <a href={/^https?:\/\//.test(l.source) ? l.source : `https://${l.source}`} target="_blank" rel="noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 hover:text-brand">
                        <span className="truncate">{l.source.replace(/^https?:\/\//, "")}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </td>
                    <td className="truncate px-2 py-2" title={l.anchor}>{l.anchor || <span className="text-muted">(no text)</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.da ?? "–"}</td>
                    <td className="px-2 py-2">{l.nofollow ? "Nofollow" : "Follow"}</td>
                    <td className="px-4 py-2 text-muted">{l.firstSeen ?? "–"}</td>
                  </tr>
                ))}
                {data.links.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Moz has no backlinks listed for this site.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            {page > 1 && <Link href={`${back}/backlinks`} className="btn-secondary">Back to first page</Link>}
            {data.next && <Link href={`${back}/backlinks?${new URLSearchParams({ after: data.next, page: String(page + 1) })}`} className="btn-secondary">Next 50</Link>}
          </div>
        </>
      )}
    </div>
  );
}
