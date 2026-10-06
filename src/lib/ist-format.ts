// India-time labels built by hand, so the server and every browser print
// exactly the same text (built-in date formatting differs between them).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ist(date: Date | string) {
  return new Date(new Date(date).getTime() + IST_OFFSET_MS);
}

// "04:05 pm"
export function istClock(date: Date | string) {
  const d = ist(date);
  const h = d.getUTCHours();
  const hour = h % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// "Tuesday, 6 Oct"
export function istDayLabel(date: Date | string) {
  const d = ist(date);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// "6 Oct, 04:05 pm"
export function istShortDateTime(date: Date | string) {
  const d = ist(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${istClock(date)}`;
}
