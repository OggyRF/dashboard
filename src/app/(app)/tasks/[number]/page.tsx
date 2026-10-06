import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Ban, MessageSquare } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { MessageBody } from "@/components/chat/message-body";
import { DueDate, PriorityText, TaskStatusChip } from "@/components/task-bits";
import { requirePermission } from "@/lib/auth/current-user";
import { keyFromDbDate } from "@/lib/dates";
import { formatDateTime } from "@/lib/time";
import { listTeam } from "@/services/clients";
import { TASK_ACTION_LABELS, TASK_CATEGORY_LABELS, getTask, isOverdue } from "@/services/tasks";
import { db } from "@/lib/db";
import { TaskForm } from "../task-form";
import { CommentForm, TaskSteps } from "./steps";

export async function generateMetadata({ params }: PageProps<"/tasks/[number]">): Promise<Metadata> {
  return { title: `Task #${(await params).number}` };
}

export default async function TaskPage({ params }: PageProps<"/tasks/[number]">) {
  const user = await requirePermission("tasks.manage");
  const number = Number((await params).number);
  const found = await getTask(user, number).catch(() => null);
  if (!found) {
    return (
      <div className="card mx-auto max-w-xl text-center">
        <h1 className="text-lg font-bold">Task not found</h1>
        <p className="mt-1 text-sm text-muted">It may be on a client you are not working on.</p>
        <Link href="/tasks" className="btn-secondary mt-4">All tasks</Link>
      </div>
    );
  }
  const { task, comments, history, actions, canEdit } = found;
  const overdue = isOverdue(task);
  const people = canEdit ? await listTeam() : [];
  const source = task.sourceMessageId ? await db.chatMessage.findUnique({ where: { id: task.sourceMessageId }, select: { channelId: true, parentId: true } }) : null;

  return (
    <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <div>
          <Link href="/tasks" className="text-sm text-muted hover:text-brand">← Tasks</Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="text-2xl font-bold text-muted tabular-nums">#{task.number}</span>
            <h1 className="page-title">{task.title}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <TaskStatusChip status={task.status} />
            {overdue && <span className="chip bg-danger/10 text-danger"><AlertTriangle className="h-3 w-3" />Overdue</span>}
            <Link href={`/clients/${task.client.id}`} className="chip bg-brand/10 text-brand hover:underline">{task.client.name}</Link>
            <span className="text-muted">{TASK_CATEGORY_LABELS[task.category]}</span>
          </div>
        </div>

        {task.status === "BLOCKED" && task.blockedReason && (
          <p className="flex items-start gap-2 rounded-xl bg-danger/10 p-4 text-sm text-danger"><Ban className="mt-0.5 h-4 w-4 shrink-0" />Blocked: {task.blockedReason}</p>
        )}
        {task.rejectionReason && task.status === "IN_PROGRESS" && (
          <p className="rounded-xl bg-warning/10 p-4 text-sm text-warning">Sent back from QA: {task.rejectionReason}</p>
        )}

        <section className="card space-y-3">
          <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Next step</h2>
          <TaskSteps number={task.number} steps={actions} labels={TASK_ACTION_LABELS} />
        </section>

        {task.description && (
          <section className="card">
            <h2 className="mb-2 text-sm font-bold tracking-wide text-muted uppercase">Details</h2>
            <p className="text-sm whitespace-pre-wrap"><MessageBody text={task.description} names={[]} /></p>
          </section>
        )}
        {task.submissionNote && (
          <section className="card">
            <h2 className="mb-2 text-sm font-bold tracking-wide text-muted uppercase">Submitted for QA</h2>
            <p className="text-sm whitespace-pre-wrap"><MessageBody text={task.submissionNote} names={[]} /></p>
          </section>
        )}

        <section className="card space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-bold"><MessageSquare className="h-5 w-5 text-brand" />Comments</h2>
          {comments.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Avatar person={c.author} size="sm" />
                <div className="min-w-0 rounded-2xl bg-background px-4 py-2.5 text-sm">
                  <div className="text-xs"><span className="font-semibold">{c.author.name}</span> <span className="text-muted">{formatDateTime(c.createdAt)}</span></div>
                  <p className="mt-0.5 whitespace-pre-wrap"><MessageBody text={c.body} names={[]} /></p>
                </div>
              </li>
            ))}
          </ul>
          <CommentForm number={task.number} />
        </section>

        {canEdit && (
          <details className="card">
            <summary className="cursor-pointer font-bold">Edit task</summary>
            <div className="mt-4">
              <TaskForm
                people={people}
                values={{
                  number: task.number,
                  clientId: task.clientId,
                  title: task.title,
                  description: task.description ?? "",
                  category: task.category,
                  priority: task.priority,
                  assigneeId: task.assigneeId ?? "",
                  reviewerId: task.reviewerId ?? "",
                  dueDate: task.dueDate ? keyFromDbDate(task.dueDate) : "",
                }}
              />
            </div>
          </details>
        )}
      </div>

      <aside className="space-y-5">
        <section className="card space-y-4 text-sm">
          <Field label="Who does it">{task.assignee ? <Person p={task.assignee} /> : <span className="text-muted">Nobody yet</span>}</Field>
          <Field label="QA reviewer">{task.reviewer ? <Person p={task.reviewer} /> : <span className="text-muted">Any owner or strategy person</span>}</Field>
          <Field label="Due"><DueDate date={task.dueDate} overdue={overdue} /></Field>
          <Field label="Priority"><PriorityText priority={task.priority} /></Field>
          <Field label="Created">{task.createdBy ? `${task.createdBy.name}, ` : ""}{formatDateTime(task.createdAt)}</Field>
          {task.completedAt && <Field label="Completed">{formatDateTime(task.completedAt)}</Field>}
          {source && (
            <Field label="From chat">
              <Link href={`/chat/${source.channelId}${source.parentId ? `?thread=${source.parentId}` : ""}`} className="text-brand hover:underline">Open the conversation</Link>
            </Field>
          )}
        </section>
        <section className="card">
          <h2 className="mb-3 text-sm font-bold tracking-wide text-muted uppercase">History</h2>
          <ol className="space-y-2.5 text-sm">
            {history.map((h) => (
              <li key={String(h.id)}>
                <div>{h.summary}</div>
                <div className="text-xs text-muted">{formatDateTime(h.createdAt)}</div>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Person({ p }: { p: { id: string; name: string; avatarUpdatedAt: Date | null } }) {
  return <span className="flex items-center gap-2"><Avatar person={p} size="xs" />{p.name}</span>;
}
