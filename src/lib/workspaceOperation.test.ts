import { expect, test, vi } from "vitest";
import { acquireWorkspaceLockAndDrainProjectMutations } from "./workspaceOperation";

test("drains queued project mutations after locking and before switch logic", async () => {
  const events: string[] = [];
  let activateLock = () => {};
  let finishMutation = () => {};
  const lock = new Promise<void>((resolve) => {
    activateLock = () => {
      events.push("lock-active");
      resolve();
    };
  });
  const mutation = new Promise<void>((resolve) => {
    finishMutation = () => {
      events.push("mutation-finished");
      resolve();
    };
  });

  const operation = (async () => {
    await acquireWorkspaceLockAndDrainProjectMutations(
      async () => {
        events.push("lock-requested");
        await lock;
      },
      () => {
        events.push("mutation-drain-started");
        return mutation;
      },
    );
    events.push("switch-started");
  })();

  expect(events).toEqual(["lock-requested"]);
  activateLock();
  await vi.waitFor(() => {
    expect(events).toEqual([
      "lock-requested",
      "lock-active",
      "mutation-drain-started",
    ]);
  });
  finishMutation();
  await operation;
  expect(events).toEqual([
    "lock-requested",
    "lock-active",
    "mutation-drain-started",
    "mutation-finished",
    "switch-started",
  ]);
});
