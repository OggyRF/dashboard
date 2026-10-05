import { describe, expect, it } from "vitest";
import {
  addDays,
  countWorkingDays,
  formatMinutes,
  istDateKey,
  istDateTime,
  istTimeOfDay,
  isValidKey,
  monthKeys,
  shiftMonth,
  weekday,
} from "@/lib/dates";

describe("India-time dates", () => {
  it("uses the India calendar day, not UTC", () => {
    // 20:00 UTC is 01:30 the next day in India.
    expect(istDateKey(new Date("2026-10-05T20:00:00Z"))).toBe("2026-10-06");
    expect(istDateKey(new Date("2026-10-05T18:29:00Z"))).toBe("2026-10-05");
    expect(istDateKey(new Date("2026-10-05T18:31:00Z"))).toBe("2026-10-06");
  });

  it("converts a wall-clock India time to an instant", () => {
    expect(istDateTime("2026-10-05", "09:30").toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(istTimeOfDay(new Date("2026-10-05T04:00:00Z"))).toBe("09:30");
  });

  it("walks days and months", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(monthKeys("2026-02")).toHaveLength(28);
    expect(monthKeys("2026-10").at(-1)).toBe("2026-10-31");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(isValidKey("2026-02-30")).toBe(false);
    expect(weekday("2026-10-04")).toBe(0); // a Sunday
  });

  it("counts working days without Sundays and holidays", () => {
    // Mon 5 Oct to Sun 11 Oct 2026: six working days, five if one is a holiday.
    expect(countWorkingDays("2026-10-05", "2026-10-11", new Set())).toBe(6);
    expect(countWorkingDays("2026-10-05", "2026-10-11", new Set(["2026-10-07"]))).toBe(5);
    expect(countWorkingDays("2026-10-04", "2026-10-04", new Set())).toBe(0);
  });

  it("formats minutes for people", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(505)).toBe("8h 25m");
  });
});
