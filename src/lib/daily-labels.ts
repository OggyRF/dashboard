import type { DailyWork } from "@/generated/prisma/enums";

// Shared with the browser, so kept apart from the daily task service.
export const DAILY_WORK_LABELS: Record<DailyWork, string> = { WRITING: "Writing", UPLOADING: "Uploading", OTHER: "Other" };
const VERBS: Record<DailyWork, string> = { WRITING: "Write", UPLOADING: "Upload", OTHER: "" };

// "Upload 3 Guest Posting", "Write 2 Web 2.0", or the free text for other work.
export function dailyTitle(t: { work: DailyWork; qty: number; details: string | null; activity: { name: string } | null }) {
  if (t.work === "OTHER" || !t.activity) return `${t.details ?? "Task"}${t.qty > 1 ? ` (×${t.qty})` : ""}`;
  return `${VERBS[t.work]} ${t.qty} ${t.activity.name}`;
}
