import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginAutomaticLocalCommitContribution } from "./workerRuntime";
import { useAutomaticLocalCommits } from "./useAutomaticLocalCommits";

const MINUTE = 60_000;

function schedule(
  overrides: Partial<PluginAutomaticLocalCommitContribution> = {},
): PluginAutomaticLocalCommitContribution {
  return {
    pluginId: "denote.synthetic",
    id: "denote.synthetic.nightly",
    intervalMinutes: 5,
    message: "Synthetic automatic commit",
    includePatterns: [],
    excludePatterns: [],
    authorName: null,
    authorEmail: null,
    ...overrides,
  };
}

interface HarnessProps {
  schedules: PluginAutomaticLocalCommitContribution[];
  enabled: boolean;
  workspaceIdentity: string | null;
  projectId: string | null;
  canRun: () => boolean;
}

function harness(overrides: Partial<HarnessProps> = {}) {
  const runs: PluginAutomaticLocalCommitContribution[] = [];
  const errors: unknown[] = [];
  let settle: (() => void) | null = null;
  const run = vi.fn(async (entry: PluginAutomaticLocalCommitContribution) => {
    runs.push(entry);
    if (settle) {
      await new Promise<void>((resolve) => {
        const previous = settle;
        settle = () => {
          previous?.();
          resolve();
        };
      });
    }
  });
  const props: HarnessProps = {
    schedules: [schedule()],
    enabled: true,
    workspaceIdentity: "/synthetic/vault-alpha",
    projectId: null,
    canRun: () => true,
    ...overrides,
  };
  const rendered = renderHook(
    (current: HarnessProps) =>
      useAutomaticLocalCommits({
        ...current,
        run,
        onError: (error) => errors.push(error),
      }),
    { initialProps: props },
  );
  return {
    ...rendered,
    runs,
    errors,
    run,
    hold: () => {
      settle = () => {};
    },
    release: async () => {
      settle?.();
      settle = null;
      await act(async () => {});
    },
  };
}

async function advance(minutes: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(minutes * MINUTE);
  });
}

describe("useAutomaticLocalCommits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never runs immediately and runs once per configured interval", async () => {
    const scheduled = harness();

    await advance(4);
    expect(scheduled.runs).toHaveLength(0);

    await advance(1);
    expect(scheduled.runs).toHaveLength(1);

    await advance(5);
    expect(scheduled.runs).toHaveLength(2);
  });

  it("skips a tick while the workspace is busy", async () => {
    let busy = true;
    const scheduled = harness({ canRun: () => !busy });

    await advance(5);
    expect(scheduled.runs).toHaveLength(0);

    busy = false;
    await advance(5);
    expect(scheduled.runs).toHaveLength(1);
  });

  it("holds no timer while the vault is locked and restarts a full interval after unlocking", async () => {
    const scheduled = harness({ enabled: false });

    await advance(20);
    expect(scheduled.runs).toHaveLength(0);

    scheduled.rerender({
      schedules: [schedule()],
      enabled: true,
      workspaceIdentity: "/synthetic/vault-alpha",
      projectId: null,
      canRun: () => true,
    });

    await advance(4);
    expect(scheduled.runs).toHaveLength(0);
    await advance(1);
    expect(scheduled.runs).toHaveLength(1);
  });

  it("clears the previous timer when the vault changes", async () => {
    const scheduled = harness();

    await advance(4);
    scheduled.rerender({
      schedules: [schedule()],
      enabled: true,
      workspaceIdentity: "/synthetic/vault-beta",
      projectId: null,
      canRun: () => true,
    });

    // The interval restarts with the new vault, so the minute that was left on
    // the old timer cannot commit into the new one.
    await advance(1);
    expect(scheduled.runs).toHaveLength(0);
    await advance(4);
    expect(scheduled.runs).toHaveLength(1);
  });

  it("clears the previous timer when the active project changes", async () => {
    const scheduled = harness({ projectId: "project-alpha" });

    await advance(4);
    scheduled.rerender({
      schedules: [schedule()],
      enabled: true,
      workspaceIdentity: "/synthetic/vault-alpha",
      projectId: "project-beta",
      canRun: () => true,
    });

    await advance(1);
    expect(scheduled.runs).toHaveLength(0);
    await advance(4);
    expect(scheduled.runs).toHaveLength(1);
  });

  it("applies a changed interval and keeps a republished schedule running", async () => {
    const scheduled = harness();

    await advance(4);
    scheduled.rerender({
      // The same values republished as a new array must not restart the timer.
      schedules: [schedule()],
      enabled: true,
      workspaceIdentity: "/synthetic/vault-alpha",
      projectId: null,
      canRun: () => true,
    });
    await advance(1);
    expect(scheduled.runs).toHaveLength(1);

    scheduled.rerender({
      schedules: [schedule({ intervalMinutes: 10 })],
      enabled: true,
      workspaceIdentity: "/synthetic/vault-alpha",
      projectId: null,
      canRun: () => true,
    });
    await advance(5);
    expect(scheduled.runs).toHaveLength(1);
    await advance(5);
    expect(scheduled.runs).toHaveLength(2);
  });

  it("removes the timer when the schedule disappears with its plugin", async () => {
    const scheduled = harness();

    scheduled.rerender({
      schedules: [],
      enabled: true,
      workspaceIdentity: "/synthetic/vault-alpha",
      projectId: null,
      canRun: () => true,
    });

    await advance(30);
    expect(scheduled.runs).toHaveLength(0);
  });

  it("never overlaps two automatic runs", async () => {
    const scheduled = harness({
      schedules: [
        schedule(),
        schedule({ id: "denote.synthetic.hourly", intervalMinutes: 5 }),
      ],
    });
    scheduled.hold();

    await advance(5);
    expect(scheduled.runs).toHaveLength(1);
    await advance(5);
    expect(scheduled.runs).toHaveLength(1);

    // A skipped tick is dropped, never queued, so releasing the run in flight
    // lets the next interval start cleanly instead of replaying a backlog.
    await scheduled.release();
    await advance(5);
    expect(scheduled.runs).toHaveLength(3);
  });

  it("reports a failed run and stays scheduled", async () => {
    const scheduled = harness();
    scheduled.run.mockRejectedValueOnce(new Error("Synthetic commit failure"));

    await advance(5);
    expect(scheduled.errors).toEqual([
      expect.objectContaining({ message: "Synthetic commit failure" }),
    ]);

    await advance(5);
    expect(scheduled.run).toHaveBeenCalledTimes(2);
  });

  it("stops every timer when the component unmounts", async () => {
    const scheduled = harness();

    scheduled.unmount();

    await advance(30);
    expect(scheduled.runs).toHaveLength(0);
  });
});
