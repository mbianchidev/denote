import { describe, expect, it } from "vitest";
import {
  calendarMonthDates,
  calendarToday,
  formatCalendarDate,
  moveCalendarDate,
  moveCalendarMonth,
} from "./calendar";

describe("calendar civil dates", () => {
  it("clips the earliest supported month without adding a seventh grid row", () => {
    const dates = calendarMonthDates("0001-01", 0);
    expect(dates).toHaveLength(41);
    expect(dates[0]).toBe("0001-01-01");
    expect(dates[dates.length - 1]).toBe("0001-02-10");
  });

  it("keeps selected days independent of display locale and daylight-saving boundaries", () => {
    expect(moveCalendarDate("2026-03-28", 1)).toBe("2026-03-29");
    expect(moveCalendarDate("2026-03-29", 1)).toBe("2026-03-30");
    expect(moveCalendarDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(moveCalendarMonth("2024-01-31", 1)).toBe("2024-02-29");
    expect(moveCalendarMonth("2025-01-31", 1)).toBe("2025-02-28");
    expect(moveCalendarMonth("2026-01-31", -1)).toBe("2025-12-31");
    expect(formatCalendarDate("2026-03-29", "en-US")).toBe("Sunday, March 29, 2026");
    expect(formatCalendarDate("2026-03-29", "it-IT")).toBe("domenica 29 marzo 2026");
    expect(calendarMonthDates("2026-03", 1)).toHaveLength(42);
    expect(calendarMonthDates("2026-03", 1)[0]).toBe("2026-02-23");
    expect(calendarMonthDates("2026-03", 0)[0]).toBe("2026-03-01");
    expect(calendarToday(new Date(2026, 8, 1, 0, 5))).toBe("2026-09-01");
    expect(moveCalendarDate("0001-01-01", -1)).toBeNull();
    expect(moveCalendarMonth("9999-12-01", 1)).toBeNull();
  });
});
