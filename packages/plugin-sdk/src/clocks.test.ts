import { describe, expect, it } from "vitest";
import { emptyClockModel, isPluginClockModel, isPluginClockRequest } from "./clocks";

describe("clock contract", () => {
  it("validates bounded stopwatch, countdown, alarm, and correlated delivery operations", () => {
    const clock = { bootId: "synthetic", wallTimeMs: 1_000, monotonicMs: 10 };
    expect(isPluginClockRequest({ clock, mutation: { type: "stopwatch-start" } })).toBe(true);
    expect(isPluginClockRequest({ clock, mutation: {
      type: "countdown-create", id: "synthetic", title: "Break", durationMs: 60_000, sound: true,
    } })).toBe(true);
    expect(isPluginClockRequest({ clock, mutation: {
      type: "countdown-create", id: "synthetic", title: "Break", durationMs: -1, sound: true,
    } })).toBe(false);
    expect(isPluginClockRequest({ clock, mutation: {
      type: "alarm-create", id: "synthetic", title: "Check", localDateTime: "2026-02-30T09:00",
      timeZone: "UTC", repeatDaily: false, sound: true,
    } })).toBe(false);
    expect(isPluginClockRequest({ clock, mutation: {
      type: "notification-started", kind: "alarm", id: "synthetic", occurrence: 1,
    } })).toBe(true);
    expect(isPluginClockModel(emptyClockModel())).toBe(true);
    const cyclic: Record<string, unknown> = { ...emptyClockModel() };
    cyclic.extra = cyclic;
    expect(isPluginClockModel(cyclic)).toBe(false);
  });
});
