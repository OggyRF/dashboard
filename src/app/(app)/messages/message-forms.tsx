"use client";

import { useActionState } from "react";
import { replyAction, startThreadAction } from "@/server/actions/messages";

export function NewThreadForm() {
  const [state, action, pending] = useActionState(startThreadAction, undefined);
  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-bold">New message to the owners</h2>
      <div>
        <label htmlFor="subject" className="label">Subject</label>
        <input id="subject" name="subject" required className="field" />
      </div>
      <div>
        <label htmlFor="body" className="label">Message</label>
        <textarea id="body" name="body" required rows={3} className="field" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Sending…" : "Send"}</button>
    </form>
  );
}

export function ReplyForm({ threadId }: { threadId: string }) {
  const [state, action, pending] = useActionState(replyAction, undefined);
  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="threadId" value={threadId} />
      <label htmlFor="body" className="label">Reply</label>
      <textarea id="body" name="body" required rows={3} className="field" />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Sending…" : "Send reply"}</button>
    </form>
  );
}
