import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Hash, Plus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProgressBar } from "@/components/progress-bar";
import { TaskTable } from "@/components/task-bits";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { formatDayKey, keyFromDbDate } from "@/lib/dates";
import { formatDateTime } from "@/lib/time";
import { RESPONSIBILITY_LABELS, getClient, listActivity } from "@/services/clients";
import { clientMonth, currentMonth } from "@/services/offpage";
import { listTasks } from "@/services/tasks";

// Workspace tabs that arrive with later phases of the plan.
const LATER = [
  ["Performance", 3],
  ["GSC", 3],
  ["GA4", 4],
  ["Keywords", 5],
  ["POA", 5],
  ["Rankings", 5],
  ["Technical SEO", 6],
  ["On-page SEO", 6],
  ["Content", 6],
  ["Clarity", 6],
  ["GMB", 8],
  ["Reports", 9],
] as const;

export default async function ClientOverview({ params }: PageProps<"/clients/[clientId]">) {
  const user = await requireUser();
  const { clientId } = await params;
  const { client, access } = await getClient(user, clientId);
  if (access !== "full") redirect(`/clients/${clientId}/off-page`);
  const [tasks, offpage, activity] = await Promise.all([
    listTasks(user, { view: "all", status: "open", clientId }),
    clientMonth(user, clientId, currentMonth()),
    listActivity(user, clientId, 8),
  ]);

  const team = new Map<string, { person: (typeof client.assignments)[number]["user"]; roles: string[] }>();
  for (const a of client.assignments) {
    if (a.user.status !== "ACTIVE") continue;
    const entry = team.get(a.userId) ?? { person: a.user, roles: [] };
    entry.roles.push(RESPONSIBILITY_LABELS[a.responsibility]);
    team.set(a.userId, entry);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Open tasks</h2>
            <div className="flex gap-3">
              {can(user.role, "tasks.manage") && (
                <Link href={`/tasks/new?client=${clientId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><Plus className="h-4 w-4" />New task</Link>
              )}
              <Link href={`/clients/${clientId}/tasks`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand">All tasks<ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
          <TaskTable tasks={tasks.slice(0, 8)} showClient={false} empty="No open tasks for this client." />
        </section>

        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Off-page this month</h2>
            <Link href={`/clients/${clientId}/off-page`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand">Open checklist<ArrowRight className="h-4 w-4" /></Link>
          </div>
          {offpage.total.planned === 0 ? (
            <p className="text-sm text-muted">No off-page plan yet. Set the monthly activities in the Off-page tab.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-5">
              {offpage.weeks.map((w) => (
                <ProgressBar key={w.week} label={`Week ${w.week}`} done={w.done} planned={w.planned} short={w.week < offpage.currentWeek} />
              ))}
              <ProgressBar label="Month" done={offpage.total.done} planned={offpage.total.planned} />
            </div>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Recent activity</h2>
            <Link href={`/clients/${clientId}/activity`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand">Timeline<ArrowRight className="h-4 w-4" /></Link>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {activity.map((a) => (
                <li key={String(a.id)} className="flex justify-between gap-4 py-2.5">
                  <span>{a.summary}</span>
                  <span className="shrink-0 text-xs text-muted">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-5">
        <section className="card space-y-3 text-sm">
          <h2 className="text-lg font-bold">Details</h2>
          <Detail label="Industry" value={client.industry} />
          <Detail label="Location" value={client.location} />
          <Detail label="Started" value={client.startDate ? formatDayKey(keyFromDbDate(client.startDate), { day: "numeric", month: "short", year: "numeric" }) : null} />
          <Detail label="Goals" value={client.goals} />
          <Detail label="Notes" value={client.notes} />
          {client.channel && (
            <Link href={`/clients/${clientId}/chat`} className="mt-1 inline-flex items-center gap-1 font-semibold text-brand"><Hash className="h-4 w-4" />{client.channel.name}</Link>
          )}
        </section>
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Team</h2>
            {can(user.role, "clients.edit") && <Link href={`/clients/${clientId}/settings`} className="text-sm font-semibold text-brand">Edit</Link>}
          </div>
          {team.size === 0 ? (
            <p className="text-sm text-muted">Nobody assigned yet.</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {[...team.values()].map(({ person, roles }) => (
                <li key={person.id} className="flex items-center gap-3">
                  <Avatar person={person} size="sm" />
                  <div className="leading-tight">
                    <div className="font-medium">{person.name}</div>
                    <div className="text-xs text-muted">{roles.join(", ")}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="text-sm font-bold">Coming to this workspace</h2>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {LATER.map(([label, phase]) => (
              <li key={label} className="chip border border-dashed border-border font-medium text-muted" title={`Phase ${phase}`}>{label}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-0.5 whitespace-pre-line">{value || "–"}</div>
    </div>
  );
}
