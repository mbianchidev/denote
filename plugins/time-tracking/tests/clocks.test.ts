import { describe, expect, it } from "vitest";
import { CLOCKS_STOP_KEY, type PluginStorage } from "@denote/plugin-sdk";
import { ClockStore } from "../src/clocks";

function storage(): PluginStorage {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => structuredClone((values.get(key) as T | undefined) ?? null),
    set: async (key, value) => { values.set(key, structuredClone(value)); },
    delete: async (key) => { values.delete(key); },
    clear: async () => { values.clear(); },
  };
}

const origin = Date.parse("2026-05-04T09:00:00Z");
const clock = (monotonicMs: number, wallTimeMs = origin + monotonicMs, bootId = "synthetic-boot") =>
  ({ bootId, monotonicMs, wallTimeMs });

describe("clock modes", () => {
  it("recovers a standalone stopwatch and independent countdown without trusting wall-clock changes", async () => {
    const saved = storage();
    let store = new ClockStore(saved);
    await store.request({ clock: clock(0), mutation: { type: "stopwatch-start" } });
    await store.request({
      clock: clock(0),
      mutation: { type: "countdown-create", id: "synthetic-countdown", title: "Field break", durationMs: 90_000, sound: true },
    });
    store = new ClockStore(saved);
    const recovered = await store.request({ clock: clock(60_000, origin - 3_600_000) });
    expect(recovered.stopwatch).toMatchObject({ status: "running", elapsedMs: 60_000 });
    expect(recovered.countdowns[0]).toMatchObject({ status: "running", remainingMs: 30_000 });
    await store.request({ clock: clock(60_000), mutation: { type: "stopwatch-pause" } });
    const due = await store.request({ clock: clock(90_000) });
    expect(due.stopwatch).toMatchObject({ status: "paused", elapsedMs: 60_000 });
    expect(due.countdowns[0]).toMatchObject({ status: "ringing", remainingMs: 0 });
  });

  it("rings wall-clock alarms, correlates notification attempts, snoozes, and advances daily intent", async () => {
    const store = new ClockStore(storage());
    await store.request({ clock: clock(0), mutation: {
      type: "alarm-create", id: "alarm", title: "Field check", localDateTime: "2026-05-04T09:01",
      timeZone: "UTC", repeatDaily: true, sound: true,
    } });
    const due = await store.request({ clock: clock(60_000) });
    expect(due.alarms[0]).toMatchObject({ status: "ringing", occurrence: 1 });
    await store.request({ clock: clock(60_000), mutation: {
      type: "notification-started", kind: "alarm", id: "alarm", occurrence: 1,
    } });
    const snoozed = await store.request({ clock: clock(60_000), mutation: { type: "alarm-snooze", id: "alarm" } });
    expect(snoozed.alarms[0]).toMatchObject({ status: "scheduled", dueAt: origin + 360_000, occurrence: 2 });
    await expect(store.request({ clock: clock(60_000), mutation: {
      type: "notification-succeeded", kind: "alarm", id: "alarm", occurrence: 1,
    } })).rejects.toThrow(/no longer current/u);
    await store.request({ clock: clock(360_000) });
    await store.request({ clock: clock(360_000), mutation: {
      type: "notification-started", kind: "alarm", id: "alarm", occurrence: 2,
    } });
    const failed = await store.request({ clock: clock(360_000), mutation: {
      type: "notification-failed", kind: "alarm", id: "alarm", occurrence: 2, error: "Synthetic notification failure",
    } });
    expect(failed.alarms[0].delivery).toMatchObject({ status: "failed", error: "Synthetic notification failure" });
    await store.request({ clock: clock(360_000), mutation: {
      type: "notification-retry", kind: "alarm", id: "alarm", occurrence: 2,
    } });
    await store.request({ clock: clock(360_000), mutation: {
      type: "notification-started", kind: "alarm", id: "alarm", occurrence: 2,
    } });
    await store.request({ clock: clock(360_000), mutation: {
      type: "notification-succeeded", kind: "alarm", id: "alarm", occurrence: 2,
    } });
    const next = await store.request({ clock: clock(360_000), mutation: { type: "alarm-dismiss", id: "alarm" } });
    expect(next.alarms[0]).toMatchObject({ status: "scheduled", localDateTime: "2026-05-05T09:01", snoozedUntil: null });
  });

  it("pauses durations after reboot and retains interrupted delivery as an explicit retry state", async () => {
    const saved = storage();
    let store = new ClockStore(saved);
    await store.request({ clock: clock(0), mutation: {
      type: "countdown-create", id: "break", title: "Break", durationMs: 60_000, sound: false,
    } });
    await store.request({ clock: clock(20_000) });
    store = new ClockStore(saved);
    expect((await store.request({ clock: clock(0, origin + 3_600_000, "new-boot") })).countdowns[0])
      .toMatchObject({ status: "paused", remainingMs: 40_000 });
    await store.request({ clock: clock(10, origin + 3_600_010, "new-boot"), mutation: { type: "countdown-resume", id: "break" } });
    await store.request({ clock: clock(40_010, origin + 3_640_010, "new-boot") });
    await store.request({ clock: clock(40_010, origin + 3_640_010, "new-boot"), mutation: {
      type: "notification-started", kind: "countdown", id: "break", occurrence: 1,
    } });
    const restored = await new ClockStore(saved).request({ clock: clock(40_010, origin + 3_640_010, "new-boot") });
    expect(restored.countdowns[0].delivery.status).toBe("failed");
    expect(restored.countdowns[0].delivery.error).toMatch(/may already have appeared/u);
  });

  it("stops every clock at confirmed disablement and rejects queued actions without counting disabled time", async () => {
    const saved = storage();
    const store = new ClockStore(saved);
    await store.request({ clock: clock(0), mutation: { type: "stopwatch-start" } });
    await store.request({ clock: clock(0), mutation: {
      type: "countdown-create", id: "break", title: "Break", durationMs: 60_000, sound: false,
    } });
    await store.request({ clock: clock(0), mutation: {
      type: "alarm-create", id: "alarm", title: "Alarm", localDateTime: "2026-05-04T10:00",
      timeZone: "UTC", repeatDaily: false, sound: false,
    } });
    await saved.set(CLOCKS_STOP_KEY, clock(10_000));
    await expect(store.request({ clock: clock(9_000), mutation: { type: "stopwatch-start" } }))
      .rejects.toThrow(/disabled/u);
    const stopped = await new ClockStore(saved).request({ clock: clock(300_000) });
    expect(stopped.stopwatch).toMatchObject({ status: "paused", elapsedMs: 10_000 });
    expect(stopped.countdowns[0]).toMatchObject({ status: "cancelled", remainingMs: 50_000 });
    expect(stopped.alarms[0].status).toBe("disabled");
  });
});
