"use client";

import { useActionState, useState } from "react";
import { taskCommentAction, taskStepAction } from "@/server/actions/tasks";

type Step = "start" | "submit" | "pickUp" | "approve" | "reject" | "complete" | "block" | "unblock" | "reopen";

// Steps that need a note, and what the note box asks for.
const NOTES: Partial<Record<Step, string>> = {
  submit: "What did you do? Add the proof link.",
  reject: "What needs fixing?",
  block: "What is blocking it?",
};
const STYLES: Partial<Record<Step, string>> = { reject: "btn-danger", block: "btn-secondary", reopen: "btn-secondary", pickUp: "btn-secondary" };

export function TaskSteps({ number, steps, labels }: { number: number; steps: Step[]; labels: Record<Step, string> }) {
  const [state, action, pending] = useActionState(taskStepAction, undefined);
  const [noteFor, setNoteFor] = useState<Step | null>(null);
  if (!steps.length) return <p className="text-sm text-muted">Nothing for you to do on this task right now.</p>;
  return (
    <div className="space-y-3">
      {noteFor ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="number" value={number} />
          <input type="hidden" name="step" value={noteFor} />
          <label htmlFor="note" className="label">{NOTES[noteFor]}</label>
          <textarea id="note" name="note" rows={3} required minLength={3} maxLength={2000} className="field" autoFocus />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={STYLES[noteFor] === "btn-danger" ? "btn-danger" : "btn-primary"}>{labels[noteFor]}</button>
            <button type="button" onClick={() => setNoteFor(null)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {steps.map((s) =>
            NOTES[s] ? (
              <button key={s} type="button" onClick={() => setNoteFor(s)} className={STYLES[s] ?? "btn-primary"}>{labels[s]}</button>
            ) : (
              <form key={s} action={action}>
                <input type="hidden" name="number" value={number} />
                <input type="hidden" name="step" value={s} />
                <button type="submit" disabled={pending} className={STYLES[s] ?? "btn-primary"}>{labels[s]}</button>
              </form>
            ),
          )}
        </div>
      )}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </div>
  );
}

export function CommentForm({ number }: { number: number }) {
  const [state, action, pending] = useActionState(async (s: Parameters<typeof taskCommentAction>[0], f: FormData) => {
    const r = await taskCommentAction(s, f);
    if (r?.ok) (document.getElementById("comment-body") as HTMLTextAreaElement | null)!.value = "";
    return r;
  }, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="number" value={number} />
      <textarea id="comment-body" name="body" rows={2} required maxLength={5000} placeholder="Write a comment…" aria-label="Comment" className="field" />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-secondary">Comment</button>
    </form>
  );
}
