import { describe, expect, it } from "vitest";
import type { GitignoreStatusUpdate } from "../types";
import {
  applyGitignoreStatusUpdate,
  enqueueGitignoreStatusOperation,
  gitignoreRefreshScope,
  ignoredPathsAfterWorkspaceSnapshot,
  isGitignorePath,
  removeIgnoredPathsAtOrBelow,
} from "./gitignoreStatus";

describe("gitignore status updates", () => {
  it("replaces the full set for empty and root scopes", () => {
    expect(
      applyGitignoreStatusUpdate(["old.log"], {
        scopePaths: [],
        ignoredPaths: ["build/output.js"],
        complete: true,
      }),
    ).toEqual(["build/output.js"]);
    expect(
      applyGitignoreStatusUpdate(["old.log"], {
        scopePaths: [""],
        ignoredPaths: ["cache.bin"],
        complete: true,
      }),
    ).toEqual(["cache.bin"]);
  });

  it("replaces only paths equal to or below returned scoped paths", () => {
    expect(
      applyGitignoreStatusUpdate(
        ["app/old.log", "app/cache/data", "app-old/keep.log", "docs/keep.log"],
        {
          scopePaths: ["app"],
          ignoredPaths: ["app/new.log", "app/new.log"],
          complete: true,
        },
      ),
    ).toEqual(["app-old/keep.log", "docs/keep.log", "app/new.log"]);
  });

  it("preserves the current set for incomplete results", () => {
    expect(
      applyGitignoreStatusUpdate(["existing.log"], {
        scopePaths: ["app"],
        ignoredPaths: ["app/new.log"],
        complete: false,
      }),
    ).toEqual(["existing.log"]);
  });

  it("overlays updates that applied while a snapshot was loading", () => {
    expect(
      ignoredPathsAfterWorkspaceSnapshot(["snapshot.log"], []),
    ).toEqual(["snapshot.log"]);
    expect(
      ignoredPathsAfterWorkspaceSnapshot(
        ["alpha/old.log", "snapshot.log"],
        [
          statusUpdate(["alpha"], ["alpha/new.log"]),
          statusUpdate(["beta"], ["beta/new.log"]),
        ],
      ),
    ).toEqual(["snapshot.log", "alpha/new.log", "beta/new.log"]);
    expect(
      ignoredPathsAfterWorkspaceSnapshot(
        ["snapshot.log"],
        [statusUpdate([], ["authoritative.log"])],
      ),
    ).toEqual(["authoritative.log"]);
  });

  it("serializes two disjoint scoped updates in invocation order", async () => {
    const first = deferred<GitignoreStatusUpdate>();
    const second = deferred<GitignoreStatusUpdate>();
    const state = queuedStatusState(["seed.log"]);

    const firstResult = state.enqueue(() => first.promise, ["alpha"]);
    const secondResult = state.enqueue(() => second.promise, ["beta"]);
    await Promise.resolve();
    expect(state.loads).toEqual([["alpha"]]);

    second.resolve(statusUpdate(["beta"], ["beta/new.log"]));
    await Promise.resolve();
    expect(state.loads).toEqual([["alpha"]]);

    first.resolve(statusUpdate(["alpha"], ["alpha/new.log"]));
    await firstResult;
    await Promise.resolve();
    expect(state.loads).toEqual([["alpha"], ["beta"]]);
    await secondResult;
    expect(state.ignoredPaths()).toEqual([
      "seed.log",
      "alpha/new.log",
      "beta/new.log",
    ]);
  });

  it("applies a full update before a later scoped update", async () => {
    const state = queuedStatusState(["seed.log"]);
    const full = deferred<GitignoreStatusUpdate>();
    const scoped = deferred<GitignoreStatusUpdate>();

    const fullResult = state.enqueue(() => full.promise, []);
    const scopedResult = state.enqueue(() => scoped.promise, ["alpha"]);
    full.resolve(statusUpdate([], ["alpha/old.log", "root.log"]));
    await fullResult;
    scoped.resolve(statusUpdate(["alpha"], ["alpha/new.log"]));
    await scopedResult;

    expect(state.ignoredPaths()).toEqual(["root.log", "alpha/new.log"]);
  });

  it("lets a later full update replace an earlier scoped update", async () => {
    const state = queuedStatusState(["seed.log"]);
    const scoped = deferred<GitignoreStatusUpdate>();
    const full = deferred<GitignoreStatusUpdate>();

    const scopedResult = state.enqueue(() => scoped.promise, ["alpha"]);
    const fullResult = state.enqueue(() => full.promise, []);
    scoped.resolve(statusUpdate(["alpha"], ["alpha/new.log"]));
    await scopedResult;
    full.resolve(statusUpdate([], ["final.log"]));
    await fullResult;

    expect(state.ignoredPaths()).toEqual(["final.log"]);
  });

  it("does not journal failed and incomplete scoped requests", async () => {
    const state = queuedStatusState(["current.log"]);
    const failedUpdate = deferred<GitignoreStatusUpdate>();
    const incompleteUpdate = deferred<GitignoreStatusUpdate>();
    const failure = state.enqueue(() => failedUpdate.promise, ["alpha"]);
    const incomplete = state.enqueue(() => incompleteUpdate.promise, ["beta"]);

    await Promise.resolve();
    expect(
      ignoredPathsAfterWorkspaceSnapshot(["snapshot.log"], state.journal()),
    ).toEqual(["snapshot.log"]);

    failedUpdate.reject(new Error("synthetic status failure"));
    await expect(failure).resolves.toBe(false);
    incompleteUpdate.resolve(
      statusUpdate(["beta"], ["beta/new.log"], false),
    );
    await expect(incomplete).resolves.toBe(false);
    expect(state.journal()).toEqual([]);
    expect(
      ignoredPathsAfterWorkspaceSnapshot(["snapshot.log"], state.journal()),
    ).toEqual(["snapshot.log"]);
  });

  it("does not apply old-vault results after a vault switch", async () => {
    const state = queuedStatusState(["old.log"]);
    const oldUpdate = deferred<GitignoreStatusUpdate>();
    const oldResult = state.enqueue(() => oldUpdate.promise, ["alpha"]);

    state.switchVault("/vault-two");
    const newResult = state.enqueue(
      async () => statusUpdate([], ["new.log"]),
      [],
    );
    oldUpdate.resolve(statusUpdate(["alpha"], ["alpha/stale.log"]));

    await expect(oldResult).resolves.toBe(false);
    await expect(newResult).resolves.toBe(true);
    expect(state.ignoredPaths()).toEqual(["new.log"]);
    expect(state.revision()).toBe(1);
  });

  it("removes trashed subtrees and derives gitignore parent scopes", () => {
    expect(
      removeIgnoredPathsAtOrBelow(
        ["build", "build/output.js", "build-old/output.js"],
        "build",
      ),
    ).toEqual(["build-old/output.js"]);
    expect(gitignoreRefreshScope(".gitignore")).toEqual([""]);
    expect(gitignoreRefreshScope("app/.gitignore")).toEqual(["app"]);
    expect(isGitignorePath(".gitignore")).toBe(true);
    expect(isGitignorePath("app/.GITIGNORE")).toBe(true);
    expect(isGitignorePath("app/.gitignore.backup")).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function statusUpdate(
  scopePaths: string[],
  ignoredPaths: string[],
  complete = true,
): GitignoreStatusUpdate {
  return { scopePaths, ignoredPaths, complete };
}

function queuedStatusState(initialIgnoredPaths: string[]) {
  let ignoredPaths = initialIgnoredPaths;
  let revision = 0;
  let generation = 1;
  let vaultPath = "/vault-one";
  let tail = Promise.resolve();
  const loads: string[][] = [];
  const journal: GitignoreStatusUpdate[] = [];

  return {
    loads,
    ignoredPaths: () => ignoredPaths,
    revision: () => revision,
    journal: () => journal,
    switchVault: (nextVaultPath: string) => {
      generation += 1;
      vaultPath = nextVaultPath;
      ignoredPaths = [];
    },
    enqueue: (
      load: () => Promise<GitignoreStatusUpdate>,
      requestedScopes: string[],
    ) => {
      const expectedGeneration = generation;
      const expectedVaultPath = vaultPath;
      const queued = enqueueGitignoreStatusOperation(tail, async () => {
        if (
          expectedGeneration !== generation ||
          expectedVaultPath !== vaultPath
        ) {
          return false;
        }
        loads.push(requestedScopes);
        try {
          const update = await load();
          if (
            expectedGeneration !== generation ||
            expectedVaultPath !== vaultPath ||
            !update.complete
          ) {
            return false;
          }
          ignoredPaths = applyGitignoreStatusUpdate(ignoredPaths, update);
          revision += 1;
          journal.push(update);
          return true;
        } catch {
          return false;
        }
      });
      tail = queued.tail;
      return queued.result;
    },
  };
}
