import { describe, expect, it } from "vitest";
import type { PluginGitResult, PluginSourceControlViewModel } from "@denote/plugin-sdk";
import { GitRepositoryController } from "../src/controller";
import { scopeFor, vaultScope } from "../src/model";
import { CLEAN_STATUS, FakeGit, deferred, repositoryResponder } from "./support";

const BEFORE = "1".repeat(40);
const AFTER = "2".repeat(40);
const FILES = [
  { path: "notes/edited.md", previousPath: null, additions: 3, deletions: 1, binary: false },
  { path: "notes/new.md", previousPath: "notes/old.md", additions: 0, deletions: 0, binary: false },
  { path: "image.bin", previousPath: null, additions: 0, deletions: 0, binary: true },
];
const STATS = [
  "3\t1\tnotes/edited.md",
  "0\t0\t",
  "notes/old.md",
  "notes/new.md",
  "-\t-\timage.bin",
  "",
].join("\0");
const PULL = { id: "pull", values: { remote: "origin", branch: "main" } };

function harness(pullStrategy = "fast-forward-only") {
  const published: PluginSourceControlViewModel[] = [];
  const reports: string[] = [];
  const controller = new GitRepositoryController(vaultScope(), {
    publish: (model) => published.push(model),
    readSettings: async () => ({ pullStrategy }),
    report: (message) => reports.push(message),
  });
  return { controller, published, reports };
}

function pullGit({
  before = BEFORE,
  after = AFTER,
  stats = STATS,
  pullResult = {},
  reportResult,
  refreshFails = false,
}: {
  before?: string | null;
  after?: string;
  stats?: string;
  pullResult?: Partial<PluginGitResult>;
  reportResult?: () => Partial<PluginGitResult> | Promise<Partial<PluginGitResult>>;
  refreshFails?: boolean;
} = {}): FakeGit {
  let pulled = false;
  const respond = repositoryResponder();
  return new FakeGit((request) => {
    if (request.operation === "pull") {
      pulled = true;
      return pullResult;
    }
    if (request.operation === "status") {
      return { stdout: CLEAN_STATUS.replace(BEFORE, pulled ? after : before ?? "(initial)") };
    }
    if (request.operation === "diff" && request.format === "numstat" && request.target.kind === "range") {
      return reportResult ? reportResult() : { stdout: stats };
    }
    if (refreshFails && pulled && request.operation === "list-branches") {
      return { exitCode: 1, stderr: "Synthetic refresh failure" };
    }
    return respond(request);
  });
}

