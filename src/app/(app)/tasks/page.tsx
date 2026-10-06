import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { TaskTable } from "@/components/task-bits";
import { requirePermission } from "@/lib/auth/current-user";
import { listTasks, taskClients, taskFilterSchema } from "@/services/tasks";

export const metadata: Metadata = { title: "Tasks" };

const VIEWS = [
  ["mine", "My tasks"],
  ["followup", "I follow up"],
  ["created", "I created"],
  ["all", "All"],
] as const;

const STATUSES = [
  ["open", "Open"],
  ["overdue", "Overdue"],
  ["NOT_STARTED", "Not started"],
  ["IN_PROGRESS", "Under process"],
  ["done", "Done"],
] as const;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requirePermission("tasks.manage");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f = taskFilterSchema.parse({ view: one(sp.view), status: one(sp.status), clientId: one(sp.client) || undefined });
  const [tasks, clients] = await Promise.all([listTasks(user, f), taskClients(user)]);
  const href = (patch: Record<string, string>) => `?${new URLSearchParams({ view: f.view, status: f.status, ...(f.clientId ? { client: f.clientId } : {}), ...patch })}`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="text-sm text-muted">Work moves from Not started to Under process to Completed. Late tasks alert the client&apos;s team and the owners.</p>
        </div>
        <Link href={`/tasks/new${f.clientId ? `?client=${f.clientId}` : ""}`} className="btn-primary"><Plus className="h-4 w-4" />New task</Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface p-1 text-sm shadow-sm ring-1 ring-border/70">
          {VIEWS.map(([v, label]) => (
            <Link key={v} href={href({ view: v })} className={`rounded-lg px-3 py-1.5 whitespace-nowrap ${f.view === v ? "brand-gradient font-semibold text-brand-ink" : "text-muted hover:text-foreground"}`}>{label}</Link>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto text-sm">
          {STATUSES.map(([s, label]) => (
            <Link key={s} href={href({ status: s })} className={`chip px-3 py-1 whitespace-nowrap ${f.status === s ? "bg-foreground text-white" : "bg-background text-muted hover:text-foreground"}`}>{label}</Link>
          ))}
        </div>
        <form className="ml-auto">
          <input type="hidden" name="view" value={f.view} />
          <input type="hidden" name="status" value={f.status} />
          <AutoSubmitSelect name="client" defaultValue={f.clientId ?? ""} className="field py-1.5" aria-label="Client">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </AutoSubmitSelect>
        </form>
      </div>

      <TaskTable tasks={tasks} empty={"No tasks here."} />
    </div>
  );
}
