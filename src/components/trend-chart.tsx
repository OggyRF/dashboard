import { formatDayKey } from "@/lib/dates";

type Point = { key: string; clicks: number; impressions: number };

const W = 800;
const H = 240;
const PAD = { top: 16, right: 56, bottom: 28, left: 48 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const short = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

// Clicks (red, left scale) and impressions (dark, right scale) over time, as
// in Search Console. Hovering a day shows its numbers.
export function TrendChart({ points, weekly = false }: { points: Point[]; weekly?: boolean }) {
  if (points.length === 0) return <p className="py-10 text-center text-sm text-muted">No data for this period yet.</p>;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxC = niceMax(Math.max(...points.map((p) => p.clicks)));
  const maxI = niceMax(Math.max(...points.map((p) => p.impressions)));
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => PAD.left + (points.length > 1 ? i * step : innerW / 2);
  const yC = (v: number) => PAD.top + innerH - (v / maxC) * innerH;
  const yI = (v: number) => PAD.top + innerH - (v / maxI) * innerH;
  const line = (y: (v: number) => number, k: "clicks" | "impressions") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const area = `${line(yC, "clicks")} L${x(points.length - 1).toFixed(1)},${PAD.top + innerH} L${x(0).toFixed(1)},${PAD.top + innerH} Z`;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const fmt = (key: string) => formatDayKey(key, { day: "numeric", month: "short" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Clicks and impressions over time">
      <defs>
        <linearGradient id="clicks-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = PAD.top + innerH - f * innerH;
        return (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray={f ? "3 4" : undefined} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--brand)">{short.format(maxC * f)}</text>
            <text x={W - PAD.right + 8} y={y + 4} fontSize="11" fill="var(--muted)">{short.format(maxI * f)}</text>
          </g>
        );
      })}
      <path d={area} fill="url(#clicks-fill)" />
      <path d={line(yI, "impressions")} fill="none" stroke="var(--foreground)" strokeOpacity="0.55" strokeWidth="1.8" strokeLinejoin="round" />
      <path d={line(yC, "clicks")} fill="none" stroke="var(--brand)" strokeWidth="2.4" strokeLinejoin="round" />
      {points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={`l${p.key}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmt(p.key)}</text>
        ) : null,
      )}
      {points.map((p, i) => (
        <g key={p.key} className="group">
          <rect x={x(i) - Math.max(step, 8) / 2} y={PAD.top} width={Math.max(step, 8)} height={innerH} fill="transparent">
            <title>{`${weekly ? "Week of " : ""}${formatDayKey(p.key, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}\nClicks: ${p.clicks.toLocaleString("en-IN")}\nImpressions: ${p.impressions.toLocaleString("en-IN")}`}</title>
          </rect>
          <circle cx={x(i)} cy={yC(p.clicks)} r="3.5" fill="var(--brand)" className="pointer-events-none opacity-0 group-hover:opacity-100" />
          <circle cx={x(i)} cy={yI(p.impressions)} r="3" fill="var(--foreground)" className="pointer-events-none opacity-0 group-hover:opacity-100" />
        </g>
      ))}
    </svg>
  );
}
