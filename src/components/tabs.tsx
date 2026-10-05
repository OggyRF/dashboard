import Link from "next/link";

export function Tabs({ tabs, active }: { tabs: { href: string; label: string }[]; active: string }) {
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${t.href === active ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-foreground"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
