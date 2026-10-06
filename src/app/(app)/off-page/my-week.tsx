"use client";

import { useState } from "react";
import Link from "next/link";
import { Box, ItemDialog, type BoardItem } from "@/components/offpage-board";

type Group = {
  client: { id: string; name: string };
  activity: { id: string; name: string };
  thisWeek: BoardItem[];
  leftOver: BoardItem[];
};

// An off-page person's list: each client and activity with this week's boxes
// and anything still open from earlier weeks.
export function MyWeek({ groups }: { groups: Group[] }) {
  const [open, setOpen] = useState<{ item: BoardItem; title: string } | null>(null);
  return (
    <>
      <ul className="card divide-y divide-border p-0">
        {groups.map((g) => {
          const done = g.thisWeek.filter((i) => i.doneAt).length;
          return (
            <li key={`${g.client.id}:${g.activity.id}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(12rem,1fr)_auto_3.5rem] sm:items-center">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{g.activity.name}</div>
                  <Link href={`/clients/${g.client.id}/off-page`} className="text-sm text-muted hover:text-brand">{g.client.name}</Link>
                </div>
                <div className="text-sm font-semibold tabular-nums sm:hidden">{done}/{g.thisWeek.length}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {g.leftOver.map((item) => (
                  <Box key={item.id} item={item} missed onClick={() => setOpen({ item, title: `${g.activity.name} · ${g.client.name}` })} />
                ))}
                {g.leftOver.length > 0 && g.thisWeek.length > 0 && <span className="mx-1 h-6 w-px bg-border" />}
                {g.thisWeek.map((item) => (
                  <Box key={item.id} item={item} missed={false} onClick={() => setOpen({ item, title: `${g.activity.name} · ${g.client.name}` })} />
                ))}
              </div>
              <div className="hidden text-right text-sm font-semibold tabular-nums sm:block">{done}/{g.thisWeek.length}</div>
            </li>
          );
        })}
      </ul>
      {open && <ItemDialog item={open.item} title={open.title} canReview={false} canTick canUntick onClose={() => setOpen(null)} />}
    </>
  );
}
