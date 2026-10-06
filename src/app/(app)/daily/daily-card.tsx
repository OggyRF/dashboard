"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Link2, Undo2 } from "lucide-react";
import { DAILY_WORK_LABELS } from "@/lib/daily-labels";
import { tickDailyAction, untickDailyAction } from "@/server/actions/daily";
import type { DailyTaskView } from "@/services/daily";

const WORK_TONES = { WRITING: "bg-sky-50 text-sky-700", UPLOADING: "bg-violet-50 text-violet-700", OTHER: "bg-slate-100 text-slate-600" } as const;

// One line of a daily list with a box per piece of work.
export function DailyCard({ task, canTick, showDate = false, onRemove }: { task: DailyTaskView; canTick: boolean; showDate?: boolean; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState("");
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const finished = task.done >= task.qty;
  const needsLink = task.work === "UPLOADING";

  function tick() {
    startTransition(async () => {
      const r = await tickDailyAction(task.id, proof);
      setMessage(r ?? null);
      if (r?.ok) {
        setProof("");
        setOpen(false);
      }
    });
  }
  function untick(id: string) {
    if (!window.confirm("Untick this? If it ticked a box in the off-page checklist, that box is unticked too.")) return;
    startTransition(async () => setMessage((await untickDailyAction(id)) ?? null));
  }

  return (
    <div className={`card space-y-3 ${finished ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${WORK_TONES[task.work]}`}>{DAILY_WORK_LABELS[task.work]}</span>
            <span className="font-semibold">{task.title}</span>
            <span className="text-sm text-muted">for {task.client.name}</span>
          </div>
          {task.work !== "OTHER" && task.details && <p className="mt-1 text-sm text-muted">{task.details}</p>}
          {showDate && <p className="mt-1 text-xs text-danger">From {task.date}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold tabular-nums ${finished ? "text-success" : ""}`}>{task.done}/{task.qty}</span>
          {onRemove && task.done === 0 && <button type="button" onClick={onRemove} className="text-xs font-semibold text-danger hover:underline">Remove</button>}
        </div>
      </div>

      <ul className="flex flex-wrap gap-2">
        {Array.from({ length: task.qty }, (_, i) => {
          const t = task.ticks[i];
          return (
            <li key={i}>
              {t ? (
                <span className="flex items-center gap-1 rounded-xl bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
                  <Check className="h-3.5 w-3.5" />
                  {t.proofUrl ? (
                    <a href={t.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline" title={t.proofUrl}>Link<ExternalLink className="h-3 w-3" /></a>
                  ) : (
                    "Done"
                  )}
                  {t.linked && <span title="Ticked in the off-page checklist" className="text-[10px] font-normal">· checklist</span>}
                  {canTick && (
                    <button type="button" onClick={() => untick(t.id)} disabled={pending} className="ml-1 text-muted hover:text-danger" aria-label="Untick"><Undo2 className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              ) : (
                <span className="block h-7 w-9 rounded-xl border-2 border-dashed border-border" aria-label="Not done yet" />
              )}
            </li>
          );
        })}
      </ul>

      {canTick && !finished && (
        open ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Link2 className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && tick()}
                placeholder={needsLink ? "Live link of the upload (required)" : "Link to the work (optional)"}
                aria-label="Link"
                className="field pl-9"
                autoFocus
              />
            </div>
            <button type="button" onClick={tick} disabled={pending || (needsLink && !proof.trim())} className="btn-primary"><Check className="h-4 w-4" />Mark done</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setOpen(true); setMessage(null); }} className="btn-secondary"><Check className="h-4 w-4" />Tick the next one</button>
        )
      )}
      {message?.error && <p role="alert" className="text-sm text-danger">{message.error}</p>}
      {message?.ok && <p className="text-sm text-success">{message.ok}</p>}
    </div>
  );
}
