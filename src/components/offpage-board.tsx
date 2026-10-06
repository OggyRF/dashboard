"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { istShortDateTime } from "@/lib/ist-format";
import { rejectItemAction, tickItemAction } from "@/server/actions/offpage";

type Person = { id: string; name: string; avatarUpdatedAt: Date | null };
export type BoardItem = {
  id: string;
  week: number;
  assigneeId: string | null;
  doneAt: Date | null;
  doneBy: Person | null;
  proofUrl: string | null;
  rejectedAt: Date | null;
  rejectedBy: Person | null;
  rejectReason: string | null;
};
export type BoardRow = {
  activity: { id: string; name: string; removedAt: Date | null; assignee: Person | null; reviewer: Person | null };
  weeks: BoardItem[][];
  done: number;
  planned: number;
  canReview: boolean;
};

// The checklist grid: a row per activity, a column per week, a box per item.
export function OffpageBoard({ rows, currentWeek, meId, fullAccess }: { rows: BoardRow[]; currentWeek: number; meId: string; fullAccess: boolean }) {
  const [open, setOpen] = useState<{ item: BoardItem; row: BoardRow } | null>(null);
  if (!rows.length) return null;
  return (
    <>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background/60 text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">Activity</th>
              {[1, 2, 3, 4].map((w) => (
                <th key={w} className={`px-3 py-3 font-semibold ${w === currentWeek ? "text-brand" : ""}`}>
                  Week {w}{w === currentWeek ? " · now" : ""}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-semibold">Done</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.activity.id} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-3">
                  <div className="font-semibold">{row.activity.name}{row.activity.removedAt && <span className="ml-1 text-xs font-normal text-muted">(removed)</span>}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    {row.activity.assignee ? <><Avatar person={row.activity.assignee} size="xs" />{row.activity.assignee.name.split(" ")[0]}</> : "Nobody assigned"}
                    {row.activity.reviewer && <span>· checked by {row.activity.reviewer.name.split(" ")[0]}</span>}
                  </div>
                </td>
                {row.weeks.map((items, i) => (
                  <td key={i} className={`px-3 py-3 ${i + 1 === currentWeek ? "bg-brand/[0.03]" : ""}`}>
                    <div className="flex max-w-40 flex-wrap gap-1.5">
                      {items.map((item) => (
                        <Box key={item.id} item={item} missed={i + 1 < currentWeek && !item.doneAt} onClick={() => setOpen({ item, row })} />
                      ))}
                      {items.length === 0 && <span className="text-xs text-muted">–</span>}
                    </div>
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">
                  {row.done}/{row.planned}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <ItemDialog
          item={open.item}
          title={open.row.activity.name}
          assigneeName={open.row.activity.assignee?.name}
          canReview={open.row.canReview}
          canTick={fullAccess || open.item.assigneeId === meId}
          canUntick={fullAccess || open.item.doneBy?.id === meId}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

export function Box({ item, missed, onClick }: { item: BoardItem; missed: boolean; onClick: () => void }) {
  const done = !!item.doneAt;
  const rejected = !done && !!item.rejectReason;
  return (
    <button
      type="button"
      onClick={onClick}
      title={done ? `Done by ${item.doneBy?.name ?? "someone"}` : rejected ? `Sent back: ${item.rejectReason}` : missed ? "Not done in its week" : "To do"}
      aria-label={done ? "Done" : rejected ? "Sent back" : "To do"}
      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-2 transition hover:scale-110 ${
        done
          ? "border-success bg-success text-white"
          : rejected
            ? "border-danger bg-danger/10 text-danger"
            : missed
              ? "border-danger/40 bg-surface"
              : "border-border bg-surface hover:border-brand"
      }`}
    >
      {done && <Check className="h-4 w-4" strokeWidth={3} />}
      {rejected && <X className="h-4 w-4" strokeWidth={3} />}
    </button>
  );
}

export function ItemDialog({
  item,
  title,
  assigneeName,
  canReview,
  canTick,
  canUntick,
  onClose,
}: {
  item: BoardItem;
  title: string;
  assigneeName?: string;
  canReview: boolean;
  canTick: boolean;
  canUntick: boolean;
  onClose: () => void;
}) {
  const [proof, setProof] = useState(item.proofUrl ?? "");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
      else onClose();
    });
  const when = istShortDateTime;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} className="card w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="text-sm text-muted">Week {item.week}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-lg p-1 text-muted hover:bg-background"><X className="h-5 w-5" /></button>
        </div>

        {item.doneAt ? (
          <div className="space-y-2 rounded-xl bg-success/10 p-3 text-sm">
            <p className="font-semibold text-success">Done by {item.doneBy?.name ?? "someone"} on {when(item.doneAt)}</p>
            {item.proofUrl ? (
              <a href={item.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-brand hover:underline">
                {item.proofUrl}<ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            ) : (
              <p className="text-muted">No proof link added.</p>
            )}
          </div>
        ) : (
          <>
            {item.rejectReason && (
              <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
                Sent back by {item.rejectedBy?.name ?? "the reviewer"}: {item.rejectReason}
              </p>
            )}
            {canTick ? (
              <div>
                <label htmlFor="proof" className="label">Proof link (the live URL)</label>
                <input id="proof" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="https://…" className="field" />
              </div>
            ) : (
              <p className="text-sm text-muted">Only {assigneeName ?? "the assigned person"} can tick this.</p>
            )}
          </>
        )}

        {rejecting && (
          <div>
            <label htmlFor="reason" className="label">What is wrong?</label>
            <textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="field" placeholder="e.g. The link is nofollow" />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {!item.doneAt && canTick && (
            <button type="button" disabled={pending} onClick={() => run(() => tickItemAction(item.id, true, proof))} className="btn-primary">
              <Check className="h-4 w-4" />Mark done
            </button>
          )}
          {item.doneAt && !rejecting && canReview && (
            <button type="button" onClick={() => setRejecting(true)} className="btn-danger">Send back</button>
          )}
          {rejecting && (
            <button type="button" disabled={pending} onClick={() => run(() => rejectItemAction(item.id, reason))} className="btn-danger">Send back with reason</button>
          )}
          {item.doneAt && canUntick && !rejecting && (
            <button type="button" disabled={pending} onClick={() => run(() => tickItemAction(item.id, false))} className="btn-secondary">Untick</button>
          )}
        </div>
      </div>
    </div>
  );
}
