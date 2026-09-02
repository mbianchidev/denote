import { describe, expect, it } from "vitest";
import type {
  PluginGitResult,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";
import { GitRepositoryController } from "../src/controller";
import { vaultScope } from "../src/model";
import {
  BINARY_COMMIT_DIFF,
  FakeGit,
  RENAME_COMMIT_DIFF,
  SYNTHETIC_COMMIT_DIFF,
  SYNTHETIC_DIFF,
  commitId,
  deferred,
  repositoryResponder,
  syntheticHistory,
} from "./support";

interface Harness {
  controller: GitRepositoryController;
  published: PluginSourceControlViewModel[];
  reports: string[];
}

function harness(): Harness {
  const published: PluginSourceControlViewModel[] = [];
  const reports: string[] = [];
  const controller = new GitRepositoryController(vaultScope(), {
    publish: (model) => published.push(model),
    readSettings: () => Promise.resolve({}),
    report: (message) => reports.push(message),
  });
  return { controller, published, reports };
}

/** A repository whose log is long enough to have a second page. */
function pagedGit(overrides: Record<string, Partial<PluginGitResult>> = {}) {
  return new FakeGit((request) => {
    if (request.operation === "list-history") {
      const skip = "skip" in request ? (request.skip ?? 0) : 0;
      // The synthetic log holds exactly 30 commits, so page 0 has a commit
      // beyond it and page 1 does not.
      const remaining = Math.max(0, 30 - skip);
      const count = Math.min(remaining, request.maxCount);
      return { stdout: syntheticHistory(count, skip) };
    }
    return repositoryResponder(overrides)(request);
  });
}

describe("GitRepositoryController history paging", () => {
  it("reads one bounded page and reports that an older page exists", async () => {
    const { controller } = harness();
    const git = pagedGit();

    await controller.runAction({ id: "refresh" }, git);

    expect(git.request("list-history")).toEqual({
      operation: "list-history",
      scope: "vault",
      maxCount: 21,
    });
    expect(controller.model.history).toHaveLength(20);
    // The commit read only to answer "is there another page?" is never shown.
    expect(
      controller.model.history.some((entry) => entry.id === commitId(20)),
    ).toBe(false);
    expect(controller.model.historyPage).toEqual({
      pageIndex: 0,
      pageSize: 20,
      hasPrevious: false,
      hasNext: true,
      loading: false,
      error: null,
    });
    expect(controller.model.repository.latestCommit?.id).toBe(commitId(0));
  });

  it("pages forwards and backwards with skip, and never before the first page", async () => {
    const { controller } = harness();
    const git = pagedGit();
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "history-next" }, git);

    const forwards = git.calls
      .filter((call) => call.request.operation === "list-history")
      .map((call) => call.request);
    expect(forwards[forwards.length - 1]).toEqual({
      operation: "list-history",
      scope: "vault",
      maxCount: 21,
      skip: 20,
    });
    expect(controller.model.history[0]?.id).toBe(commitId(20));
    expect(controller.model.historyPage).toMatchObject({
      pageIndex: 1,
      hasPrevious: true,
      // Only ten commits are left, so nothing older than this page exists.
      hasNext: false,
    });
    // A later page never renames the repository's newest commit.
    expect(controller.model.repository.latestCommit?.id).toBe(commitId(0));

    await controller.runAction({ id: "history-previous" }, git);
    expect(controller.model.historyPage).toMatchObject({
      pageIndex: 0,
      hasPrevious: false,
      hasNext: true,
    });
    expect(controller.model.history[0]?.id).toBe(commitId(0));

    const before = git.calls.length;
    await controller.runAction({ id: "history-previous" }, git);
    // There is no page before the first one, so Git is never asked for one.
    expect(git.calls).toHaveLength(before);
    expect(controller.model.historyPage.pageIndex).toBe(0);
  });

  it("re-reads the page that is open when history is refreshed", async () => {
    const { controller } = harness();
    const git = pagedGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction({ id: "history-next" }, git);

    await controller.runAction({ id: "refresh-history" }, git);

    const requests = git.calls
      .filter((call) => call.request.operation === "list-history")
      .map((call) => call.request);
    expect(requests[requests.length - 1]).toMatchObject({ skip: 20 });
    expect(controller.model.historyPage.pageIndex).toBe(1);
    // Only history was read: the working tree was not touched.
    expect(git.operations.filter((operation) => operation === "status")).toEqual(
      ["status"],
    );
  });

  it("returns to the newest page on a full refresh", async () => {
    const { controller } = harness();
    const git = pagedGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction({ id: "history-next" }, git);
    expect(controller.model.historyPage.pageIndex).toBe(1);

    await controller.runAction({ id: "refresh" }, git);

    expect(controller.model.historyPage).toMatchObject({
      pageIndex: 0,
      hasPrevious: false,
    });
    expect(controller.model.history[0]?.id).toBe(commitId(0));
  });

  it("keeps the commits on screen when the page it was asked for is gone", async () => {
    const { controller } = harness();
    // The log shrank between pages, so the second page comes back empty.
    const git = new FakeGit((request) =>
      request.operation === "list-history"
        ? {
            stdout:
              "skip" in request && (request.skip ?? 0) > 0
                ? ""
                : syntheticHistory(21),
          }
        : repositoryResponder()(request),
    );
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "history-next" }, git);

    expect(controller.model.history).toHaveLength(20);
    expect(controller.model.historyPage).toMatchObject({
      pageIndex: 0,
      error: expect.stringContaining("no more commits"),
      loading: false,
    });
  });

  it("leaves the pager usable when a page read fails or is cancelled", async () => {
    const { controller } = harness();
    let historyCalls = 0;
    const git = new FakeGit((request) => {
      if (request.operation !== "list-history") {
        return repositoryResponder()(request);
      }
      historyCalls += 1;
      return historyCalls === 1
        ? { stdout: syntheticHistory(21) }
        : { exitCode: 1, stderr: "fatal: synthetic failure" };
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "history-next" }, git);

    expect(controller.model.recovery).toMatchObject({ state: "failed" });
    // The controls a surface offers are all disabled while a read is running,
    // so a failed read that left that flag set would strand the history with
    // no way to read itself again.
    expect(controller.model.historyPage).toMatchObject({
      pageIndex: 0,
      loading: false,
      hasNext: true,
    });
    expect(controller.model.history).toHaveLength(20);

    await controller.runAction({ id: "dismiss" }, git);
    expect(controller.model.historyPage.loading).toBe(false);
    expect(controller.model.recovery).toEqual({ state: "idle" });
  });

  it("drops a history page that lands after the repository changed", async () => {
    const { controller, reports } = harness();
    const pending = deferred<Partial<PluginGitResult>>();
    const git = new FakeGit((request) =>
      request.operation === "list-history"
        ? pending.promise
        : repositoryResponder()(request),
    );
    const initial = new FakeGit((request) =>
      request.operation === "list-history"
        ? { stdout: syntheticHistory(21) }
        : repositoryResponder()(request),
    );
    await controller.runAction({ id: "refresh" }, initial);

    const running = controller.runAction({ id: "history-next" }, git);
    await Promise.resolve();
    controller.setScope(vaultScope(), true);
    pending.resolve({ stdout: syntheticHistory(20, 20) });
    await running;

    // The page belongs to the repository that was open before the change, so
    // it is discarded rather than published over the reset model.
    expect(controller.model.history).toEqual([]);
    expect(controller.model.repository.label).toBe("Vault · refresh required");
    expect(reports).toContain("Discarded a stale history page.");
  });

  it("ignores a second page request while one is already running", async () => {
    const { controller } = harness();
    const pending = deferred<Partial<PluginGitResult>>();
    let historyCalls = 0;
    const git = new FakeGit((request) => {
      if (request.operation !== "list-history") {
        return repositoryResponder()(request);
      }
      historyCalls += 1;
      return historyCalls === 1
        ? { stdout: syntheticHistory(21) }
        : pending.promise;
    });
    await controller.runAction({ id: "refresh" }, git);

    const running = controller.runAction({ id: "history-next" }, git);
    await Promise.resolve();
    await controller.runAction({ id: "history-next" }, git);
    pending.resolve({ stdout: syntheticHistory(20, 20) });
    await running;

    expect(historyCalls).toBe(2);
    expect(controller.model.historyPage.pageIndex).toBe(1);
  });
});

