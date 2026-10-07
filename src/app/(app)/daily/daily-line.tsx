"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle, ExternalLink, Link2, LoaderCircle, Play, Sparkles, Undo2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { formatDayKey } from "@/lib/dates";
import { istClock } from "@/lib/ist-format";
import { completeUnitAction, removeDailyTaskAction, startUnitAction, undoUnitAction } from "@/server/actions/daily";
import type { DailyTaskView } from "@/services/daily";

type Line = DailyTaskView & { carried?: boolean };
type Unit = Line["units"][number];

const WORK_TONES = { WRITING: "bg-sky-50 text-sky-700 ring-sky-200", UPLOADING: "bg-violet-50 text-violet-700 ring-violet-200", OTHER: "bg-amber-50 text-amber-700 ring-amber-200" } as const;
const WORK_WORD = { WRITING: "writing", UPLOADING: "uploading", OTHER: "" } as const;

// One line of a daily list ("Guest Posting · Writing", 2 pieces) with a row
// per piece: Mark working, then Mark completed. The line is complete once
// every piece is.
export function DailyLine({ line, canWork, onRemove }: { line: Line; canWork: boolean; onRemove?: () => void }) {
  const finished = line.done >= line.qty;
  const name = unitName(line);
  return (
    <div className={`rounded-2xl border p-3 sm:p-4 ${finished ? "border-success/30 bg-success/[0.04]" : line.carried ? "border-danger/30 bg-danger/[0.03]" : "border-border bg-surface"}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {line.work === "OTHER" ? name : <>{line.qty} {name} <span className="font-normal text-muted">{WORK_WORD[line.work]}</span></>}
            </span>
            <span className={`chip ring-1 ${WORK_TONES[line.work]}`}>{line.work === "OTHER" ? "Extra task" : line.work === "WRITING" ? "Writing" : "Uploading"}</span>
            {line.auto && <span className="chip bg-background text-muted" title="Made by the automatic daily plan"><Sparkles className="h-3 w-3" />Auto</span>}
            {line.carried && <span className="chip bg-danger/10 text-danger">Left from {formatDayKey(line.date)}</span>}
          </div>
          {line.work !== "OTHER" && line.details && <p className="text-sm text-muted">{line.details}</p>}
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {line.followUp ? (
              <>Follow-up: <Avatar person={line.followUp} size="xs" /><span className="font-medium text-foreground">{line.followUp.name}</span></>
            ) : (
              "No one following up"
            )}
            {line.createdBy && <span>· added by {line.createdBy.name}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {finished ? (
            <span className="chip bg-success/10 text-success"><CheckCircle2 className="h-3.5 w-3.5" />Completed</span>
          ) : (
            <span className="text-sm font-semibold tabular-nums">{line.done} of {line.qty} done</span>
          )}
          {onRemove && line.units.every((u) => u.status === "TODO") && (
            <button type="button" onClick={onRemove} className="text-xs font-semibold text-danger hover:underline">Remove</button>
          )}
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {line.units.map((u) => <UnitRow key={u.n} line={line} unit={u} canWork={canWork} />)}
      </ul>
    </div>
  );
}

const unitName = (line: Line) => (line.activity && line.work !== "OTHER" ? line.activity.name : (line.details ?? "Task"));

function UnitRow({ line, unit, canWork }: { line: Line; unit: Unit; canWork: boolean }) {
  const [linking, setLinking] = useState(false);
  const [proof, setProof] = useState("");
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const needsLink = line.work === "UPLOADING";

  function run(fn: () => Promise<{ error?: string; ok?: string } | undefined>, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      setMessage(r?.error ? r : null);
      if (r?.ok) after?.();
    });
  }
  function complete() {
    if (needsLink && !linking) {
      setLinking(true);
      return;
    }
    run(() => completeUnitAction(line.id, unit.n, proof), () => {
      setLinking(false);
      setProof("");
    });
  }
  function undo() {
    if (!unit.tickId) return;
    const ask = unit.status === "DONE" ? (unit.linked ? "Reopen this? Its box in the off-page checklist is unticked too." : "Reopen this?") : "Stop working on this?";
    if (!window.confirm(ask)) return;
    run(() => undoUnitAction(unit.tickId!));
  }

  const icon =
    unit.status === "DONE" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" /> : unit.status === "WORKING" ? <LoaderCircle className="h-5 w-5 shrink-0 text-brand" /> : <Circle className="h-5 w-5 shrink-0 text-border" />;

  return (
    <li className={`rounded-xl px-3 py-2 ${unit.status === "WORKING" ? "bg-brand/[0.06] ring-1 ring-brand/20" : "bg-background/70"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-[11rem] flex-1 items-center gap-2.5">
          {icon}
          <div className="min-w-0">
            <div className={`text-sm font-medium ${unit.status === "DONE" ? "text-muted line-through decoration-success/50" : ""}`}>{line.qty > 1 ? `${unitName(line)} ${unit.n} of ${line.qty}` : unitName(line)}</div>
            <div className="text-xs text-muted">
              {unit.status === "TODO" && "Not started"}
              {unit.status === "WORKING" && unit.startedAt && <>Working since {istClock(unit.startedAt)}</>}
              {unit.status === "DONE" && unit.doneAt && (
                <>
                  Completed {istClock(unit.doneAt)}
                  {unit.doneBy && ` by ${unit.doneBy.name.split(" ")[0]}`}
                  {unit.proofUrl && (
                    <a href={unit.proofUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">Link<ExternalLink className="h-3 w-3" /></a>
                  )}
                  {unit.linked && <span className="ml-1.5">· ticked in checklist</span>}
                </>
              )}
            </div>
          </div>
        </div>
        {canWork && (
          <div className="ml-auto flex items-center gap-2">
            {unit.status === "TODO" && (
              <button type="button" disabled={pending} onClick={() => run(() => startUnitAction(line.id, unit.n))} className="btn-secondary px-3 py-1.5 text-xs">
                <Play className="h-3.5 w-3.5" />Mark working
              </button>
            )}
            {unit.status === "WORKING" && !linking && (
              <button type="button" disabled={pending} onClick={complete} className="btn-primary px-3 py-1.5 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />Mark completed
              </button>
            )}
            {unit.status !== "TODO" && !linking && (
              <button type="button" disabled={pending} onClick={undo} className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-danger" aria-label={unit.status === "DONE" ? "Reopen" : "Stop working"} title={unit.status === "DONE" ? "Reopen" : "Stop working"}>
                <Undo2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
      {linking && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && complete()}
              placeholder="Paste the live link"
              aria-label="Live link"
              className="field py-1.5 pl-9"
              autoFocus
            />
          </div>
          <button type="button" onClick={complete} disabled={pending || !proof.trim()} className="btn-primary px-3 py-1.5 text-xs">Save</button>
          <button type="button" onClick={() => setLinking(false)} className="btn-secondary px-3 py-1.5 text-xs">Cancel</button>
        </div>
      )}
      {message?.error && <p role="alert" className="mt-1.5 text-xs text-danger">{message.error}</p>}
    </li>
  );
}

// A line on someone's profile, as a lead sees it: read only, with Remove for
// lines nobody has started.
export function LeadLine({ line, canRemove }: { line: Line; canRemove: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  function remove() {
    if (!window.confirm("Remove this from their list?")) return;
    startTransition(async () => setError((await removeDailyTaskAction(line.id))?.error ?? null));
  }
  return (
    <div className="space-y-1">
      <DailyLine line={line} canWork={false} onRemove={canRemove ? remove : undefined} />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
