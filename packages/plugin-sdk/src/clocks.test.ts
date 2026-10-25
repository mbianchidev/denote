import { describe, expect, it } from "vitest";
import { CLOCK_CONTENT_CAPABILITIES, emptyClockModel, isPluginClockModel, isPluginClockRequest } from "./clocks";
import { validatePluginManifest } from "./validation";
import type { PluginManifest } from "./contracts";

describe("clock contract", () => {
  it("requires notifications and refuses content-retaining capabilities in a global clock worker", () => {
    const manifest: PluginManifest = {
      schemaVersion: 1, id: "denote.synthetic", name: "Synthetic clocks", version: "1.0.0",
      description: "Synthetic clock fixture.", publisher: { name: "Synthetic", url: "https://example.test" },
      license: "MIT", repository: "https://github.com/example/synthetic", icon: "icon.svg", category: "productivity",
      compatibility: { apiVersion: 1, minimumDenoteVersion: "0.10.0", maximumDenoteVersion: "1.0.0" },
      permissions: [{ capability: "clocks" }], entrypoint: "dist/index.js", documentation: "guide.md",
    };
    expect(validatePluginManifest(manifest).errors).toContain("clocks permission requires notifications permission.");
    manifest.permissions.push({ capability: "notifications" }, { capability: "time-tracking" });
    expect(validatePluginManifest(manifest).valid).toBe(true);
    for (const capability of CLOCK_CONTENT_CAPABILITIES) {
      expect(validatePluginManifest({
        ...manifest, permissions: [...manifest.permissions, { capability }],
      }).errors).toContain("clocks cannot share a worker with content-based capabilities.");
    }
  });

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