describe("GitRepositoryController commit diffs", () => {
  const openFirstCommit = async (
    controller: GitRepositoryController,
    git: FakeGit,
  ) => {
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "select-tab", values: { tab: "history" } },
      git,
    );
    await controller.runAction(
      { id: "open-commit", values: { commitId: commitId(0) } },
      git,
    );
  };

  it("reads the exact diff of the selected commit", async () => {
    const { controller } = harness();
    const git = pagedGit({ diff: { stdout: SYNTHETIC_COMMIT_DIFF } });

    await openFirstCommit(controller, git);

    expect(git.request("diff")).toEqual({
      operation: "diff",
      scope: "vault",
      target: { kind: "commit", commit: commitId(0) },
    });
    const detail = controller.model.commitDetail;
    expect(detail?.commit.id).toBe(commitId(0));
    expect(detail?.commit.summary).toBe("Record synthetic note 0");
    expect(detail?.limitation).toBeNull();
    expect(detail?.files.map((file) => file.path)).toEqual([
      "notes/changed.md",
      "notes/added.md",
    ]);
    // A commit message that itself contains a diff header is indented by Git,
    // so it can never be read as another changed file.
    expect(
      detail?.files.some((file) => file.path === "notes/injected.md"),
    ).toBe(false);
    expect(detail?.files[0].hunks[0].lines).toEqual([
      { kind: "context", oldLineNumber: 1, newLineNumber: 1, content: "one" },
      { kind: "deletion", oldLineNumber: 2, newLineNumber: null, content: "two" },
      { kind: "addition", oldLineNumber: null, newLineNumber: 2, content: "TWO" },
      { kind: "context", oldLineNumber: 3, newLineNumber: 3, content: "three" },
    ]);
    expect(detail?.files[1].status).toBe("added");
    expect(controller.model.diffSource).toEqual({
      kind: "commit",
      commitId: commitId(0),
    });
    // A commit's diff never annotates a working tree row with its counts.
    expect(controller.model.diffFiles).toEqual([]);
  });

  it("reports a rename's previous path and a deletion in a commit", async () => {
    const { controller } = harness();
    const git = pagedGit({ diff: { stdout: RENAME_COMMIT_DIFF } });

    await openFirstCommit(controller, git);

    expect(
      controller.model.commitDetail?.files.map((file) => ({
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
      })),
    ).toEqual([
      {
        path: "notes/new name.md",
        previousPath: "notes/old name.md",
        status: "renamed",
      },
      { path: "notes/removed.md", previousPath: null, status: "deleted" },
    ]);
  });

  it("compares a merge commit with its first parent and says so", async () => {
    const { controller } = harness();
    const git = new FakeGit((request) => {
      if (request.operation === "list-history") {
        return {
          stdout: syntheticHistory(1, 0, {
            0: { parentIds: [commitId(1), commitId(2)] },
          }),
        };
      }
      if (request.operation === "diff") {
        return { stdout: SYNTHETIC_COMMIT_DIFF };
      }
      return repositoryResponder()(request);
    });

    await openFirstCommit(controller, git);

    expect(git.request("diff")).toEqual({
      operation: "diff",
      scope: "vault",
      target: {
        kind: "range",
        fromCommit: commitId(1),
        toCommit: commitId(0),
      },
    });
    expect(controller.model.commitDetail?.limitation).toContain(
      "merge commit",
    );
  });

  it("reports an empty commit without pretending it changed something", async () => {
    const { controller } = harness();
    const git = pagedGit({ diff: { stdout: `commit ${commitId(0)}\n\n    Empty\n` } });

    await openFirstCommit(controller, git);

    expect(controller.model.commitDetail?.files).toEqual([]);
    expect(controller.model.selectedView).toEqual({
      kind: "commit",
      commitId: commitId(0),
    });
  });

  it("explains an encrypted vault's binary history", async () => {
    const { controller } = harness();
    const git = new FakeGit((request) =>
      request.operation === "discover"
        ? { stdout: JSON.stringify({ initialized: true, encrypted: true }) }
        : request.operation === "diff"
          ? { stdout: BINARY_COMMIT_DIFF }
          : request.operation === "list-history"
            ? { stdout: syntheticHistory(1) }
            : repositoryResponder()(request),
    );

    await openFirstCommit(controller, git);

    expect(controller.model.commitDetail?.files[0]).toMatchObject({
      path: "notes/sealed.md",
      binary: true,
      hunks: [],
    });
    expect(controller.model.commitDetail?.limitation).toContain("encrypted");
  });

  it("refuses a commit that is not in the page Denote has read", async () => {
    const { controller } = harness();
    const git = pagedGit();
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "open-commit", values: { commitId: commitId(99) } },
      git,
    );

    expect(git.calls).toHaveLength(before);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: expect.stringContaining("not in the history page"),
    });
  });

  it("returns to the history list when the open commit leaves the page", async () => {
    const { controller } = harness();
    const git = pagedGit({ diff: { stdout: SYNTHETIC_COMMIT_DIFF } });
    await openFirstCommit(controller, git);
    expect(controller.model.commitDetail).not.toBeNull();

    await controller.runAction({ id: "history-next" }, git);

    expect(controller.model.selectedView).toEqual({ kind: "history" });
    expect(controller.model.commitDetail).toBeNull();
    expect(controller.model.diffSource).toBeNull();
  });

  it("keeps the open commit across a refresh without reading it again", async () => {
    const { controller } = harness();
    const git = pagedGit({ diff: { stdout: SYNTHETIC_COMMIT_DIFF } });
    await openFirstCommit(controller, git);
    const diffs = git.calls.filter(
      (call) => call.request.operation === "diff",
    ).length;

    await controller.runAction({ id: "refresh" }, git);

    // A commit is named by the hash of its own content, so the diff that was
    // read for it cannot have changed.
    expect(
      git.calls.filter((call) => call.request.operation === "diff"),
    ).toHaveLength(diffs);
    expect(controller.model.commitDetail?.commit.id).toBe(commitId(0));
    expect(controller.model.selectedView).toEqual({
      kind: "commit",
      commitId: commitId(0),
    });
  });

  it("closes a commit back to the list without running Git", async () => {
    const { controller } = harness();
    const git = pagedGit({ diff: { stdout: SYNTHETIC_COMMIT_DIFF } });
    await openFirstCommit(controller, git);
    const before = git.calls.length;

    await controller.runAction({ id: "close-commit" }, git);

    expect(git.calls).toHaveLength(before);
    expect(controller.model.commitDetail).toBeNull();
    expect(controller.model.selectedView).toEqual({ kind: "history" });
  });

  it("refuses a commit diff that is larger than Denote parses", async () => {
    const { controller } = harness();
    const enormous = [
      "diff --git a/notes/huge.md b/notes/huge.md",
      "--- a/notes/huge.md",
      "+++ b/notes/huge.md",
      `@@ -1,1 +1,1 @@`,
      ` ${"x".repeat(9000)}`,
    ].join("\n");
    const git = pagedGit({ diff: { stdout: enormous } });

    await openFirstCommit(controller, git);

    expect(controller.model.commitDetail).toBeNull();
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: expect.stringContaining("larger than Denote can display"),
    });
  });

  it("never offers a hunk action for the diff of a commit", async () => {
    const { controller } = harness();
    const git = pagedGit({ diff: { stdout: SYNTHETIC_COMMIT_DIFF } });
    await openFirstCommit(controller, git);

    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/changed.md", hunk: 0 } },
      git,
    );

    expect(
      git.calls.some((call) => call.request.operation === "stage-hunk"),
    ).toBe(false);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: expect.stringContaining("history"),
    });
  });

  it("drops an open working tree diff when a commit is opened", async () => {
    const { controller } = harness();
    const git = new FakeGit((request) =>
      request.operation === "diff"
        ? {
            stdout:
              "target" in request && request.target.kind === "worktree"
                ? SYNTHETIC_DIFF
                : SYNTHETIC_COMMIT_DIFF,
          }
        : request.operation === "list-history"
          ? { stdout: syntheticHistory(1) }
          : repositoryResponder()(request),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );
    expect(controller.model.diffSource).toEqual({ kind: "worktree" });

    await controller.runAction(
      { id: "select-tab", values: { tab: "history" } },
      git,
    );

    // Switching away from the diff clears it, so no working tree content is
    // ever left on screen under a commit.
    expect(controller.model.diffFiles).toEqual([]);
    expect(controller.model.diffSource).toBeNull();

    await controller.runAction(
      { id: "open-commit", values: { commitId: commitId(0) } },
      git,
    );
    expect(controller.model.diffSource).toEqual({
      kind: "commit",
      commitId: commitId(0),
    });
    expect(controller.model.diffFiles).toEqual([]);
  });
});
