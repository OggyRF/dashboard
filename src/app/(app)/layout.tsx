import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { AttendanceControl } from "@/components/attendance-control";
import { Avatar } from "@/components/avatar";
import { PresenceHeartbeat } from "@/components/presence";
import { Clock } from "@/components/clock";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { NAV_ITEMS, canSee } from "@/lib/nav";
import { logoutAction } from "@/server/actions/auth";
import { getToday } from "@/services/attendance";
import { pendingLeaveCount } from "@/services/leave";
import { unreadThreadCount } from "@/services/messages";
import { listNotifications, unreadNotificationCount } from "@/services/notifications";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/account/password");
  const items = NAV_ITEMS.filter((i) => canSee(user.role, i));
  const tracksAttendance = can(user.role, "attendance.own");
  const [today, notifications, unreadAlerts, leaveCount, messageCount] = await Promise.all([
    tracksAttendance ? getToday(user) : Promise.resolve(null),
    listNotifications(user),
    unreadNotificationCount(user),
    pendingLeaveCount(user),
    unreadThreadCount(user),
  ]);
  const badges = { leave: leaveCount, messages: messageCount };

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-64 shrink-0 bg-sidebar-2 md:block">
      <aside className="sidebar-gradient sticky top-0 flex h-screen flex-col">
        <div className="px-6 pt-6 pb-4">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto">
          <Sidebar items={items} badges={badges} />
        </div>
        <div className="m-3 flex items-center gap-3 rounded-2xl bg-white/6 p-3">
          <Link href="/profile" title="My profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl transition hover:opacity-85">
            <Avatar person={user} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-white">{user.name}</div>
              <div className="text-xs text-white/55">{ROLE_LABELS[user.role]}</div>
            </div>
          </Link>
          <form action={logoutAction}>
            <button type="submit" title="Sign out" aria-label="Sign out" className="cursor-pointer rounded-lg p-2 text-white/60 transition hover:bg-white/10 hover:text-white">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-surface/85 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
            {/* Phones: logo and alerts on the first row, clock and timer below. */}
            <div className="order-1 md:hidden">
              <Logo tone="dark" />
            </div>
            <div className="order-3 flex w-full flex-wrap items-center gap-x-6 gap-y-3 md:order-1 md:w-auto">
              <Clock />
              {today && <AttendanceControl key={today.asOf} initial={today} />}
              {today && <PresenceHeartbeat state={today.summary.state} />}
            </div>
            <div className="order-2 flex items-center gap-2">
              <NotificationBell items={notifications} unread={unreadAlerts} />
              <Link href="/profile" title="My profile" aria-label="My profile" className="rounded-full ring-2 ring-transparent transition hover:ring-brand/40">
                <Avatar person={user} />
              </Link>
              <form action={logoutAction} className="md:hidden">
                <button type="submit" className="btn-secondary px-2.5" aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
          {/* Small screens: the sidebar becomes a scrolling row of links. */}
          <div className="overflow-x-auto border-t border-border/70 md:hidden">
            <div className="w-max">
              <Sidebar items={items} badges={badges} layout="row" />
            </div>
          </div>
        </header>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
