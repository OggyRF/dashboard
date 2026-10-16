import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

// A number with the period before under it, and the change between them.
// `format` writes the numbers; counts also show the difference ("+202").
export function Stat({
  label,
  value,
  now,
  before,
  format,
  isCount = false,
  tone,
  lowerIsBetter = false,
  href,
  active = false,
}: {
  label: string;
  value: string;
  now: number;
  before?: number;
  format: (n: number) => string;
  isCount?: boolean;
  tone?: "brand";
  lowerIsBetter?: boolean;
  href?: string;
  active?: boolean;
}) {
  const brand = tone === "brand" || active;
  let change: { text: string; good: boolean; up: boolean } | null = null;
  if (before !== undefined && now !== before) {
    const up = now > before;
    const pct = before > 0 ? ((now - before) / before) * 100 : null;
    const parts = [isCount ? `${up ? "+" : "−"}${format(Math.abs(now - before))}` : null, pct !== null ? `${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%` : null].filter(Boolean);
    change = { text: parts.join(" · "), up, good: lowerIsBetter ? !up : up };
  }
  const body = (
    <>
      <div className={`text-xs font-semibold tracking-wide uppercase ${brand ? "opacity-80" : "text-muted"}`}>{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className={`mt-1 text-xs tabular-nums ${brand ? "opacity-80" : "text-muted"}`}>{before === undefined ? "No earlier data" : `Before: ${format(before)}`}</div>
      {change ? (
        <div className={`mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold ${brand ? "" : change.good ? "text-success" : "text-danger"}`}>
          {change.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {change.text}
        </div>
      ) : (
        before !== undefined && <div className={`mt-0.5 text-xs ${brand ? "opacity-80" : "text-muted"}`}>No change</div>
      )}
    </>
  );
  const cls = `card block ${brand ? "brand-gradient text-brand-ink" : ""}`;
  return href ? (
    <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={`${cls} transition ${active ? "" : "hover:border-brand"}`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