describe("pull file reports", () => {
  it.each(["fast-forward-only", "merge", "rebase"])(
    "reports the exact before/after comparison for a %s pull",
    async (strategy) => {
      const { controller } = harness(strategy);
      const git = pullGit();

      await controller.runAction(PULL, git);

      expect(git.calls[0].request).toEqual({ operation: "status", scope: "vault" });
      expect(git.request("pull")).toMatchObject({ strategy });
      expect(git.request("diff")).toEqual({
        operation: "diff",
        scope: "vault",
        target: { kind: "range", fromCommit: BEFORE, toCommit: AFTER },
        format: "numstat",
      });
      expect(controller.model.remoteAccess.review).toMatchObject({
        operation: "Pull",
        outcome: "succeeded",
        summary: "Pulled main from origin. 3 files changed.",
        files: FILES,
      });
      expect(controller.model.recovery).toEqual({ state: "idle" });
      expect(controller.model.repository.busy).toBe(false);

      await controller.runAction({ id: "refresh" }, git);
      expect(controller.model.remoteAccess.review).toMatchObject({ files: FILES });
      await controller.runAction({ id: "dismiss-review" }, git);
      expect(controller.model.remoteAccess.review).toBeNull();
    },
  );

  it.each([false, true])("reports no file changes without claiming every pull moved files", async (unchangedHead) => {
    const { controller } = harness();
    const git = pullGit({ after: unchangedHead ? BEFORE : AFTER, stats: "" });
    await controller.runAction(PULL, git);
    expect(controller.model.remoteAccess.review).toMatchObject({
      outcome: "succeeded",
      summary: "Pulled main from origin. No files changed.",
      files: [],
    });
  });

  it.each([
    [40, "4b825dc642cb6eb9a060e54bf8d69288fbee4904"],
    [64, "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321"],
  ])("compares an unborn repository with the empty tree for %i-character IDs", async (length, emptyTree) => {
    const { controller } = harness();
    const after = "2".repeat(Number(length));
    const git = pullGit({ before: null, after, stats: "2\t0\tfirst.md\0" });
    await controller.runAction(PULL, git);
    expect(git.request("diff")).toMatchObject({
      target: { kind: "range", fromCommit: emptyTree, toCommit: after },
    });
    expect(controller.model.remoteAccess.review).toMatchObject({
      files: [{ path: "first.md", additions: 2, deletions: 0 }],
    });
  });

  it("reports more files than a full patch can display", async () => {
    const { controller } = harness();
    const stats = Array.from({ length: 50 }, (_, index) => `1\t0\tfile-${index}.md\0`).join("");
    await controller.runAction(PULL, pullGit({ stats }));
    expect(controller.model.remoteAccess.review).toMatchObject({
      summary: "Pulled main from origin. 50 files changed.",
      files: expect.arrayContaining([{ path: "file-49.md", previousPath: null, additions: 1, deletions: 0, binary: false }]),
    });
    expect(controller.model.recovery).toEqual({ state: "idle" });
  });

  it("keeps a successful pull distinct from a failed report", async () => {
    const { controller, reports } = harness();
    const git = pullGit({ reportResult: () => ({ exitCode: 1, stderr: "Synthetic statistics failure" }) });
    await controller.runAction(PULL, git);
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Pull",
      outcome: "succeeded",
      summary: "Pulled main from origin.",
      detail: expect.stringContaining("file-change report"),
    });
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: expect.stringContaining("pull completed"),
      retryActionId: "refresh",
    });
    expect(git.calls.filter((call) => call.request.operation === "pull")).toHaveLength(1);
    expect(reports).not.toHaveLength(0);
    expect(controller.model.repository.busy).toBe(false);
  });

  it("retains the file report when the post-pull refresh fails", async () => {
    const { controller } = harness();
    await controller.runAction(PULL, pullGit({ refreshFails: true }));
    expect(controller.model.remoteAccess.review).toMatchObject({ outcome: "succeeded", files: FILES });
    expect(controller.model.recovery).toMatchObject({ state: "failed", message: expect.stringContaining("pull completed") });
  });

  it("never describes a rejected pull as successful", async () => {
    const { controller } = harness();
    const git = pullGit({ pullResult: { exitCode: 1, stderr: "Synthetic pull rejection" } });
    await controller.runAction(PULL, git);
    expect(controller.model.remoteAccess.review).toBeNull();
    expect(controller.model.recovery).toMatchObject({ state: "failed" });
    expect(git.request("diff")).toBeUndefined();
  });

  it("stops after cancellation during reporting without suggesting another pull", async () => {
    const { controller } = harness();
    const git = pullGit({ reportResult: () => ({ cancelled: true }) });
    await controller.runAction(PULL, git);
    expect(controller.model.remoteAccess.review).toMatchObject({ outcome: "succeeded" });
    expect(controller.model.recovery).toMatchObject({ state: "failed", retryActionId: "refresh" });
    expect(git.operations).not.toContain("list-branches");
  });

  it("clears repository-specific reports on a scope change", async () => {
    const { controller } = harness();
    await controller.runAction(PULL, pullGit());
    controller.setScope(scopeFor({ projectId: "another-project", rootPath: "projects/another" }));
    expect(controller.model.remoteAccess.review).toBeNull();
  });

  it("discards a report that completes after switching repositories", async () => {
    const { controller } = harness();
    const started = deferred<void>();
    const pending = deferred<Partial<PluginGitResult>>();
    const git = pullGit({ reportResult: () => {
      started.resolve(undefined);
      return pending.promise;
    } });
    const running = controller.runAction(PULL, git);
    await started.promise;
    controller.setScope(scopeFor({ projectId: "another-project", rootPath: "projects/another" }));
    pending.resolve({ stdout: STATS });
    await running;
    expect(controller.model.repository.repositoryId).toBe("project:another-project");
    expect(controller.model.remoteAccess.review).toBeNull();
  });
});
