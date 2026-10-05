import { navItem } from "@/lib/nav";

export function ComingSoon({ href, children }: { href: string; children?: React.ReactNode }) {
  const item = navItem(href);
  return (
    <div className="card max-w-2xl">
      <h1 className="text-xl font-semibold">{item.label}</h1>
      <p className="mt-2 text-sm text-muted">
        This section is built in Phase {item.phase} of the plan.
      </p>
      {children}
    </div>
  );
}
