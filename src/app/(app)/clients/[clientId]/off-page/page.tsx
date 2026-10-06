import { MonthNav } from "@/components/month-nav";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/current-user";
import { isValidMonth } from "@/lib/dates";
import { db } from "@/lib/db";
import { listTeam, visibleClients } from "@/services/clients";
import { ACTIVITY_SUGGESTIONS, WEEK_RANGES, clientMonth, currentMonth, monthLabel, monthPlan } from "@/services/offpage";
import { OffpageBoard } from "@/components/offpage-board";
import { MonthPlan } from "./month-plan";
import { OffpagePlanner } from "./planner";

export default async function ClientOffpage({ params, searchParams }: PageProps<"/clients/[clientId]/off-page">) {
  const user = await requireUser();
  const { clientId } = await params;
  const sp = await searchParams;
  const month = typeof sp.month === "string" && isValidMonth(sp.month) ? sp.month : currentMonth();
  const view = await clientMonth(user, clientId, month);

  const planner = view.canPlan
    ? await Promise.all([
        db.offpageActivity.findMany({
          where: { clientId, removedAt: null, onlyMonth: null },
          orderBy: { position: "asc" },
          include: { assignee: { select: { name: true } }, reviewer: { select: { name: true } } },
        }),
        listTeam(),
        db.client.findMany({
          where: { AND: [visibleClients(user), { id: { not: clientId } }, { offpageActivities: { some: { removedAt: null, onlyMonth: null } } }] },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
    : null;
  const thisMonthPlan = view.canPlan && month >= currentMonth() ? await monthPlan(user, clientId, month) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} />
        {view.isCurrent && <span className="chip bg-brand/10 text-brand">Now in week {view.currentWeek} (days {WEEK_RANGES[view.currentWeek]})</span>}
      </div>

      {view.total.planned > 0 ? (
        <>
          <section className="card grid gap-5 sm:grid-cols-5">
            {view.weeks.map((w) => (
              <div key={w.week} className={w.week === view.currentWeek ? "rounded-xl bg-brand/5 p-2 -m-2" : ""}>
                <ProgressBar label={`Week ${w.week}`} done={w.done} planned={w.planned} short={w.week < view.currentWeek} />
                <div className="mt-1 text-[11px] text-muted">Days {WEEK_RANGES[w.week]}</div>
              </div>
            ))}
            <div>
              <ProgressBar label="Month" done={view.total.done} planned={view.total.planned} />
              <div className="mt-1 text-[11px] text-muted">{Math.round((view.total.done / view.total.planned) * 100)}% done</div>
            </div>
          </section>
          <OffpageBoard rows={view.rows} currentWeek={view.currentWeek} meId={user.id} fullAccess={view.access === "full"} />
          <p className="text-xs text-muted">Click a box to mark it done with the live link. Boxes with a red edge were not done in their week. The SEO Project Manager can send work back with a reason.</p>
        </>
      ) : (
        <div className="card text-sm text-muted">
          {view.isCurrent
            ? view.canPlan
              ? "No off-page work planned for this month yet. Add the client's monthly activities below."
              : "No off-page work planned for this month yet."
            : month > currentMonth()
              ? "This month's checklist is made when the month starts, from the plan below."
              : "No off-page work was tracked this month."}
        </div>
      )}

      {planner && <datalist id="activity-names">{ACTIVITY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>}
      {thisMonthPlan && planner && (
        <MonthPlan
          clientId={clientId}
          month={month}
          label={monthLabel(month)}
          rows={thisMonthPlan}
          people={planner[1]}
          isCurrent={view.isCurrent}
        />
      )}

      {planner && view.isCurrent && (
        <OffpagePlanner
          clientId={clientId}
          activities={planner[0]}
          people={planner[1]}
          otherClients={planner[2]}
        />
      )}
    </div>
  );
}
