import Link from "next/link";
import { Plus } from "lucide-react";
import { TaskTable } from "@/components/task-bits";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { requireClient } from "@/services/clients";
import { listTasks } from "@/services/tasks";

export default async function ClientTasks({ params, searchParams }: PageProps<"/clients/[clientId]/tasks">) {
  const user = await requireUser();
  const { clientId } = await params;
  const sp = await searchParams;
  await requireClient(user, clientId);
  const status = sp.status === "done" ? "done" : "open";
  const tasks = await listTasks(user, { view: "all", status, clientId });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-background p-1 text-sm">
          {(["open", "done"] as const).map((s) => (
            <Link key={s} href={`?status=${s}`} className={`rounded-lg px-3 py-1.5 ${status === s ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}>
              {s === "open" ? "Open" : "Done"}
            </Link>
          ))}
        </div>
        {can(user.role, "tasks.manage") && <Link href={`/tasks/new?client=${clientId}`} className="btn-primary"><Plus className="h-4 w-4" />New task</Link>}
      </div>
      <TaskTable tasks={tasks} showClient={false} empty={status === "open" ? "No open tasks." : "No finished tasks yet."} />
    </div>
  );
}
