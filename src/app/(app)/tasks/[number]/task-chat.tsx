"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { SendHorizontal } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { MessageBody } from "@/components/chat/message-body";
import { istShortDateTime } from "@/lib/ist-format";
import { loadTaskChatAction, sendTaskChatAction } from "@/server/actions/tasks";

type Message = { id: string; body: string; createdAt: string; author: { id: string; name: string; avatarUpdatedAt: Date | null } };

const POLL_MS = 5000;

// A small chat under a task. New messages show up within a few seconds.
export function TaskChat({ number, meId, initial }: { number: number; meId: string; initial: Message[] }) {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  const count = messages.length;

  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const fresh = await loadTaskChatAction(number);
      if (fresh) setMessages(fresh);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [number]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count]);

  function send() {
    const body = text.trim();
    if (!body) return;
    startTransition(async () => {
      const r = await sendTaskChatAction(number, body);
      if (r.error) return setError(r.error);
      setError(null);
      setText("");
      const fresh = await loadTaskChatAction(number);
      if (fresh) setMessages(fresh);
    });
  }

  return (
    <div className="space-y-3">
      <div ref={list} className="max-h-[26rem] space-y-3 overflow-y-auto rounded-xl bg-background p-3">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-muted">No messages yet. Ask a question or share an update.</p>}
        {messages.map((m) => {
          const mine = m.author.id === meId;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
              {!mine && <Avatar person={m.author} size="sm" />}
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-brand text-white" : "bg-surface ring-1 ring-border/70"}`}>
                {!mine && <div className="text-xs font-semibold">{m.author.name}</div>}
                <p className={`whitespace-pre-wrap break-words ${mine ? "[&_a]:text-white [&_a]:underline" : ""}`}><MessageBody text={m.body} names={[]} /></p>
                <div className={`mt-0.5 text-[10px] ${mine ? "text-white/75" : "text-muted"}`}>{istShortDateTime(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={5000}
          placeholder="Message about this task…"
          aria-label="Message about this task"
          className="field min-h-11 resize-y"
        />
        <button type="button" onClick={send} disabled={pending || !text.trim()} className="btn-primary h-11 px-3" aria-label="Send"><SendHorizontal className="h-4 w-4" /></button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
