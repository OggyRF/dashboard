import type { DailyWork } from "@/generated/prisma/enums";

// Shared with the browser, so kept apart from the daily task service.
export const DAILY_WORK_LABELS: Record<DailyWork, string> = { WRITING: "Writing", UPLOADING: "Uploading", OTHER: "Other" };
const VERBS: Record<DailyWork, string> = { WRITING: "Write", UPLOADING: "Upload", OTHER: "" };

// "Upload 3 Guest Posting", "Write 2 Web 2.0", or the free text for other work.
export function dailyTitle(t: { work: DailyWork; qty: number; details: string | null; activity: { name: string } | null }) {
  if (t.work === "OTHER" || !t.activity) return `${t.details ?? "Task"}${t.qty > 1 ? ` (×${t.qty})` : ""}`;
  return `${VERBS[t.work]} ${t.qty} ${t.activity.name}`;
}

// Off-page work that has to be written before it can go live. The automatic
// daily plan gives these a writing step a day ahead of the upload.
const WRITTEN = /guest|blog|article|web ?2|press|release|quora|reddit|pdf|content|write|story|answer/i;
export function needsWriting(activityName: string) {
  return WRITTEN.test(activityName);
}

// "Guest Posting 2" for the second piece of a line.
export function unitLabel(t: { work: DailyWork; qty: number; details: string | null; activity: { name: string } | null }, n: number) {
  const name = t.work === "OTHER" || !t.activity ? (t.details ?? "Task") : t.activity.name;
  return t.qty > 1 ? `${name} ${n}` : name;
}

// The heading of a line: "Guest Posting · Writing" or the free text.
export function lineTitle(t: { work: DailyWork; details: string | null; activity: { name: string } | null }) {
  if (t.work === "OTHER" || !t.activity) return t.details ?? "Task";
  return `${t.activity.name} · ${DAILY_WORK_LABELS[t.work]}`;
}

// Quick picks for extra work given to the off-page team.
export const EXTRA_TASK_SUGGESTIONS = ["SERP update", "Extra GMB post", "Reply to GMB reviews", "GMB photo upload", "GMB Q&A update", "Citation check"];
