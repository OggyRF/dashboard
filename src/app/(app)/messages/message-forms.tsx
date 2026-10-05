"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, SendHorizontal } from "lucide-react";
import { Avatar, type AvatarPerson } from "@/components/avatar";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { replyAction, startThreadAction } from "@/server/actions/messages";

type Recipient = AvatarPerson & { role: keyof typeof ROLE_LABELS };

export function ComposeForm({ recipients, preselected }: { recipients: Recipient[]; preselected: string[] }) {
  const [state, action, pending] = useActionState(startThreadAction, undefined);
  const [to, setTo] = useState<Set<string>>(new Set(preselected));
  const toggle = (id: string) =>
    setTo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className="label">To</legend>
        <p className="mb-2 text-xs text-muted">Pick one or more people. Only they will see this conversation.</p>
        <div className="flex flex-wrap gap-2">
          {recipients.map((r) => {
            const on = to.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                aria-pressed={on}
                className={`flex cursor-pointer items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition ${
                  on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-border hover:border-brand/40"
                }`}
              >
                <Avatar person={r} size="xs" />
                {r.name}
                {r.role === "OWNER" && <span className="text-xs font-normal text-muted">Owner</span>}
                {on && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
        {[...to].map((id) => <input key={id} type="hidden" name="to" value={id} />)}
      </fieldset>
      <div>
        <label htmlFor="subject" className="label">Subject</label>
        <input id="subject" name="subject" required maxLength={120} placeholder="What is it about?" className="field" />
      </div>
      <div>
        <label htmlFor="body" className="label">Message</label>
        <textarea id="body" name="body" required rows={6} maxLength={5000} className="field" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending || to.size === 0} className="btn-primary">
        <SendHorizontal className="h-4 w-4" />
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

// Message box at the bottom of a conversation. Enter sends, Shift+Enter adds
// a new line; the box empties once the message is sent.
export function ChatReplyForm({ threadId }: { threadId: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (s: Parameters<typeof replyAction>[0], f: FormData) => {
    const result = await replyAction(s, f);
    if (result?.ok) form.current?.reset();
    return result;
  }, undefined);

  return (
    <form ref={form} action={action} className="border-t border-border bg-surface p-3">
      <input type="hidden" name="threadId" value={threadId} />
      <div className="flex items-end gap-2">
        <textarea
          name="body"
          required
          rows={1}
          maxLength={5000}
          placeholder="Write a message…"
          aria-label="Message"
          className="field max-h-40 min-h-11 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={pending} className="btn-primary h-11 px-3" aria-label="Send">
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
      {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}

// Re-fetches the page now and then so new replies appear without reloading.
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}

// Keeps the newest message in view when the conversation opens or grows.
export function ScrollToEnd({ count, className, children }: { count: number; className: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [count]);
  return (
    <div ref={box} className={className}>
      {children}
    </div>
  );
}
