import { describe, expect, it, vi } from "vitest";
import { TIME_TRACKING_STOP_KEY, type PluginStorage } from "@denote/plugin-sdk";
import { TimeTrackingStore } from "../src/timeTracking";

function storage(): PluginStorage {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) =>
      structuredClone((values.get(key) as T | undefined) ?? null),
    set: async (key, value) => { values.set(key, structuredClone(value)); },
    delete: async (key) => { values.delete(key); },
    clear: async () => { values.clear(); },
  };
}

const origin = Date.parse("2026-05-04T09:00:00Z");
const clock = (monotonicMs: number, wallTimeMs = origin + monotonicMs) => ({
  bootId: "synthetic-boot",
  monotonicMs,
  wallTimeMs,
});
const target = {
  path: "project/Plan.md",
  tags: ["work"],
  project: { projectId: "project-alpha", rootPath: "project" },
};

describe("time tracking", () => {
  it("persists one timer and measures restart, sleep, pause, and clock changes monotonically", async () => {
    const saved = storage();
    let store = new TimeTrackingStore(saved);
    await store.mutate({
      workspaceId: "vault-alpha", clock: clock(0),
      mutation: { type: "start", id: "session-1", target, description: "Synthetic work" },
    });
    store = new TimeTrackingStore(saved);
    const recovered = await store.query({
      workspaceId: "vault-alpha", clock: clock(60_000, origin - 3_600_000),
    });
    expect(recovered.sessions[0]).toMatchObject({
      path: target.path, tags: ["work"], project: target.project,
      status: "running", elapsedMs: 60_000,
    });
    await expect(store.mutate({
      workspaceId: "vault-alpha", clock: clock(60_000),
      mutation: { type: "start", id: "session-2", target, description: "" },
    })).rejects.toThrow(/already active/i);
    await store.mutate({
      workspaceId: "vault-alpha", clock: clock(3_660_000),
      mutation: { type: "pause", id: "session-1" },
    });
    await store.mutate({
      workspaceId: "vault-alpha", clock: clock(4_000_000),
      mutation: { type: "resume", id: "session-1" },
    });
    const stopped = await store.mutate({
      workspaceId: "vault-alpha", clock: clock(4_020_000),
      mutation: { type: "stop", id: "session-1" },
    });
    expect(stopped.activeSessionId).toBeNull();
    expect(stopped.sessions[0]).toMatchObject({
      status: "stopped", elapsedMs: 3_680_000, endedAt: origin + 4_020_000,
    });
  });

  it("keeps one active timer across vaults without exposing another vault's note metadata", async () => {
      const store = new TimeTrackingStore(storage());
      await store.mutate({
        workspaceId: "vault-alpha", clock: clock(0),
        mutation: { type: "start", id: "session-1", target, description: "Synthetic work" },
      });
      expect(await store.query({ workspaceId: "vault-beta", clock: clock(1_000) })).toMatchObject({
        sessions: [], activeSessionId: null, activeElsewhere: true,
      });
      await expect(store.mutate({
        workspaceId: "vault-beta", clock: clock(2_000),
        mutation: { type: "stop", id: "session-1" },
      })).rejects.toThrow(/current vault/i);
      await expect(store.mutate({
        workspaceId: "vault-beta", clock: clock(3_000),
        mutation: { type: "start", id: "session-2", target, description: "" },
      })).rejects.toThrow(/already active/i);
    });

  it("pauses at the last checkpoint after a reboot instead of guessing from the wall clock", async () => {
      const saved = storage();
      const store = new TimeTrackingStore(saved);
      await store.mutate({
        workspaceId: "vault-alpha", clock: clock(0),
        mutation: { type: "start", id: "session-1", target, description: "" },
      });
      await store.query({ workspaceId: "vault-alpha", clock: clock(30_000) });
      const recovered = await new TimeTrackingStore(saved).query({
        workspaceId: "vault-alpha", clock: { ...clock(0, origin + 7_200_000), bootId: "another-boot" },
      });
      expect(recovered.sessions[0]).toMatchObject({ status: "paused", elapsedMs: 30_000 });
      expect(recovered.sessions[0].recoveryNotice).toMatch(/system restarted/i);
    });

  it("applies a confirmed host stop even when disabling happened while the worker was locked", async () => {
      const saved = storage();
      const store = new TimeTrackingStore(saved);
      await store.mutate({
        workspaceId: "vault-alpha", clock: clock(0),
        mutation: { type: "start", id: "session-1", target, description: "" },
      });
      await saved.set(TIME_TRACKING_STOP_KEY, clock(90_000));
      const restored = await new TimeTrackingStore(saved).query({
        workspaceId: "vault-alpha", clock: clock(300_000),
      });
      expect(restored.sessions[0]).toMatchObject({
        status: "stopped", elapsedMs: 90_000, endedAt: origin + 90_000,
      });
      expect(await saved.get(TIME_TRACKING_STOP_KEY)).toBeNull();
    });

  it("retains immutable before-and-after corrections and rejects stale or invalid edits", async () => {
      const store = new TimeTrackingStore(storage());
      await store.mutate({
        workspaceId: "vault-alpha", clock: clock(0),
        mutation: { type: "start", id: "session-1", target, description: "Original" },
      });
      await store.mutate({
        workspaceId: "vault-alpha", clock: clock(60_000),
        mutation: { type: "stop", id: "session-1" },
      });
      const request = {
        workspaceId: "vault-alpha", clock: clock(120_000),
        mutation: {
          type: "correct" as const, id: "session-1", expectedRevision: 0, reason: "Correct an invented interval",
          values: { startedAt: origin, endedAt: origin + 60_000, elapsedMs: 45_000, description: "Corrected", tags: ["review"] },
        },
      };
      const corrected = await store.mutate(request);
      expect(corrected.sessions[0]).toMatchObject({
        elapsedMs: 45_000, revision: 1,
        history: [{
          reason: request.mutation.reason,
          before: { elapsedMs: 60_000, description: "Original", tags: ["work"] },
          after: { elapsedMs: 45_000, description: "Corrected", tags: ["review"] },
        }],
      });
      await expect(store.mutate(request)).rejects.toThrow(/changed/i);
      await expect(store.mutate({
        ...request, mutation: { ...request.mutation, expectedRevision: 1, values: { ...request.mutation.values, elapsedMs: 70_000 } },
      })).rejects.toThrow(/invalid/i);
      expect((await store.query({ workspaceId: "vault-alpha", clock: clock(180_000) })).sessions[0].history).toEqual(corrected.sessions[0].history);
    });

  it("serializes competing starts and propagates failed writes without publishing an unsaved timer", async () => {
      const saved = storage();
      const store = new TimeTrackingStore(saved);
      const start = (id: string) => store.mutate({
        workspaceId: "vault-alpha", clock: clock(0),
        mutation: { type: "start", id, target, description: "" },
      });
      vi.spyOn(saved, "set").mockRejectedValueOnce(new Error("Synthetic storage failure"));
      await expect(start("failed")).rejects.toThrow("Synthetic storage failure");
      const results = await Promise.allSettled([start("session-1"), start("session-2")]);
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
      expect((await store.query({ workspaceId: "vault-alpha", clock: clock(1_000) })).sessions).toHaveLength(1);
    });

  it("does not let a queued start resurrect a timer after disable confirmation", async () => {
    const saved = storage();
    const store = new TimeTrackingStore(saved);
    await store.mutate({
      workspaceId: "vault-alpha", clock: clock(0),
      mutation: { type: "start", id: "session-1", target, description: "" },
    });
    await saved.set(TIME_TRACKING_STOP_KEY, clock(90_000));
    await expect(store.mutate({
      workspaceId: "vault-alpha", clock: clock(80_000),
      mutation: { type: "start", id: "queued-session", target, description: "" },
    })).rejects.toThrow(/disabled|confirmation/i);
    const restored = await new TimeTrackingStore(saved).query({ workspaceId: "vault-alpha", clock: clock(300_000) });
    expect(restored.activeSessionId).toBeNull();
    expect(restored.sessions).toHaveLength(1);
    expect(restored.sessions[0]).toMatchObject({ status: "stopped", elapsedMs: 90_000 });
  });

  it("refuses corrupt saved data instead of resetting or overwriting it", async () => {
      const saved = storage();
      await saved.set("sessions.v1", { version: 99, entries: [] });
      const write = vi.spyOn(saved, "set");
      await expect(new TimeTrackingStore(saved).query({ workspaceId: "vault-alpha", clock: clock(0) })).rejects.toThrow(/invalid/i);
      expect(write).not.toHaveBeenCalled();
  });
});
