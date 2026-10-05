// All timestamps are stored in UTC and shown in India time.
export const APP_TIME_ZONE = "Asia/Kolkata";

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
