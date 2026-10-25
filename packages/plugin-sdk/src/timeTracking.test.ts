import { describe, expect, it } from "vitest";
import {
  isPluginTimeTrackingRequest,
  isPluginTimeTrackingModel,
  exportTimeTrackingSessions,
  timeTrackingTotals,
  type PluginTimeTrackingSession,
} from "./timeTracking";

describe("time tracking contract", () => {
  it("accepts bounded host requests and rejects unsafe paths, clocks, and multiple active timers", () => {
    const request = {
      workspaceId: "vault-alpha",
      clock: { bootId: "synthetic-boot", wallTimeMs: 1_000, monotonicMs: 5 },
      mutation: {
        type: "start", id: "session-1", description: "",
        target: { path: "project/Plan.md", tags: ["work"], project: null },
      },
    };
    expect(isPluginTimeTrackingRequest(request)).toBe(true);
    expect(isPluginTimeTrackingRequest({
      ...request,
      mutation: { ...request.mutation, target: { ...request.mutation.target, path: "../escape.md" } },
    })).toBe(false);
    expect(isPluginTimeTrackingRequest({
      ...request, clock: { ...request.clock, monotonicMs: Infinity },
    })).toBe(false);
    expect(isPluginTimeTrackingModel({
      sessions: [], activeSessionId: null, activeElsewhere: false, notices: [],
    })).toBe(true);
    expect(isPluginTimeTrackingModel({
      sessions: [], activeSessionId: "missing", activeElsewhere: false, notices: [],
    })).toBe(false);
    const cyclic: Record<string, unknown> = {
      sessions: [], activeSessionId: null, activeElsewhere: false, notices: [],
    };
    cyclic.extra = cyclic;
    expect(isPluginTimeTrackingModel(cyclic)).toBe(false);
  });

  it("splits overnight and paused work across summary boundaries and exports complete, spreadsheet-safe history", () => {
    const start = Date.parse("2026-05-04T23:30:00Z");
    const midnight = Date.parse("2026-05-05T00:00:00Z");
    const session: PluginTimeTrackingSession = {
      id: "session-1", path: "project/Plan.md", tags: ["work", "review"],
      project: { projectId: "project-alpha", rootPath: "project" },
      startedAt: start, endedAt: midnight + 7_200_000, elapsedMs: 5_400_000,
      description: '=SUM(1,2)\n"Synthetic"', status: "stopped",
      segments: [
        { startedAt: start, elapsedMs: 3_600_000 },
        { startedAt: midnight + 5_400_000, elapsedMs: 1_800_000 },
      ],
      revision: 0, history: [], recoveryNotice: null,
    };
    expect(timeTrackingTotals([session], start, midnight, "note")).toEqual([
      { id: session.path, label: session.path, elapsedMs: 1_800_000 },
    ]);
    expect(timeTrackingTotals([session], midnight, midnight + 86_400_000, "project")).toEqual([
      { id: "project-alpha", label: "project", elapsedMs: 3_600_000 },
    ]);
    expect(timeTrackingTotals([session], start, midnight + 86_400_000, "tag"))
      .toEqual(expect.arrayContaining([
        { id: "work", label: "work", elapsedMs: 5_400_000 },
        { id: "review", label: "review", elapsedMs: 5_400_000 },
      ]));
    const json = JSON.parse(exportTimeTrackingSessions([session], "json", midnight));
    expect(json).toEqual({ schemaVersion: 1, exportedAt: new Date(midnight).toISOString(), sessions: [session] });
    const csv = exportTimeTrackingSessions([session], "csv", midnight);
    expect(csv).toContain('"elapsed_ms"');
    expect(csv).toContain('"5400000"');
    expect(csv).toContain('"\'=SUM(1,2)\n""Synthetic"""');
    expect(csv).toContain('"history_json"');
    for (const [from, to, hours] of [
      ["2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00", 23],
      ["2026-11-01T00:00:00-04:00", "2026-11-02T00:00:00-05:00", 25],
    ] as const) {
      const startedAt = Date.parse(from);
      const elapsedMs = hours * 3_600_000;
      const dated = { ...session, startedAt, endedAt: Date.parse(to), elapsedMs, segments: [{ startedAt, elapsedMs }] };
      expect(timeTrackingTotals([dated], startedAt, Date.parse(to), "note")[0].elapsedMs).toBe(elapsedMs);
    }
  });
});
