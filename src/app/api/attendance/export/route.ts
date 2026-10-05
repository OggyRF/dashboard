import { type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { isValidMonth, istTimeOfDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { monthSheet } from "@/services/attendance";

function csvCell(value: string | number) {
  const s = String(value);
  // Quote everything and neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "attendance.viewAll")) return new Response("Not allowed", { status: 403 });
  const userId = request.nextUrl.searchParams.get("userId") ?? "";
  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isValidMonth(month)) return new Response("Bad month", { status: 400 });

  let sheet: Awaited<ReturnType<typeof monthSheet>>;
  try {
    sheet = await monthSheet(user, userId, month);
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    throw e;
  }
  const lines = [
    ["Name", "Date", "Logged in", "Logged out", "Break minutes", "Breaks", "Worked minutes", "Worked", "Closed automatically", "Corrected"],
    ...sheet.rows
      .filter((r) => r.summary?.firstLoginAt)
      .map((r) => {
        const s = r.summary!;
        return [
          sheet.person.name,
          r.key,
          s.firstLoginAt ? istTimeOfDay(s.firstLoginAt) : "",
          s.state === "LOGGED_OUT" && s.lastLogoutAt ? istTimeOfDay(s.lastLogoutAt) : "",
          s.breakMinutes,
          s.breakCount,
          s.workedMinutes,
          `${Math.floor(s.workedMinutes / 60)}:${String(s.workedMinutes % 60).padStart(2, "0")}`,
          r.autoClosed ? "yes" : "",
          r.corrected ? "yes" : "",
        ];
      }),
  ];
  const body = lines.map((l) => l.map(csvCell).join(",")).join("\r\n");
  const filename = `attendance-${sheet.person.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${month}.csv`;
  return new Response(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
