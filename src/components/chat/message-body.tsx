import Link from "next/link";
import { Fragment } from "react";

// Turns links, #task numbers and @mentions in a chat message into links and
// highlights. Plain text otherwise; nothing from the message is run as HTML.
const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(^|\s)(#\d{1,7})\b|(@[\p{L}][\p{L}\d._-]*(?:\s[\p{Lu}][\p{L}]*)?)/gu;

export function MessageBody({ text, names }: { text: string; names: string[] }) {
  const known = names.map((n) => n.toLowerCase());
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, url, lead, task, mention] = m;
    const start = m.index!;
    parts.push(text.slice(last, start));
    if (url) {
      parts.push(<a key={start} href={url} target="_blank" rel="noreferrer" className="break-all text-brand underline-offset-2 hover:underline">{url}</a>);
    } else if (task) {
      parts.push(lead);
      parts.push(<Link key={start} href={`/tasks/${task.slice(1)}`} className="rounded bg-brand/10 px-1 font-semibold text-brand hover:underline">{task}</Link>);
    } else if (mention) {
      const handle = mention.slice(1).toLowerCase();
      const hit = known.some((n) => n === handle || n.split(/\s+/)[0] === handle.split(/\s+/)[0]);
      parts.push(hit ? <span key={start} className="rounded bg-brand/10 px-1 font-semibold text-brand">{mention}</span> : <Fragment key={start}>{mention}</Fragment>);
    } else {
      parts.push(whole);
    }
    last = start + whole.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
