import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { requireUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/time";
import { listActivity } from "@/services/clients";

export default async function ClientActivity({ params }: PageProps<"/clients/[clientId]/activity">) {
  const user = await requireUser();
  const { clientId } = await params;
  const events = await listActivity(user, clientId, 200);
  if (!events.length) return <div className="card text-sm text-muted">Nothing has happened on this client yet.</div>;
  return (
    <ol className="card relative space-y-0 p-0">
      {events.map((e) => (
        <li key={String(e.id)} className="flex gap-3 border-b border-border px-5 py-3.5 text-sm last:border-0">
          {e.actor ? <Avatar person={e.actor} size="sm" /> : <span className="h-8 w-8 shrink-0 rounded-full bg-background" />}
          <div className="min-w-0 flex-1">
            {e.link ? (
              <Link href={e.link} className="hover:text-brand" {...(e.link.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{e.summary}</Link>
            ) : (
              e.summary
            )}
            <div className="text-xs text-muted">{formatDateTime(e.createdAt)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
