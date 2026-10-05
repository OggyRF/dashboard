import Link from "next/link";
import { redirect } from "next/navigation";
import { AttendanceControl } from "@/components/attendance-control";
import { Clock } from "@/components/clock";
import { NotificationBell } from "@/components/notification-bell";
import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { NAV_ITEMS } from "@/lib/nav";
import { logoutAction } from "@/server/actions/auth";
import { getToday } from "@/services/attendance";
import { pendingLeaveCount } from "@/services/leave";
import { unreadThreadCount } from "@/services/messages";
import { listNotifications, unreadNotificationCount } from "@/services/notifications";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/account/password");
  const items = NAV_ITEMS.filter((i) => can(user.role, i.permission));
  const [today, notifications, unreadAlerts, leaveCount, messageCount] = await Promise.all([
    getToday(user),
    listNotifications(user),
    unreadNotificationCount(user),
    pendingLeaveCount(user),
    unreadThreadCount(user),
  ]);
  const badges = { leave: leaveCount, messages: messageCount };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-border bg-surface md:block">
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-semibold">HI Digital</div>
          <div className="text-xs text-muted">Team dashboard</div>
        </div>
        <Sidebar items={items} badges={badges} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3">
          <div className="flex flex-wrap items-center gap-6">
            <Clock />
            <AttendanceControl key={today.asOf} initial={today} />
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell items={notifications} unread={unreadAlerts} />
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
            <Sidebar items={items} badges={badges} />
          </div>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
