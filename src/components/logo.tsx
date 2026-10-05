// Wordmark in the style of the hidigital.co.in header: "Hi" in the brand colour.
export function Logo({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <div className="leading-tight">
      <div className={`text-2xl font-extrabold tracking-tight ${tone === "light" ? "text-white" : "text-foreground"}`}>
        <span className="text-brand">Hi</span> Digital
      </div>
      <div className={`text-[11px] font-semibold tracking-widest uppercase ${tone === "light" ? "text-white/50" : "text-muted"}`}>Team dashboard</div>
    </div>
  );
}
