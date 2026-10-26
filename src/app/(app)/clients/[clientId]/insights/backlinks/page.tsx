import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { AppError } from "@/lib/errors";
import { SeoToolError } from "@/lib/seo-tools";
import { getClient } from "@/services/clients";
import { clientBacklinks } from "@/services/insights";

export const maxDuration = 60;

const path = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

function Outbound({ url }: { url: string }) {
  return (
    <a href={/^https?:\/\//.test(url) ? url : `https://${url}`} target="_blank" rel="noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 hover:text-brand">
      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

export default async function BacklinksPage({ params, searchParams }: PageProps<"/clients/[clientId]/insights/backlinks">) {
  const user = await requireUser();
  const { clientId } = await params;
  const query = await searchParams;
  const { access } = await getClient(user, clientId);
  if (access !== "full") redirect(`/clients/${clientId}`);
  const target = typeof query.target === "string" && query.target ? query.target : null;
  const page = Math.max(0, Number(query.page ?? 0) || 0);
  const base = `/clients/${clientId}/insights/backlinks`;
  const href = (p: number) => `${base}?${new URLSearchParams({ ...(target ? { target } : {}), page: String(p) })}`;

  let data: Awaited<ReturnType<typeof clientBacklinks>> | null = null;
  let error: string | null = null;
  try {
    data = await clientBacklinks(user, clientId, { target, page });
  } catch (e) {
    if (!(e instanceof AppError) && !(e instanceof SeoToolError)) throw e;
    error = e.message;
  }

  return (
    <div className="space-y-4">
      <Link href={target ? base : `/clients/${clientId}/insights`} className="text-sm text-muted hover:underline">
        ← {target ? "All linked pages" : "Website insights"}
      </Link>
      {error || !data ? (
        <p role="alert" className="card text-sm text-danger">{error}</p>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-bold">{data.kind === "links" ? `Backlinks to ${path(data.target!)}` : `Backlinks to ${data.domain}`}</h2>
            <p className="text-sm text-muted">
              From Bing Webmaster Tools.{" "}
              {data.kind === "pages" ? "These are the pages of the site that other sites link to. Click a page to see who links to it." : "Every site Bing found linking to this page."}
              {data.totalPages > 1 && ` Page ${data.page + 1} of ${data.totalPages}.`}
            </p>
          </div>
          <div className="card overflow-x-auto p-0">
            {data.kind === "pages" ? (
              <table className="w-full min-w-[32rem] table-fixed text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Page on the site</th>
                    <th className="w-32 px-4 py-2 text-right font-medium">Backlinks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((p) => (
                    <tr key={p.url}>
                      <td className="truncate px-4 py-2" title={p.url}>
                        <Link href={`${base}?${new URLSearchParams({ target: p.url })}`} className="font-medium text-brand hover:underline">{path(p.url)}</Link>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.count.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[40rem] table-fixed text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Linking page</th>
                    <th className="w-72 px-4 py-2 font-medium">Anchor text</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((l, i) => (
                    <tr key={`${l.source}-${i}`}>
                      <td className="truncate px-4 py-2" title={l.source}><Outbound url={l.source} /></td>
                      <td className="truncate px-4 py-2" title={l.anchor}>{l.anchor || <span className="text-muted">(no text)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.items.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Bing has no backlinks listed yet. Newly added sites can take a day or two.</p>}
          </div>
          {data.totalPages > 1 && (
            <div className="flex gap-3">
              {data.page > 0 && <Link href={href(data.page - 1)} className="btn-secondary">Previous</Link>}
              {data.page + 1 < data.totalPages && <Link href={href(data.page + 1)} className="btn-secondary">Next</Link>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
