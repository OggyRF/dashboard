import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/time";
import { listAuditLog } from "@/services/users";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  const actor = await requirePermission("audit.view");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { rows, total, pageSize } = await listAuditLog(actor, page);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="page-title">Audit log</h1>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/60 text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">When (IST)</th>
              <th className="px-4 py-3 font-semibold">Who</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-4 py-3 font-semibold">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id.toString()} className="border-b border-border last:border-0 transition hover:bg-background/60">
                <td className="whitespace-nowrap px-4 py-2">{formatDateTime(r.createdAt)}</td>
                <td className="px-4 py-2">{r.actor?.name ?? "System"}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2 text-muted">{r.entityType}</td>
                <td className="px-4 py-2 text-muted">{r.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-sm">
        {page > 1 && <Link href={`?page=${page - 1}`} className="btn-secondary">Newer</Link>}
        <span className="text-muted">Page {page} of {pages}</span>
        {page < pages && <Link href={`?page=${page + 1}`} className="btn-secondary">Older</Link>}
      </div>
    </div>
  );
}
