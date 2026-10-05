import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock } from "@/components/clock";
import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { NAV_ITEMS } from "@/lib/nav";
import { logoutAction } from "@/server/actions/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/account/password");
  const items = NAV_ITEMS.filter((i) => can(user.role, i.permission));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-border bg-surface md:block">
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-semibold">HI Digital</div>
          <div className="text-xs text-muted">Team dashboard</div>
        </div>
        <Sidebar items={items} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3">
          <Clock />
          <div className="flex items-center gap-4">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-muted">{ROLE_LABELS[user.role]}</div>
            </div>
            <Link href="/account/password" className="btn-secondary">Password</Link>
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary">Sign out</button>
            </form>
          </div>
        </header>
        {/* Small screens: the sidebar becomes a scrolling row of links. */}
        <div className="overflow-x-auto border-b border-border bg-surface md:hidden">
          <div className="flex w-max">
            <Sidebar items={items} />
          </div>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
