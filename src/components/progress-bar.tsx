// A thin bar with "done of planned"; red when a finished week fell short.
export function ProgressBar({ done, planned, label, short = false, size = "md" }: { done: number; planned: number; label?: string; short?: boolean; size?: "sm" | "md" }) {
  const pct = planned ? Math.round((done / planned) * 100) : 0;
  const tone = planned === 0 ? "bg-border" : done >= planned ? "bg-success" : short ? "bg-danger" : "brand-gradient";
  return (
    <div className="min-w-0">
      {label !== undefined && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold">{label}</span>
          <span className={`tabular-nums ${short && done < planned ? "font-semibold text-danger" : "text-muted"}`}>
            {planned ? `${done}/${planned}` : "–"}
          </span>
        </div>
      )}
      <div className={`overflow-hidden rounded-full bg-background ${size === "sm" ? "h-1.5" : "h-2.5"}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full transition-[width] ${tone}`} style={{ width: `${planned ? Math.max(pct, done ? 4 : 0) : 0}%` }} />
      </div>
    </div>
  );
}
