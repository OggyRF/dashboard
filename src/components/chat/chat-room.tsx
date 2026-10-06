"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ClipboardPlus, MessageSquareReply, Pencil, SendHorizontal, SmilePlus, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { MessageBody } from "@/components/chat/message-body";
import { istClock, istDayLabel } from "@/lib/ist-format";
import { deleteChatAction, editChatAction, loadChannelAction, reactChatAction, sendChatAction } from "@/server/actions/chat";
import type { ChannelView, ChatMessageView } from "@/services/chat";

const POLL_MS = 3000;
const EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"];

// A channel: messages, a box to write in, and a side panel for a thread.
// New messages arrive by asking the server every few seconds while the tab is visible.
export function ChatRoom({ initial, meId, threadId: initialThread, heightClass }: { initial: ChannelView; meId: string; threadId: string | null; heightClass: string }) {
  const [view, setView] = useState(initial);
  const [threadId, setThreadId] = useState(initialThread);
  const channelId = initial.channel.id;
  const names = view.people.map((p) => p.name);

  const reload = useCallback(async (thread = threadId) => {
    const next = await loadChannelAction(channelId, thread);
    if (next) setView(next);
  }, [channelId, threadId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  function openThread(id: string | null) {
    setThreadId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("thread", id);
    else url.searchParams.delete("thread");
    window.history.replaceState(null, "", url);
    void reload(id);
  }

  const readOnly = view.channel.archived;

  return (
    <div className={`card flex overflow-hidden p-0 ${heightClass}`}>
      <div className={`flex min-w-0 flex-1 flex-col ${threadId ? "hidden md:flex" : ""}`}>
        <MessageList
          messages={view.messages}
          meId={meId}
          names={names}
          canMakeTask={view.canMakeTask}
          onThread={openThread}
          onChanged={() => reload()}
          emptyText={`This is the start of #${view.channel.name}.${view.channel.client ? ` Talk about ${view.channel.client.name} here.` : ""}`}
        />
        {readOnly ? (
          <p className="border-t border-border bg-background p-3 text-center text-sm text-muted">This channel is archived.</p>
        ) : (
          <Composer channelId={channelId} parentId={null} people={view.people} placeholder={`Message #${view.channel.name}`} onSent={() => reload()} />
        )}
      </div>
      {threadId && view.thread && (
        <aside className="flex w-full min-w-0 flex-col border-border md:w-96 md:border-l">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="font-bold">Thread</div>
            <button type="button" onClick={() => openThread(null)} aria-label="Close thread" className="cursor-pointer rounded-lg p-1 text-muted hover:bg-background"><X className="h-5 w-5" /></button>
          </div>
          <MessageList
            messages={[view.thread.parent, ...view.thread.replies]}
            meId={meId}
            names={names}
            canMakeTask={view.canMakeTask}
            onChanged={() => reload()}
            emptyText=""
            dividerAfterFirst={view.thread.replies.length}
          />
          {!readOnly && <Composer channelId={channelId} parentId={threadId} people={view.people} placeholder="Reply in thread" onSent={() => reload()} />}
        </aside>
      )}
    </div>
  );
}

function MessageList({
  messages,
  meId,
  names,
  canMakeTask,
  onThread,
  onChanged,
  emptyText,
  dividerAfterFirst,
}: {
  messages: ChatMessageView[];
  meId: string;
  names: string[];
  canMakeTask: boolean;
  onThread?: (id: string) => void;
  onChanged: () => void;
  emptyText: string;
  dividerAfterFirst?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    if (atBottom.current) box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lastId, messages.length]);

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="flex-1 overflow-y-auto px-2 py-4"
    >
      {messages.length === 0 && <p className="px-3 text-sm text-muted">{emptyText}</p>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || day(prev.createdAt) !== day(m.createdAt);
        const compact = !!prev && !newDay && prev.author.id === m.author.id && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000 && !(dividerAfterFirst !== undefined && i === 1);
        return (
          <div key={m.id}>
            {newDay && dividerAfterFirst === undefined && (
              <div className="my-3 flex items-center gap-3 px-3 text-xs font-semibold text-muted">
                <span className="h-px flex-1 bg-border" />
                {day(m.createdAt)}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            {dividerAfterFirst !== undefined && i === 1 && (
              <div className="my-2 flex items-center gap-3 px-3 text-xs text-muted">
                {dividerAfterFirst} repl{dividerAfterFirst === 1 ? "y" : "ies"}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <MessageItem message={m} compact={compact} mine={m.author.id === meId} names={names} canMakeTask={canMakeTask} onThread={onThread} onChanged={onChanged} />
          </div>
        );
      })}
    </div>
  );
}

function MessageItem({
  message: m,
  compact,
  mine,
  names,
  canMakeTask,
  onThread,
  onChanged,
}: {
  message: ChatMessageView;
  compact: boolean;
  mine: boolean;
  names: string[];
  canMakeTask: boolean;
  onThread?: (id: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      onChanged();
    });

  return (
    // Focusable so a tap on a phone shows the action buttons.
    <div tabIndex={0} className={`group relative flex gap-3 rounded-xl px-3 outline-none hover:bg-background/70 focus-within:bg-background/70 ${compact ? "py-0.5" : "mt-2 pt-1.5 pb-0.5"}`}>
      <div className="w-9 shrink-0">{!compact && <Avatar person={m.author} />}</div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className={`text-sm font-bold ${mine ? "text-brand" : ""}`}>{m.author.name}</span>
            <span className="text-[11px] text-muted">{time(m.createdAt)}</span>
          </div>
        )}
        {m.deleted ? (
          <p className="text-sm text-muted italic">Message deleted</p>
        ) : editing ? (
          <div className="space-y-2 py-1">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="field" aria-label="Edit message" />
            <div className="flex gap-2">
              <button type="button" className="btn-primary py-1" onClick={() => act(async () => { const r = await editChatAction(m.id, draft); if (!r.error) setEditing(false); return r; })}>Save</button>
              <button type="button" className="btn-secondary py-1" onClick={() => { setEditing(false); setDraft(m.body); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            <MessageBody text={m.body} names={names} />
            {m.editedAt && <span className="ml-1 text-[11px] text-muted">(edited)</span>}
          </p>
        )}
        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                title={r.names.join(", ")}
                onClick={() => act(() => reactChatAction(m.id, r.emoji))}
                className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${r.mine ? "border-brand bg-brand/10 text-brand" : "border-border bg-surface"}`}
              >
                {r.emoji} <span className="font-semibold">{r.count}</span>
              </button>
            ))}
          </div>
        )}
        {onThread && m.replyCount > 0 && (
          <button type="button" onClick={() => onThread(m.id)} className="mt-1 flex cursor-pointer items-center gap-1 text-xs font-semibold text-brand hover:underline">
            <MessageSquareReply className="h-3.5 w-3.5" />
            {m.replyCount} repl{m.replyCount === 1 ? "y" : "ies"}
            {m.lastReplyAt && <span className="font-normal text-muted">· last {time(m.lastReplyAt)}</span>}
          </button>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      {!m.deleted && !editing && (
        <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
          <IconButton label="React" onClick={() => setPicker((p) => !p)}><SmilePlus className="h-4 w-4" /></IconButton>
          {onThread && <IconButton label="Reply in thread" onClick={() => onThread(m.id)}><MessageSquareReply className="h-4 w-4" /></IconButton>}
          {canMakeTask && (
            <Link href={`/tasks/new?from=${m.id}`} title="Make a task" aria-label="Make a task" className="rounded-md p-1.5 text-muted hover:bg-background hover:text-brand"><ClipboardPlus className="h-4 w-4" /></Link>
          )}
          {m.canEdit && <IconButton label="Edit" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></IconButton>}
          {m.canDelete && (
            <IconButton label="Delete" onClick={() => window.confirm("Delete this message?") && act(() => deleteChatAction(m.id))}><Trash2 className="h-4 w-4" /></IconButton>
          )}
        </div>
      )}
      {picker && (
        <div className="absolute top-5 right-3 z-10 flex gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-lg">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => { setPicker(false); act(() => reactChatAction(m.id, e)); }} className="cursor-pointer rounded-lg p-1 text-lg hover:bg-background" aria-label={`React ${e}`}>{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-background hover:text-brand">
      {children}
    </button>
  );
}

// Message box with @mention suggestions. Enter sends; Shift+Enter is a new line.
function Composer({ channelId, parentId, people, placeholder, onSent }: { channelId: string; parentId: string | null; people: ChannelView["people"]; placeholder: string; onSent: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const matches = query === null ? [] : people.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(query.toLowerCase())) || p.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);

  function onChange(value: string) {
    setText(value);
    const caret = area.current?.selectionStart ?? value.length;
    const m = value.slice(0, caret).match(/(?:^|\s)@([\p{L}]*)$/u);
    setQuery(m ? m[1]! : null);
  }

  function pick(name: string) {
    const caret = area.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\p{L}]*)$/u, `@${name.split(/\s+/)[0]} `);
    setText(before + text.slice(caret));
    setQuery(null);
    area.current?.focus();
  }

  function send() {
    const body = text.trim();
    if (!body || pending) return;
    start(async () => {
      const r = await sendChatAction(channelId, body, parentId);
      if (r.error) setError(r.error);
      else {
        setText("");
        setError(null);
        onSent();
      }
    });
  }

  return (
    <div className="relative border-t border-border bg-surface p-3">
      {matches.length > 0 && (
        <ul className="absolute bottom-full left-3 mb-1 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(p.name); }} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-background">
                <Avatar person={p} size="xs" />{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={area}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (matches.length > 0) pick(matches[0]!.name);
              else send();
            }
            if (e.key === "Escape") setQuery(null);
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder}
          aria-label={placeholder}
          className="field max-h-40 min-h-11 resize-none"
        />
        <button type="button" onClick={send} disabled={pending || !text.trim()} className="btn-primary h-11 px-3" aria-label="Send">
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted">Type @ to mention someone and #12 to link task 12.</p>
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

const time = istClock;
const day = istDayLabel;
