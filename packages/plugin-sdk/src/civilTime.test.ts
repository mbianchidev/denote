import { describe, expect, it } from "vitest";
import { addRecurrence, nextRecurringSchedule, resolveWallClock } from "./civilTime";

describe("shared civil schedules", () => {
  it("chooses the earlier repeated instant, refuses gaps, and preserves daily civil intent", () => {
    expect(resolveWallClock("2026-10-25T02:30", "Europe/Rome"))
      .toBe(Date.parse("2026-10-25T00:30:00Z"));
    expect(() => resolveWallClock("2026-03-29T02:30", "Europe/Rome")).toThrow(/does not exist/u);
    expect(addRecurrence("2026-01-31T09:00", { unit: "month", interval: 1 }))
      .toBe("2026-02-28T09:00");
    expect(nextRecurringSchedule(
      { kind: "wall-clock", localDateTime: "2026-03-28T02:30", timeZone: "Europe/Rome" },
      { unit: "day", interval: 1 },
      Date.parse("2026-03-28T02:00:00Z"),
    )).toEqual({ kind: "wall-clock", localDateTime: "2026-03-30T02:30", timeZone: "Europe/Rome" });
  });
});
