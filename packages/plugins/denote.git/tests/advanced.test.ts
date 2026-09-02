import { describe, expect, it } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import { GitRepositoryController } from "../src/controller";
import { vaultScope } from "../src/model";
import {
  CLEAN_STATUS,
  FakeGit,
  SYNTHETIC_BRANCHES_WITH_REMOTE,
  SYNTHETIC_COMMIT_DIFF,
  SYNTHETIC_DIFF,
  SYNTHETIC_STATUS,
  commitId,
  conflictedStatus,
  operationState,
  repositoryResponder,
  syntheticHistory,
  unmergedListing,
} from "./support";

interface Harness {
  controller: GitRepositoryController;
  published: PluginSourceControlViewModel[];
  reports: string[];
}

function harness(settings: Record<string, unknown> = {}): Harness {
  const published: PluginSourceControlViewModel[] = [];
  const reports: string[] = [];
  const controller = new GitRepositoryController(vaultScope(), {
    publish: (model) => published.push(model),
    readSettings: () => Promise.resolve(settings),
    report: (message) => reports.push(message),
  });
  return { controller, published, reports };
}

/** A clean repository whose history holds the two synthetic commits. */
function cleanGit(overrides: Record<string, unknown> = {}): FakeGit {
  return new FakeGit(
    repositoryResponder({
      status: { stdout: CLEAN_STATUS },
      "list-history": { stdout: syntheticHistory(2) },
      diff: { stdout: SYNTHETIC_DIFF },
      ...overrides,
    }),
  );
}

/**
 * A repository with staged, changed, and untracked work, so an operation stops
 * at the commit-or-stash review instead of running straight away.
 */
function dirtyGit(overrides: Record<string, unknown> = {}): FakeGit {
  return new FakeGit(
    repositoryResponder({
      status: { stdout: SYNTHETIC_STATUS },
      "list-history": { stdout: syntheticHistory(2) },
      diff: { stdout: SYNTHETIC_DIFF },
      ...overrides,
    }),
  );
}

/**
 * A clean repository whose branch and newest commit can move between actions.
 *
 * A checkout moves it exactly as Git would, and `moveTo` describes a move made
 * outside Denote, so a test can prove what a review prepared somewhere else is
 * allowed to do.
 */
function movingGit(): {
  git: FakeGit;
  moveTo: (branch: string, commit?: number) => void;
} {
  let branch = "main";
  let commit = 0;
  const git = new FakeGit((request) => {
    switch (request.operation) {
      case "status":
        return {
          stdout: [
            `# branch.oid ${commitId(commit)}`,
            `# branch.head ${branch}`,
          ].join("\0"),
        };
      case "list-branches":
        return {
          stdout: [
            `refs/heads/main\t${commitId(0)}\t${branch === "main" ? "*" : " "}\trefs/remotes/origin/main\t`,
            `refs/heads/topic\t${commitId(1)}\t${branch === "topic" ? "*" : " "}\t\t`,
          ].join("\n"),
        };
      case "list-history":
        return { stdout: syntheticHistory(2, commit) };
      case "diff":
        return { stdout: SYNTHETIC_DIFF };
      case "checkout-branch":
        branch = request.name;
        return {};
      default:
        return repositoryResponder()(request);
    }
  });
  return {
    git,
    moveTo: (next, at = 0) => {
      branch = next;
      commit = at;
    },
  };
}

function recoveryMessage(model: PluginSourceControlViewModel): string {
  return model.recovery.state === "failed" ? model.recovery.message : "";
}

function reviewSummary(model: PluginSourceControlViewModel): string {
  return model.remoteAccess.review?.summary ?? "";
}

/** Requests that change the repository, so a test can prove none ran. */
const MUTATING = [
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "continue",
  "skip",
  "abort",
  "resolve-conflict",
];

