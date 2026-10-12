"use client";

import { useActionState, useRef } from "react";
import { Trash2 } from "lucide-react";
import type { ActionResult } from "@/server/actions/helpers";

// A delete button that asks first. With `typeName`, the person must type that
// name to confirm (for deletes that take a lot with them).
export function DeleteButton({
  action,
  fields,
  label,
  confirmText,
  typeName,
  iconOnly = false,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  label: string;
  confirmText: string;
  typeName?: string;
  iconOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const typed = useRef<HTMLInputElement>(null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (typeName) {
          const answer = window.prompt(`${confirmText}\n\nType "${typeName}" to confirm.`);
          if (answer === null) return e.preventDefault();
          if (typed.current) typed.current.value = answer;
        } else if (!window.confirm(confirmText)) {
          e.preventDefault();
        }
      }}
      className="inline-flex flex-wrap items-center gap-2"
    >
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {typeName && <input ref={typed} type="hidden" name="confirmName" defaultValue="" />}
      <button type="submit" disabled={pending} className={`btn-danger inline-flex items-center gap-1.5 ${iconOnly ? "px-2.5 py-1.5" : ""}`} aria-label={label} title={label}>
        <Trash2 className="h-4 w-4" />
        {!iconOnly && (pending ? "Deleting…" : label)}
      </button>
      {state?.error && <span role="alert" className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
