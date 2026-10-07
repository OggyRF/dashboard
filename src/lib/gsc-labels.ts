import { formatMonth, istDateKey, keyFromDbDate, shiftMonth } from "@/lib/dates";

// One line describing how far a property's sync got.
export function syncLabel(source: { recentSyncedOn: Date | null; backfillMonth: string | null; lastError: string | null }, now = new Date()) {
  if (source.lastError) return { tone: "danger" as const, text: source.lastError };
  if (!source.recentSyncedOn) return { tone: "muted" as const, text: "Waiting for the first pull" };
  const today = istDateKey(now);
  if (source.backfillMonth) return { tone: "muted" as const, text: `History loaded back to ${formatMonth(shiftMonth(source.backfillMonth, 1))}, still loading` };
  if (keyFromDbDate(source.recentSyncedOn) < today) return { tone: "muted" as const, text: "Today's pull is waiting" };
  return { tone: "success" as const, text: "Up to date" };
}

export function siteLabel(siteUrl: string) {
  return siteUrl.startsWith("sc-domain:") ? `${siteUrl.slice(10)} (whole domain)` : siteUrl;
}

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-IN");

export function formatCount(n: number, short = false) {
  return short && n >= 10_000 ? compact.format(n) : whole.format(Math.round(n));
}

export function formatCtr(ctr: number) {
  return `${(ctr * 100).toFixed(ctr >= 0.1 ? 1 : 2)}%`;
}

export function formatPosition(p: number) {
  return p ? p.toFixed(1) : "–";
}

const COUNTRIES = new Intl.DisplayNames(["en"], { type: "region" });
// Search Console uses ISO 3166-1 alpha-3 codes ("ind"); the common ones are mapped.
const ALPHA3: Record<string, string> = {
  ind: "IN", usa: "US", gbr: "GB", are: "AE", can: "CA", aus: "AU", sau: "SA", sgp: "SG", deu: "DE", fra: "FR",
  pak: "PK", bgd: "BD", npl: "NP", lka: "LK", qat: "QA", kwt: "KW", omn: "OM", bhr: "BH", nld: "NL", irl: "IE",
  nzl: "NZ", zaf: "ZA", mys: "MY", phl: "PH", idn: "ID", jpn: "JP", chn: "CN", hkg: "HK", ita: "IT", esp: "ES",
  bra: "BR", mex: "MX", rus: "RU", tur: "TR", egy: "EG", nga: "NG", ken: "KE", tha: "TH", vnm: "VN", kor: "KR",
};

export function countryName(code: string) {
  const alpha2 = ALPHA3[code.toLowerCase()];
  try {
    return alpha2 ? (COUNTRIES.of(alpha2) ?? code.toUpperCase()) : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function deviceName(code: string) {
  return { DESKTOP: "Desktop", MOBILE: "Mobile", TABLET: "Tablet" }[code.toUpperCase()] ?? code;
}