describe("advanced operations", () => {
  it("reviews a merge before anything runs", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    expect(git.operations.filter((operation) => MUTATING.includes(operation)))
      .toEqual([]);
    expect(controller.model.operationPlan).toMatchObject({
      operation: "merge",
      source: "topic",
      currentBranch: "main",
      risk: "may-conflict",
      startActionId: "merge",
      cancelActionId: "cancel-operation-plan",
    });
    expect(controller.model.operationPlan?.summary).toContain("Merge topic");
    expect(controller.model.operationPlan?.affectedPaths).toEqual([
      "notes/changed.md",
    ]);
    expect(controller.model.operationPlan?.affectedPathsLimitation).toContain(
      "differ between main and topic",
    );
  });

  it("names a rebase as history rewriting in its review", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "prepare-rebase", values: { ref: "topic" } },
      git,
    );

    expect(controller.model.operationPlan).toMatchObject({
      operation: "rebase",
      risk: "rewrites-history",
      startActionId: "rebase",
    });
    expect(controller.model.operationPlan?.summary).toContain("rewrites");
  });

  it("reviews a cherry-pick of the commit that was selected", async () => {
    const { controller } = harness();
    const git = cleanGit({ diff: { stdout: SYNTHETIC_COMMIT_DIFF } });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "prepare-cherry-pick", values: { commitId: commitId(0) } },
      git,
    );

    expect(controller.model.operationPlan).toMatchObject({
      operation: "cherry-pick",
      source: commitId(0),
      risk: "creates-commit",
    });
    expect(controller.model.operationPlan?.sourceDetail).toContain(
      "Record synthetic note 0",
    );
    expect(controller.model.operationPlan?.affectedPaths).toEqual([
      "notes/changed.md",
      "notes/added.md",
    ]);
    // A commit's own diff is exactly what a cherry-pick replays.
    expect(controller.model.operationPlan?.affectedPathsLimitation).toBeNull();
  });

  it("refuses to review a commit that is not on the history page", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "prepare-revert", values: { commitId: commitId(99) } },
      git,
    );

    expect(controller.model.operationPlan).toBeNull();
    expect(recoveryMessage(controller.model)).toContain(
      "not in the history page",
    );
  });

  it("refuses to review a branch this repository does not have", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "prepare-merge", values: { ref: "not-a-branch" } },
      git,
    );

    expect(controller.model.operationPlan).toBeNull();
    expect(recoveryMessage(controller.model)).toContain("not a branch");
  });

  it("refuses to merge the branch that is already checked out", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "prepare-merge", values: { ref: "main" } },
      git,
    );

    expect(controller.model.operationPlan).toBeNull();
    expect(recoveryMessage(controller.model)).toContain("already on main");
  });

  it("starts only the operation that was just reviewed", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    expect(git.operations).not.toContain("merge");
    expect(recoveryMessage(controller.model)).toContain(
      "only runs an operation you have just reviewed",
    );
  });

  it("refuses to start an operation the review does not name", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    await controller.runAction({ id: "merge", values: { ref: "main" } }, git);

    expect(git.operations).not.toContain("merge");
    expect(recoveryMessage(controller.model)).toContain("just reviewed");
  });

  it("runs a reviewed merge on a clean working tree", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    expect(git.request("merge")).toEqual({
      operation: "merge",
      scope: "vault",
      ref: "topic",
    });
    expect(reviewSummary(controller.model)).toContain("topic is merged");
    expect(controller.model.operationPlan).toBeNull();
    expect(controller.model.repository.busy).toBe(false);
  });

  it("reviews the working tree before an operation instead of running over it", async () => {
    const { controller } = harness();
    // The default synthetic status holds staged, changed, and untracked paths.
    const git = new FakeGit(
      repositoryResponder({
        "list-history": { stdout: syntheticHistory(2) },
        diff: { stdout: SYNTHETIC_DIFF },
      }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    expect(git.operations).not.toContain("merge");
    expect(controller.model.pendingBranchSwitch).toMatchObject({
      operation: "merge",
      target: "topic",
      stagedPaths: ["notes/staged.md"],
      unstagedPaths: ["notes/changed.md"],
      untrackedPaths: ["notes/new.md"],
      commitActionId: "branch-switch-commit",
    });
  });

  it("commits the listed work and then runs the operation", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({
        "list-history": { stdout: syntheticHistory(2) },
        diff: { stdout: SYNTHETIC_DIFF },
      }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );
    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    await controller.runAction(
      { id: "branch-switch-commit", values: { message: "Save before merging" } },
      git,
    );

    expect(git.request("commit")).toMatchObject({
      operation: "commit",
      message: "Save before merging",
    });
    expect(git.request("merge")).toMatchObject({ ref: "topic" });
    expect(controller.model.pendingBranchSwitch).toBeNull();
  });

  it("reports a merge that stopped on conflicts as work to finish", async () => {
    const { controller } = harness();
    let merged = false;
    const git = new FakeGit((request) => {
      if (request.operation === "merge") {
        merged = true;
        return { exitCode: 1, stderr: "CONFLICT (content): merge conflict" };
      }
      if (merged && request.operation === "status") {
        return { stdout: conflictedStatus(["notes/conflict.md"]) };
      }
      if (merged && request.operation === "operation-state") {
        return { stdout: operationState({ mergeInProgress: true }) };
      }
      return repositoryResponder({
        status: { stdout: CLEAN_STATUS },
        "list-history": { stdout: syntheticHistory(2) },
        diff: { stdout: SYNTHETIC_DIFF },
      })(request);
    });
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    expect(controller.model.operationProgress).toMatchObject({
      operation: "merge",
      conflictedPaths: ["notes/conflict.md"],
      continueAvailable: false,
      skipAvailable: false,
      abortAvailable: true,
    });
    expect(
      controller.model.operationProgress?.continueUnavailableReason,
    ).toContain("Resolve the 1 conflicted file");
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Merge",
      outcome: "failed",
    });
    expect(reviewSummary(controller.model)).toContain("stopped");
    expect(controller.model.conflicts).toHaveLength(1);
  });

  it("reports a merge that failed for another reason as a failure", async () => {
    const { controller } = harness();
    const git = cleanGit({
      merge: { exitCode: 128, stderr: "fatal: refusing to merge" },
    });
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    expect(controller.model.operationProgress).toBeNull();
    expect(recoveryMessage(controller.model)).toContain(
      "refusing to merge",
    );
    expect(controller.model.repository.busy).toBe(false);
  });

  it("refuses to start a second operation while one is in progress", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "operation-state": { stdout: operationState({ rebaseInProgress: true }) },
      status: { stdout: conflictedStatus(["notes/conflict.md"]) },
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    expect(controller.model.operationPlan).toBeNull();
    expect(recoveryMessage(controller.model)).toContain(
      "already has a rebase in progress",
    );
  });

  it("detects an interrupted rebase and offers only its valid controls", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "operation-state": { stdout: operationState({ rebaseInProgress: true }) },
      status: { stdout: conflictedStatus(["notes/conflict.md"]) },
    });

    await controller.runAction({ id: "refresh" }, git);

    expect(controller.model.operationProgress).toMatchObject({
      operation: "rebase",
      continueAvailable: false,
      skipAvailable: true,
      abortAvailable: true,
    });
    // Detection never starts, continues, or aborts anything on its own.
    expect(git.operations.filter((operation) => MUTATING.includes(operation)))
      .toEqual([]);
    expect(controller.model.recovery).toEqual({ state: "idle" });
  });

  it("refuses to continue while Git still reports unmerged paths", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "operation-state": { stdout: operationState({ rebaseInProgress: true }) },
      status: { stdout: conflictedStatus(["notes/conflict.md"]) },
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "continue", values: { sequencer: "rebase" } },
      git,
    );

    expect(git.operations).not.toContain("continue");
    expect(recoveryMessage(controller.model)).toContain("Resolve the 1");
  });

  it("continues once every path is resolved", async () => {
    const { controller } = harness();
    let continued = false;
    const git = new FakeGit((request) => {
      if (request.operation === "continue") {
        continued = true;
        return {};
      }
      if (request.operation === "operation-state") {
        return {
          stdout: operationState({ rebaseInProgress: !continued }),
        };
      }
      return repositoryResponder({
        status: { stdout: CLEAN_STATUS },
        "list-history": { stdout: syntheticHistory(2) },
      })(request);
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "continue", values: { sequencer: "rebase" } },
      git,
    );

    expect(git.request("continue")).toEqual({
      operation: "continue",
      scope: "vault",
      sequencer: "rebase",
    });
    expect(controller.model.operationProgress).toBeNull();
    expect(reviewSummary(controller.model)).toContain("rebase finished");
  });

  it("refuses to skip a merge, which Git cannot skip", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "operation-state": { stdout: operationState({ mergeInProgress: true }) },
      status: { stdout: conflictedStatus(["notes/conflict.md"]) },
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "skip", values: { sequencer: "merge" } },
      git,
    );

    expect(git.operations).not.toContain("skip");
    expect(recoveryMessage(controller.model)).toContain("cannot be skipped");
  });

  it("refuses a resume that names a different operation than the one running", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "operation-state": { stdout: operationState({ mergeInProgress: true }) },
      status: { stdout: conflictedStatus(["notes/conflict.md"]) },
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "abort", values: { sequencer: "rebase" } },
      git,
    );

    expect(git.operations).not.toContain("abort");
    expect(recoveryMessage(controller.model)).toContain(
      "running a merge, not a rebase",
    );
  });

  it("aborts the operation Git reports, and says the repository is back", async () => {
    const { controller } = harness();
    let aborted = false;
    const git = new FakeGit((request) => {
      if (request.operation === "abort") {
        aborted = true;
        return {};
      }
      if (request.operation === "operation-state") {
        return { stdout: operationState({ mergeInProgress: !aborted }) };
      }
      if (request.operation === "status") {
        return {
          stdout: aborted
            ? CLEAN_STATUS
            : conflictedStatus(["notes/conflict.md"]),
        };
      }
      return repositoryResponder({
        "list-history": { stdout: syntheticHistory(2) },
      })(request);
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "abort", values: { sequencer: "merge" } },
      git,
    );

    expect(git.request("abort")).toEqual({
      operation: "abort",
      scope: "vault",
      sequencer: "merge",
    });
    expect(controller.model.operationProgress).toBeNull();
    expect(controller.model.conflicts).toEqual([]);
    expect(reviewSummary(controller.model)).toContain("back where it started");
  });

  it("refuses to resume when Denote sees no operation at all", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "abort", values: { sequencer: "merge" } },
      git,
    );

    expect(git.operations).not.toContain("abort");
    expect(recoveryMessage(controller.model)).toContain(
      "does not see a merge, rebase, cherry-pick, or revert in progress",
    );
  });

  it("cancels a prepared operation without running it", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    await controller.runAction({ id: "cancel-operation-plan" }, git);

    expect(controller.model.operationPlan).toBeNull();
    expect(git.operations).not.toContain("merge");
  });

  it("cancels the commit or stash request the review was waiting on", async () => {
    const { controller } = harness();
    // The default synthetic status has staged, changed, and untracked work, so
    // starting the merge stops at the commit-or-stash review.
    const git = dirtyGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );
    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);
    expect(controller.model.pendingBranchSwitch).toMatchObject({
      operation: "merge",
      target: "topic",
    });

    await controller.runAction({ id: "cancel-operation-plan" }, git);

    // Neither review is left on screen, so no control can still start it.
    expect(controller.model.operationPlan).toBeNull();
    expect(controller.model.pendingBranchSwitch).toBeNull();

    await controller.runAction(
      { id: "branch-switch-commit", values: { message: "Save first" } },
      git,
    );
    await controller.runAction({ id: "branch-switch-stash" }, git);

    expect(git.operations).not.toContain("commit");
    expect(git.operations).not.toContain("stash");
    expect(git.operations).not.toContain("merge");
    expect(recoveryMessage(controller.model)).toContain(
      "no branch switch waiting for an answer",
    );
  });

  it("runs nothing from a preserved request the newest review does not name", async () => {
    const { controller } = harness();
    const git = dirtyGit({ "list-branches": { stdout: SYNTHETIC_BRANCHES_WITH_REMOTE } });
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );
    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);
    expect(controller.model.pendingBranchSwitch).toMatchObject({
      operation: "merge",
      target: "topic",
    });

    // A second review replaces the first while the commit-or-stash request is
    // still held, so the request no longer describes what was reviewed.
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "origin/release" } },
      git,
    );
    await controller.runAction({ id: "branch-switch-stash" }, git);

    expect(git.operations).not.toContain("stash");
    expect(git.operations).not.toContain("merge");
    expect(recoveryMessage(controller.model)).toContain(
      "only runs an operation you have just reviewed",
    );
    expect(controller.model.pendingBranchSwitch).toBeNull();
    expect(controller.model.operationPlan).toBeNull();
  });

  it("will not run a merge reviewed on a branch that has been left", async () => {
    const { controller } = harness();
    const { git } = movingGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );
    expect(controller.model.repository.branch).toBe("topic");
    expect(controller.model.operationPlan).toBeNull();

    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    expect(git.operations).not.toContain("merge");
    expect(recoveryMessage(controller.model)).toContain(
      "Preview the merge again",
    );
  });

  it("will not run a rebase reviewed before a pull moved the branch", async () => {
    const { controller } = harness();
    const { git, moveTo } = movingGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-rebase", values: { ref: "topic" } },
      git,
    );

    moveTo("main", 5);
    await controller.runAction(
      { id: "pull", values: { remote: "origin", branch: "main" } },
      git,
    );
    expect(controller.model.operationPlan).toBeNull();

    await controller.runAction({ id: "rebase", values: { ref: "topic" } }, git);

    expect(git.operations).not.toContain("rebase");
    expect(recoveryMessage(controller.model)).toContain(
      "only runs an operation you have just reviewed",
    );
  });

  it("names both branches when the repository is no longer on the reviewed one", async () => {
    const { controller } = harness();
    const { git, moveTo } = movingGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-merge", values: { ref: "topic" } },
      git,
    );

    // The branch moved outside Denote, so only the refresh the start does can
    // discover it.
    moveTo("release", 5);
    await controller.runAction({ id: "merge", values: { ref: "topic" } }, git);

    expect(git.operations).not.toContain("merge");
    expect(recoveryMessage(controller.model)).toContain(
      "reviewed this merge on main",
    );
    expect(recoveryMessage(controller.model)).toContain("now on release");
    expect(controller.model.operationPlan).toBeNull();
    expect(controller.model.pendingBranchSwitch).toBeNull();
  });

  it("refuses a rebase reviewed at a commit the branch has moved past", async () => {
    const { controller } = harness();
    const { git, moveTo } = movingGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "prepare-rebase", values: { ref: "topic" } },
      git,
    );

    // The same branch, at a different commit: the files the review listed
    // describe a comparison that no longer exists.
    moveTo("main", 5);
    await controller.runAction({ id: "rebase", values: { ref: "topic" } }, git);

    expect(git.operations).not.toContain("rebase");
    expect(recoveryMessage(controller.model)).toContain(
      "main has moved since Denote reviewed this rebase",
    );
    expect(controller.model.operationPlan).toBeNull();
  });

  it("labels conflicts by the operation that produced them", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "operation-state": { stdout: operationState({ rebaseInProgress: true }) },
      status: { stdout: conflictedStatus(["notes/conflict.md"]) },
      "list-conflicts": {
        stdout: unmergedListing([
          { path: "notes/conflict.md", stages: [1, 2, 3] },
        ]),
      },
    });

    await controller.runAction({ id: "refresh" }, git);

    expect(controller.model.conflicts[0]).toMatchObject({
      path: "notes/conflict.md",
      oursLabel: "Commits already on main",
      theirsLabel: "The commit being replayed",
      baseLabel: "Common ancestor",
    });
  });

  it("reads nothing that changes the repository during a refresh", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "operation-state": {
        stdout: operationState({ cherryPickInProgress: true }),
      },
      status: { stdout: SYNTHETIC_STATUS },
    });

    await controller.runAction({ id: "refresh" }, git);

    expect(controller.model.operationProgress?.operation).toBe("cherry-pick");
    expect(git.operations.filter((operation) => MUTATING.includes(operation)))
      .toEqual([]);
  });
});
