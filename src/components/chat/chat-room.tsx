"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { ClipboardPlus, ImagePlus, MessageSquareReply, Pencil, Reply, SendHorizontal, SmilePlus, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { MessageBody } from "@/components/chat/message-body";
import { istClock, istDayLabel } from "@/lib/ist-format";
import { deleteChatAction, editChatAction, loadChannelAction, reactChatAction, sendChatAction } from "@/server/actions/chat";
import { TASK_STATUS_LABELS } from "@/lib/task-labels";
import type { ChannelView, ChatMessageView } from "@/services/chat";

type Quote = { id: string; author: string; text: string; images: number };
type TaskOption = ChannelView["tasks"][number];

// Highlights a message briefly after jumping to it from a quote.
function jumpTo(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-brand/40");
  setTimeout(() => el.classList.remove("ring-2", "ring-brand/40"), 1600);
}

function quoteOf(m: ChatMessageView): Quote {
  return { id: m.id, author: m.author.name, text: m.body.slice(0, 160), images: m.images.length };
}

const POLL_MS = 3000;
const EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"];

// A channel: messages, a box to write in, and a side panel for a thread.
// New messages arrive by asking the server every few seconds while the tab is visible.
export function ChatRoom({ initial, meId, threadId: initialThread, heightClass }: { initial: ChannelView; meId: string; threadId: string | null; heightClass: string }) {
  const [view, setView] = useState(initial);
  const [threadId, setThreadId] = useState(initialThread);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [threadQuote, setThreadQuote] = useState<Quote | null>(null);
  const channelId = initial.channel.id;
  const names = view.people.map((p) => p.name);
  const taskTitles = Object.fromEntries(view.tasks.map((t) => [t.number, t.title]));

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
          taskTitles={taskTitles}
          onThread={openThread}
          onQuote={(m) => setQuote(quoteOf(m))}
          onChanged={() => reload()}
          emptyText={`This is the start of #${view.channel.name}.${view.channel.client ? ` Talk about ${view.channel.client.name} here.` : ""}`}
        />
        {readOnly ? (
          <p className="border-t border-border bg-background p-3 text-center text-sm text-muted">This channel is archived.</p>
        ) : (
          <Composer channelId={channelId} parentId={null} people={view.people} tasks={view.tasks} quote={quote} onClearQuote={() => setQuote(null)} placeholder={`Message #${view.channel.name}`} onSent={() => reload()} />
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
            taskTitles={taskTitles}
            onQuote={(m) => setThreadQuote(quoteOf(m))}
            onChanged={() => reload()}
            emptyText=""
            dividerAfterFirst={view.thread.replies.length}
          />
          {!readOnly && (
            <Composer channelId={channelId} parentId={threadId} people={view.people} tasks={view.tasks} quote={threadQuote} onClearQuote={() => setThreadQuote(null)} placeholder="Reply in thread" onSent={() => reload()} />
          )}
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
  taskTitles,
  onThread,
  onQuote,
  onChanged,
  emptyText,
  dividerAfterFirst,
}: {
  messages: ChatMessageView[];
  meId: string;
  names: string[];
  canMakeTask: boolean;
  taskTitles: Record<number, string>;
  onThread?: (id: string) => void;
  onQuote: (m: ChatMessageView) => void;
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
            <MessageItem message={m} compact={compact} mine={m.author.id === meId} names={names} canMakeTask={canMakeTask} taskTitles={taskTitles} onThread={onThread} onQuote={onQuote} onChanged={onChanged} />
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
  taskTitles,
  onThread,
  onQuote,
  onChanged,
}: {
  message: ChatMessageView;
  compact: boolean;
  mine: boolean;
  names: string[];
  canMakeTask: boolean;
  taskTitles: Record<number, string>;
  onThread?: (id: string) => void;
  onQuote: (m: ChatMessageView) => void;
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
    <div id={`msg-${m.id}`} tabIndex={0} className={`group relative flex gap-3 rounded-xl px-3 outline-none transition hover:bg-background/70 focus-within:bg-background/70 ${compact ? "py-0.5" : "mt-2 pt-1.5 pb-0.5"}`}>
      <div className="w-9 shrink-0">{!compact && <Avatar person={m.author} />}</div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className={`text-sm font-bold ${mine ? "text-brand" : ""}`}>{m.author.name}</span>
            <span className="text-[11px] text-muted">{time(m.createdAt)}</span>
          </div>
        )}
        {m.replyTo && !m.deleted && (
          <button
            type="button"
            onClick={() => jumpTo(m.replyTo!.id)}
            className="mt-0.5 mb-1 block w-full max-w-md cursor-pointer rounded-lg border-l-4 border-brand bg-brand/5 px-3 py-1.5 text-left text-xs hover:bg-brand/10"
          >
            <span className="block font-semibold text-brand">{m.replyTo.author}</span>
            <span className="line-clamp-2 text-muted">
              {m.replyTo.deleted ? "Message deleted" : m.replyTo.text || (m.replyTo.images ? `📷 ${m.replyTo.images === 1 ? "Picture" : `${m.replyTo.images} pictures`}` : "")}
            </span>
          </button>
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
          <>
            {m.body && (
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                <MessageBody text={m.body} names={names} tasks={taskTitles} />
                {m.editedAt && <span className="ml-1 text-[11px] text-muted">(edited)</span>}
              </p>
            )}
            {m.images.length > 0 && <Pictures images={m.images} />}
          </>
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
          <IconButton label="Reply to this message" onClick={() => onQuote(m)}><Reply className="h-4 w-4" /></IconButton>
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

function Pictures({ images }: { images: ChatMessageView["images"] }) {
  return (
    <div className={`mt-1 grid max-w-md gap-1.5 ${images.length > 1 ? "grid-cols-2" : ""}`}>
      {images.map((img) => (
        <a key={img.id} href={`/api/chat-image/${img.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element -- private pictures served by our own route */}
          <img
            src={`/api/chat-image/${img.id}`}
            alt="Shared picture"
            loading="lazy"
            width={img.width ?? undefined}
            height={img.height ?? undefined}
            className={`h-auto w-full object-cover ${images.length > 1 ? "aspect-square" : "max-h-72"}`}
          />
        </a>
      ))}
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

// Shrinks a picture to at most 1600px on its long side (1200px if still big)
// and re-encodes it as JPEG, so uploads stay well under the 1 MB limit.
async function shrink(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const [max, quality] of [[1600, 0.82], [1200, 0.72], [900, 0.65]] as const) {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("resize failed"))), "image/jpeg", quality));
      if (blob.size <= 950 * 1024) return { blob, width, height };
    }
    throw new Error("too large");
  } finally {
    bitmap.close();
  }
}

type Picked = { key: string; blob: Blob; width: number; height: number; url: string };
const MAX_PICTURES = 4;

// Message box. @ suggests people, # suggests tasks (most recently changed
// first), pictures can be attached or pasted, and a quoted message shows
// above the box. Enter sends; Shift+Enter is a new line.
function Composer({
  channelId,
  parentId,
  people,
  tasks,
  quote,
  onClearQuote,
  placeholder,
  onSent,
}: {
  channelId: string;
  parentId: string | null;
  people: ChannelView["people"];
  tasks: TaskOption[];
  quote: Quote | null;
  onClearQuote: () => void;
  placeholder: string;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [trigger, setTrigger] = useState<{ kind: "@" | "#"; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [pictures, setPictures] = useState<Picked[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (quote) area.current?.focus();
  }, [quote]);

  const q = trigger?.query.toLowerCase() ?? "";
  const personMatches =
    trigger?.kind === "@" ? people.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q)).slice(0, 6) : [];
  const taskMatches = trigger?.kind === "#" ? tasks.filter((t) => !q || String(t.number).startsWith(q) || t.title.toLowerCase().includes(q)).slice(0, 8) : [];
  const count = personMatches.length || taskMatches.length;

  function onChange(value: string) {
    setText(value);
    const caret = area.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const at = before.match(/(?:^|\s)@([\p{L}]*)$/u);
    const hash = before.match(/(?:^|\s)#([\p{L}\d-]*)$/u);
    setTrigger(at ? { kind: "@", query: at[1]! } : hash ? { kind: "#", query: hash[1]! } : null);
    setActive(0);
  }

  function insert(pattern: RegExp, replacement: string) {
    const caret = area.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(pattern, replacement);
    setText(before + text.slice(caret));
    setTrigger(null);
    caretAt.current = before.length;
  }

  // Puts the caret after an inserted @name or #task once the text has updated.
  const caretAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretAt.current === null) return;
    area.current?.focus();
    area.current?.setSelectionRange(caretAt.current, caretAt.current);
    caretAt.current = null;
  }, [text]);
  const pickPerson = (name: string) => insert(/@([\p{L}]*)$/u, `@${name.split(/\s+/)[0]} `);
  const pickTask = (n: number) => insert(/#([\p{L}\d-]*)$/u, `#${n} `);

  async function addPictures(files: Blob[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    const room = MAX_PICTURES - pictures.length;
    if (room <= 0) return setError(`Send at most ${MAX_PICTURES} pictures at a time.`);
    try {
      const shrunk = await Promise.all(images.slice(0, room).map(shrink));
      setPictures((p) => [...p, ...shrunk.map((s) => ({ ...s, key: Math.random().toString(36).slice(2), url: URL.createObjectURL(s.blob) }))]);
      setError(images.length > room ? `Only the first ${room} picture${room === 1 ? " was" : "s were"} added (${MAX_PICTURES} at most).` : null);
    } catch {
      setError("That picture could not be read, or is too large.");
    }
  }

  function removePicture(key: string) {
    setPictures((p) => {
      const gone = p.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((x) => x.key !== key);
    });
  }

  function send() {
    const body = text.trim();
    if ((!body && !pictures.length) || pending) return;
    start(async () => {
      const form = new FormData();
      form.set("channelId", channelId);
      form.set("body", body);
      if (parentId) form.set("parentId", parentId);
      if (quote) form.set("replyToId", quote.id);
      for (const p of pictures) {
        form.append("image", p.blob, "picture.jpg");
        form.append("imageWidth", String(p.width));
        form.append("imageHeight", String(p.height));
      }
      const r = await sendChatAction(form);
      if (r.error) setError(r.error);
      else {
        setText("");
        setError(null);
        pictures.forEach((p) => URL.revokeObjectURL(p.url));
        setPictures([]);
        onClearQuote();
        onSent();
      }
    });
  }

  return (
    <div className="relative border-t border-border bg-surface p-3">
      {personMatches.length > 0 && (
        <ul className="absolute bottom-full left-3 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {personMatches.map((p, i) => (
            <li key={p.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pickPerson(p.name); }} className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-background ${i === active ? "bg-background" : ""}`}>
                <Avatar person={p} size="xs" />{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {trigger?.kind === "#" && (
        <div className="absolute right-3 bottom-full left-3 z-10 mb-1 max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Tasks, latest first</div>
          {taskMatches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">{tasks.length ? "No task matches." : "No tasks yet."}</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {taskMatches.map((t, i) => (
                <li key={t.number}>
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); pickTask(t.number); }} className={`flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-background ${i === active ? "bg-background" : ""}`}>
                    <span className="font-semibold text-brand tabular-nums">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="shrink-0 text-[11px] text-muted">{t.client} · {TASK_STATUS_LABELS[t.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {quote && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-brand bg-brand/5 px-3 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-brand">Replying to {quote.author}</div>
            <div className="truncate text-muted">{quote.text || (quote.images ? "📷 Picture" : "")}</div>
          </div>
          <button type="button" onClick={onClearQuote} aria-label="Cancel reply" className="cursor-pointer rounded p-0.5 text-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      )}
      {pictures.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pictures.map((p) => (
            <div key={p.key} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a picture about to be sent */}
              <img src={p.url} alt="Picture to send" className="h-16 w-16 rounded-lg border border-border object-cover" />
              <button type="button" onClick={() => removePicture(p.key)} aria-label="Remove picture" className="absolute -top-1.5 -right-1.5 cursor-pointer rounded-full bg-foreground p-0.5 text-white"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void addPictures([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={pending || pictures.length >= MAX_PICTURES} className="btn-secondary h-11 px-3" aria-label="Add a picture" title="Add a picture">
          <ImagePlus className="h-4 w-4" />
        </button>
        <textarea
          ref={area}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (files.length) {
              e.preventDefault();
              void addPictures(files);
            }
          }}
          onKeyDown={(e) => {
            if (count > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && count > 0 && !e.shiftKey) {
              e.preventDefault();
              if (personMatches.length) pickPerson(personMatches[Math.min(active, personMatches.length - 1)]!.name);
              else pickTask(taskMatches[Math.min(active, taskMatches.length - 1)]!.number);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape") {
              if (trigger) setTrigger(null);
              else if (quote) onClearQuote();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder}
          aria-label={placeholder}
          className="field max-h-40 min-h-11 resize-none"
        />
        <button type="button" onClick={send} disabled={pending || (!text.trim() && !pictures.length)} className="btn-primary h-11 px-3" aria-label="Send">
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 hidden text-[11px] text-muted sm:block">Type @ to mention someone and # to pick a task. Paste or attach pictures.</p>
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

const time = istClock;
const day = istDayLabel;
