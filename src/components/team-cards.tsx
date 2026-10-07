import Link from "next/link";
import { AlertTriangle, Briefcase, ChevronRight, Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ProgressBar } from "@/components/progress-bar";
import { STATE_LABELS, type AttendanceState } from "@/lib/attendance/compute";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatMinutes } from "@/lib/dates";
import type { PersonCard as Card, Progress } from "@/services/team";

const PRESENCE: Record<AttendanceState, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-600",
  WORKING: "bg-success/10 text-success",
  ON_BREAK: "bg-warning/10 text-warning",
  LOGGED_OUT: "bg-background text-muted ring-1 ring-border",
};
const DOT: Record<AttendanceState, string> = { NOT_STARTED: "bg-slate-400", WORKING: "bg-success", ON_BREAK: "bg-warning", LOGGED_OUT: "bg-muted" };

// "Working · 3h 10m", "On leave" or "Not logged in".
export function Presence({ attendance }: { attendance: Card["attendance"] }) {
  if (!attendance) return null;
  if (attendance.onLeave && attendance.state === "NOT_STARTED") return <span className="chip bg-sky-50 text-sky-700">On leave</span>;
  const { state, workedMinutes } = attendance;
  return (
    <span className={`chip ${PRESENCE[state]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[state]}`} />
      {STATE_LABELS[state]}
      {state !== "NOT_STARTED" && workedMinutes > 0 && <span className="font-normal opacity-80">· {formatMinutes(workedMinutes)}</span>}
    </span>
  );
}

// One person's day in a few lines; opens their profile.
export function PersonCard({ person, date, inTeam }: { person: Card; date?: string; inTeam?: string }) {
  const otherTeams = person.teams.filter((t) => t.id !== inTeam);
  const { today } = person;
  const done = today.planned > 0 && today.done >= today.planned;
  return (
    <Link
      href={`/people/${person.id}${date ? `?date=${date}` : ""}`}
      className="card group flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <Avatar person={person} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold group-hover:text-brand">{person.name}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{ROLE_LABELS[person.role as keyof typeof ROLE_LABELS]}</span>
            <Presence attendance={person.attendance} />
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="font-semibold">Daily list</span>
          <span className={`tabular-nums ${done ? "font-semibold text-success" : "text-muted"}`}>
            {today.planned ? `${today.done}/${today.planned} done` : "Nothing planned"}
            {today.working > 0 && ` · ${today.working} in progress`}
          </span>
        </div>
        <ProgressBar done={today.done} planned={today.planned} size="sm" />
      </div>
      {(person.openTasks > 0 || otherTeams.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {person.openTasks > 0 && (
            <span className={`chip ${person.overdueTasks ? "bg-danger/10 text-danger" : "bg-background text-muted"}`}>
              {person.overdueTasks > 0 && <AlertTriangle className="h-3 w-3" />}
              {person.openTasks} open task{person.openTasks === 1 ? "" : "s"}
              {person.overdueTasks > 0 && `, ${person.overdueTasks} overdue`}
            </span>
          )}
          {otherTeams.map((t, i) => <span key={t.id} className="chip bg-brand/10 text-brand">{inTeam && i === 0 ? "Also in " : ""}{t.name.split(" ")[0]}&apos;s team</span>)}
        </div>
      )}
    </Link>
  );
}

// A strategist or manager: what they oversee and how their people are doing.
export function LeadCard({ lead, date }: { lead: { person: Card; label: string; clients: number; people: number; team: Progress; mine: boolean }; date?: string }) {
  return (
    <Link
      href={`/people/${lead.person.id}${date ? `?date=${date}` : ""}`}
      className={`card group flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md ${lead.mine ? "ring-2 ring-brand/30" : ""}`}
    >
      <div className="flex items-start gap-3">
        <Avatar person={lead.person} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-base font-bold group-hover:text-brand">{lead.person.name}</span>
            {lead.mine ? <span className="chip bg-brand/10 text-brand">You</span> : <ChevronRight className="h-4 w-4 shrink-0 text-muted group-hover:text-brand" />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{lead.label}</span>
            <Presence attendance={lead.person.attendance} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{lead.clients} client{lead.clients === 1 ? "" : "s"}</span>
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{lead.people} {lead.people === 1 ? "person" : "people"}</span>
      </div>
      <ProgressBar label="Team's daily lists" done={lead.team.done} planned={lead.team.planned} size="sm" />
    </Link>
  );
}
