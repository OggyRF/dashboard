import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { Avatar } from "@/components/avatar";
import { formatDayKey, keyFromDbDate } from "@/lib/dates";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/services/tasks";

const STATUS_TONES: Record<TaskStatus, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-600",
  IN_PROGRESS: "bg-sky-50 text-sky-700",
  SUBMITTED: "bg-violet-50 text-violet-700",
  QA: "bg-violet-50 text-violet-700",
  APPROVED: "bg-success/10 text-success",
  COMPLETED: "bg-success/15 text-success",
  BLOCKED: "bg-danger/10 text-danger",
};

const PRIORITY_TONES: Record<TaskPriority, string> = {
  LOW: "text-muted",
  MEDIUM: "text-foreground",
  HIGH: "text-warning font-semibold",
  URGENT: "text-danger font-bold",
};

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <span className={`chip whitespace-nowrap ${STATUS_TONES[status]}`}>{TASK_STATUS_LABELS[status]}</span>;
}

export function PriorityText({ priority }: { priority: TaskPriority }) {
  return <span className={`text-xs ${PRIORITY_TONES[priority]}`}>{TASK_PRIORITY_LABELS[priority]}</span>;
}

export function DueDate({ date, overdue }: { date: Date | null; overdue: boolean }) {
  if (!date) return <span className="text-muted">–</span>;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${overdue ? "font-semibold text-danger" : ""}`}>
      {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
      {formatDayKey(keyFromDbDate(date), { day: "numeric", month: "short" })}
    </span>
  );
}

type Row = {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  overdue: boolean;
  client: { id: string; name: string };
  assignee: { id: string; name: string; avatarUpdatedAt: Date | null } | null;
};

export function TaskTable({ tasks, showClient = true, empty }: { tasks: Row[]; showClient?: boolean; empty: string }) {
  if (!tasks.length) return <div className="card text-center text-sm text-muted">{empty}</div>;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-background/60 text-left text-xs tracking-wide text-muted uppercase">
          <tr>
            <th className="px-4 py-3 font-semibold">Task</th>
            {showClient && <th className="px-4 py-3 font-semibold">Client</th>}
            <th className="px-4 py-3 font-semibold">Who</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Due</th>
            <th className="px-4 py-3 font-semibold">Priority</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b border-border transition last:border-0 hover:bg-background/60">
              <td className="px-4 py-3">
                <Link href={`/tasks/${t.number}`} className="font-medium hover:text-brand">
                  <span className="mr-1.5 text-muted tabular-nums">#{t.number}</span>
                  {t.title}
                </Link>
              </td>
              {showClient && (
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link href={`/clients/${t.client.id}`} className="text-muted hover:text-brand">{t.client.name}</Link>
                </td>
              )}
              <td className="px-4 py-3">
                {t.assignee ? (
                  <span className="flex items-center gap-2 whitespace-nowrap"><Avatar person={t.assignee} size="xs" />{t.assignee.name.split(" ")[0]}</span>
                ) : (
                  <span className="text-muted">Nobody yet</span>
                )}
              </td>
              <td className="px-4 py-3"><TaskStatusChip status={t.status} /></td>
              <td className="px-4 py-3"><DueDate date={t.dueDate} overdue={t.overdue} /></td>
              <td className="px-4 py-3"><PriorityText priority={t.priority} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
