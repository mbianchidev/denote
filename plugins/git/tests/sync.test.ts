import { describe, expect, it } from "vitest";
import { GitRepositoryController } from "../src/controller";
import { vaultScope } from "../src/model";
import { CLEAN_STATUS, FakeGit, conflictedStatus, operationState, repositoryResponder } from "./support";

const PUSH = { id: "push", values: { remote: "origin", branch: "main" } };
const PULL = { id: "pull", values: { remote: "origin", branch: "main" } };
const REJECTED = {
  exitCode: 1,
  stdout: "To https://example.invalid/synthetic.git\n!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\nDone\n",
  stderr: "error: failed to push some refs to 'https://example.invalid/synthetic.git'\nhint: Updates were rejected because the remote contains work that you do not have locally.",
};

function harness(pullStrategy = "fast-forward-only") {
  const controller = new GitRepositoryController(vaultScope(), {
    publish: () => {},
    readSettings: async () => ({ pullStrategy }),
    report: () => {},
  });
  return controller;
}

describe("remote synchronization recovery", () => {
  it("explains stale origin and offers the saved pull preference without fetching or retrying a push", async () => {
    const controller = harness("rebase");
    const git = new FakeGit(repositoryResponder({ status: { stdout: CLEAN_STATUS }, push: REJECTED }));
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(PUSH, git);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: expect.stringMatching(/origin\/main.*(newer|not pulled|missing)/i),
      remoteSync: { reason: "remote-ahead", remote: "origin", branch: "main", localBranch: "main", pullStrategy: "rebase" },
    });
    expect(controller.model.recovery).toMatchObject({ message: expect.stringMatching(/commits.*local/i) });
    expect(git.calls.filter((call) => call.request.operation === "push")).toHaveLength(1);
    expect(git.operations).not.toContain("fetch");
    expect(git.operations).not.toContain("pull");
    await controller.runAction({ id: "refresh" }, git);
    expect(controller.model.recovery).toHaveProperty("remoteSync");
    await controller.runAction({ id: "dismiss" }, git);
    expect(controller.model.recovery).toEqual({ state: "idle" });
  });

  it("keeps a successful commit distinct from a rejected push", async () => {
    const controller = harness("merge");
    const git = new FakeGit(repositoryResponder({ push: REJECTED }));
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction({ id: "commit-and-push", values: { ...PUSH.values, message: "Record synthetic work" } }, git);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: expect.stringMatching(/commit.*(created|recorded|succeeded).*local/i),
      remoteSync: { pullStrategy: "merge" },
    });
    expect(git.calls.filter((call) => call.request.operation === "commit")).toHaveLength(1);
  });

  it.each([
    { exitCode: 128, stderr: "fatal: Authentication failed for the synthetic remote" },
    { exitCode: 1, stdout: "!\trefs/heads/main:refs/heads/main\t[remote rejected] (protected branch hook declined)\n", stderr: "error: failed to push some refs" },
    { exitCode: 1, stderr: "fatal: unable to access remote: Network is unreachable" },
  ])("does not misdiagnose authentication, policy or network failures as a missing pull", async (failure) => {
    const controller = harness();
    const git = new FakeGit(repositoryResponder({ push: failure }));
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(PUSH, git);
    expect(controller.model.recovery).toMatchObject({ state: "failed" });
    expect(controller.model.recovery).not.toHaveProperty("remoteSync");
  });

  it("reports divergent histories instead of the first fetch-progress line", async () => {
    const controller = harness();
    const git = new FakeGit(repositoryResponder({
      status: { stdout: CLEAN_STATUS },
      pull: { exitCode: 128, stderr: "From https://example.invalid/synthetic.git\n * branch main -> FETCH_HEAD\nfatal: Not possible to fast-forward, aborting.\n" },
    }));
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(PULL, git);
    expect(controller.model.recovery).toMatchObject({
      state: "failed", message: expect.stringMatching(/diverg.*merge.*rebase/i),
      remoteSync: { reason: "diverged", remote: "origin", branch: "main", pullStrategy: "fast-forward-only" },
    });
    expect(controller.model.operationProgress).toBeNull();
    expect(git.calls.filter((call) => call.request.operation === "pull")).toHaveLength(1);
  });

  it.each(["merge", "rebase"])("runs only the explicitly chosen %s strategy for a recovery pull", async (strategy) => {
    const controller = harness();
    const git = new FakeGit(repositoryResponder({ status: { stdout: CLEAN_STATUS } }));
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction({ id: "pull", values: { ...PULL.values, strategy, from: "main" } }, git);
    expect(git.request("pull")).toMatchObject({ strategy, remote: "origin", branch: "main" });
    expect(git.operations).not.toContain("push");
    expect(controller.model.recovery).toEqual({ state: "idle" });
  });

  it.each(["merge", "rebase"])("refreshes a failed %s pull into the in-plugin conflict workflow", async (strategy) => {
    const controller = harness(strategy);
    let conflicted = false;
    const respond = repositoryResponder();
    const git = new FakeGit((request) => {
      if (request.operation === "pull") {
        conflicted = true;
        return { exitCode: 1, stderr: "From https://example.invalid/synthetic.git\nCONFLICT (content): Merge conflict in notes/example.md\n" };
      }
      if (request.operation === "status") return { stdout: conflicted ? conflictedStatus(["notes/example.md"]) : CLEAN_STATUS };
      if (request.operation === "operation-state") return { stdout: operationState(conflicted ? {
        mergeInProgress: strategy === "merge", rebaseInProgress: strategy === "rebase",
        rebaseKind: strategy === "rebase" ? "merge" : null,
      } : {}) };
      return respond(request);
    });
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(PULL, git);
    expect(controller.model.operationProgress).toMatchObject({
      operation: strategy, conflictedPaths: ["notes/example.md"], continueAvailable: false, abortAvailable: true,
    });
    expect(controller.model.conflicts).toHaveLength(1);
    expect(controller.model.remoteAccess.review).toMatchObject({ operation: "Pull", outcome: "failed", summary: expect.stringMatching(/conflict.*continue/i) });
    expect(controller.model.recovery).not.toHaveProperty("remoteSync");
    expect(git.operations).not.toContain("continue");
    expect(git.operations).not.toContain("abort");
  });

  it("refuses a stale recovery action after a branch change and invalid strategy values", async () => {
    const controller = harness();
    const git = new FakeGit(repositoryResponder({ status: { stdout: CLEAN_STATUS.replace("# branch.head main", "# branch.head other") } }));
    await controller.runAction({ id: "pull", values: { ...PULL.values, strategy: "rebase", from: "main" } }, git);
    expect(git.operations).not.toContain("pull");
    expect(controller.model.recovery).toMatchObject({ state: "failed", message: expect.stringMatching(/branch.*changed/i) });
    await controller.runAction({ id: "pull", values: { ...PULL.values, strategy: "--force" } }, git);
    expect(git.operations).not.toContain("pull");
  });
});
