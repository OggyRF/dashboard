import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { NAV_ITEMS } from "@/lib/nav";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const params = await searchParams;
  const upcoming = NAV_ITEMS.filter((i) => i.phase > 0 && can(user.role, i.permission));

  return (
    <div className="max-w-4xl space-y-6">
      {params.password === "changed" && (
        <p className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-success">Your password was changed.</p>
      )}
      {params.denied === "1" && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">You do not have access to that page.</p>
      )}
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.name.split(" ")[0]}</h1>
        <p className="text-sm text-muted">Signed in as {ROLE_LABELS[user.role]}.</p>
      </div>
      <div className="card">
        <h2 className="font-semibold">What is coming</h2>
        <p className="mt-1 text-sm text-muted">These sections appear as each phase is built.</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {upcoming.map((i) => (
            <li key={i.href} className="flex justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span>{i.label}</span>
              <span className="text-muted">Phase {i.phase}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
