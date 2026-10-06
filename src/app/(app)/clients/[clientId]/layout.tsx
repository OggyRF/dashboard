import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { LinkTabs } from "@/components/link-tabs";
import { requireUser } from "@/lib/auth/current-user";
import { getClient } from "@/services/clients";
import { StatusChip, TypeChip } from "../badges";
import { notFoundPage } from "./not-found-page";

export default async function ClientLayout({ children, params }: LayoutProps<"/clients/[clientId]">) {
  const user = await requireUser();
  const { clientId } = await params;
  const found = await getClient(user, clientId).catch(() => null);
  if (!found) return notFoundPage();
  const { client, access } = found;
  const base = `/clients/${client.id}`;
  const tabs =
    access === "full"
      ? [
          { href: base, label: "Overview", exact: true },
          { href: `${base}/tasks`, label: "Tasks" },
          { href: `${base}/off-page`, label: "Off-page" },
          { href: `${base}/chat`, label: "Chat" },
          { href: `${base}/activity`, label: "Activity" },
          { href: `${base}/settings`, label: "Settings" },
        ]
      : [
          { href: base, label: "Overview", exact: true },
          { href: `${base}/off-page`, label: "Off-page" },
          { href: `${base}/chat`, label: "Chat" },
        ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link href="/clients" className="text-sm text-muted hover:text-brand">← Clients</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="page-title">{client.name}</h1>
          <TypeChip type={client.type} />
          <StatusChip status={client.status} />
        </div>
        {client.website && (
          <a href={client.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-muted hover:text-brand">
            {client.website.replace(/^https?:\/\//, "")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <LinkTabs tabs={tabs} />
      {children}
    </div>
  );
}
