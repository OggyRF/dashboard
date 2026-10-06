"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader, RotateCcw } from "lucide-react";
import { taskStepAction } from "@/server/actions/tasks";

type Step = "progress" | "complete" | "reopen";

const ICONS = { progress: Loader, complete: CheckCircle2, reopen: RotateCcw };
const STYLES: Record<Step, string> = { progress: "btn-secondary", complete: "btn-primary", reopen: "btn-secondary" };

export function TaskSteps({ number, steps, labels }: { number: number; steps: Step[]; labels: Record<Step, string> }) {
  const [state, action, pending] = useActionState(taskStepAction, undefined);
  if (!steps.length) return <p className="text-sm text-muted">Only the person doing this task, the follow-up person or an owner can change its status.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => {
          const Icon = ICONS[s];
          return (
            <form key={s} action={action}>
              <input type="hidden" name="number" value={number} />
              <input type="hidden" name="step" value={s} />
              <button type="submit" disabled={pending} className={STYLES[s]}><Icon className="h-4 w-4" />{labels[s]}</button>
            </form>
          );
        })}
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </div>
  );
}
