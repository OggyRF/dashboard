import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { listTeam } from "@/services/clients";
import { messageForTask } from "@/services/chat";
import { taskClients } from "@/services/tasks";
import { TaskForm } from "../task-form";

export const metadata: Metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: PageProps<"/tasks/new">) {
  const user = await requirePermission("tasks.manage");
  const sp = await searchParams;
  const [clients, people] = await Promise.all([taskClients(user), listTeam()]);
  const from = typeof sp.from === "string" ? await messageForTask(user, sp.from).catch(() => null) : null;
  const clientId = from?.clientId ?? (typeof sp.client === "string" ? sp.client : "");
  const firstLine = from?.body.split("\n")[0]?.slice(0, 200) ?? "";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/tasks" className="text-sm text-muted hover:text-brand">← Tasks</Link>
        <h1 className="page-title mt-1">New task</h1>
        {from && <p className="text-sm text-muted">Made from a chat message; it is linked back to the conversation.</p>}
      </div>
      <div className="card">
        <TaskForm
          clients={clients}
          people={people}
          values={{
            clientId: clients.some((c) => c.id === clientId) ? clientId : "",
            title: firstLine,
            description: from && from.body !== firstLine ? from.body : "",
            category: "OTHER",
            priority: "MEDIUM",
            assigneeId: "",
            followUpId: "",
            dueDate: "",
            sourceMessageId: from?.messageId,
          }}
        />
      </div>
    </div>
  );
}
