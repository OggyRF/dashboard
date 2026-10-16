import { ArrowDownRight, ArrowUpRight } from "lucide-react";

// A number with its change against the period before.
export function Stat({ label, value, now, before, tone, lowerIsBetter = false }: { label: string; value: string; now: number; before?: number; tone?: "brand"; lowerIsBetter?: boolean }) {
  let change: { text: string; good: boolean; up: boolean } | null = null;
  if (before !== undefined && before > 0) {
    const pct = ((now - before) / before) * 100;
    if (Math.abs(pct) >= 0.05) change = { text: `${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`, up: pct > 0, good: lowerIsBetter ? pct < 0 : pct > 0 };
  }
  return (
    <div className={`card ${tone === "brand" ? "brand-gradient text-brand-ink" : ""}`}>
      <div className={`text-xs font-semibold tracking-wide uppercase ${tone ? "opacity-80" : "text-muted"}`}>{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {change ? (
        <div className={`mt-1 inline-flex items-center gap-0.5 text-xs font-semibold ${tone ? "" : change.good ? "text-success" : "text-danger"}`}>
          {change.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {change.text}
        </div>
      ) : (
        <div className={`mt-1 text-xs ${tone ? "opacity-80" : "text-muted"}`}>{before === undefined ? "No earlier data" : "No change"}</div>
      )}
    </div>
  );
}
