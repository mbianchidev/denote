import { describe, expect, it } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import { GitRepositoryController } from "../src/controller";
import { vaultScope } from "../src/model";
import {
  CLEAN_STATUS,
  CONFLICTED_STATUS,
  CRLF_DIFF,
  FakeGit,
  SYNTHETIC_BRANCHES_WITH_REMOTE,
  SYNTHETIC_DIFF,
  SYNTHETIC_STATUS,
  last,
  repositoryResponder,
} from "./support";

/** The request one operation issued, so an assertion never counts refreshes. */
function issued(git: FakeGit, operation: string) {
  return git.calls.find((call) => call.request.operation === operation)
    ?.request;
}

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

/** A repository whose working tree Git reports as completely clean. */
function cleanGit(overrides: Record<string, unknown> = {}): FakeGit {
  return new FakeGit(
    repositoryResponder({ status: { stdout: CLEAN_STATUS }, ...overrides }),
  );
}

/** A repository that is encrypted, so untracked files cannot be stashed. */
function encryptedGit(): FakeGit {
  return new FakeGit(
    repositoryResponder({
      discover: {
        stdout: JSON.stringify({ initialized: true, encrypted: true }),
      },
    }),
  );
}

function recoveryMessage(model: PluginSourceControlViewModel): string {
  return model.recovery.state === "failed" ? model.recovery.message : "";
}

describe("branch workflows", () => {
  it("checks out immediately when the working tree is clean", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);
    const reads = git.calls.length;

    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );

    // The working tree is read again before the checkout, so the decision is
    // made from what Git reports now.
    expect(git.calls[reads].request).toMatchObject({ operation: "discover" });
    expect(issued(git, "checkout-branch")).toEqual({
      operation: "checkout-branch",
      scope: "vault",
      name: "topic",
    });
    expect(controller.model.pendingBranchSwitch).toBeNull();
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Switch branch",
      outcome: "succeeded",
    });
  });

  it("publishes a review instead of checking out over uncommitted work", async () => {
    const { controller } = harness();
    // The default synthetic status has one staged, one changed, and one
    // untracked path.
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );

    expect(git.operations).not.toContain("checkout-branch");
    expect(controller.model.pendingBranchSwitch).toEqual({
      operation: "checkout",
      target: "topic",
      localBranch: null,
      fromBranch: "main",
      stagedPaths: ["notes/staged.md"],
      unstagedPaths: ["notes/changed.md"],
      untrackedPaths: ["notes/new.md"],
      commitAvailable: true,
      stashAvailable: true,
      stashUnavailableReason: null,
      commitActionId: "branch-switch-commit",
      stashActionId: "branch-switch-stash",
      cancelActionId: "branch-switch-cancel",
    });
    expect(controller.model.repository.busy).toBe(false);
  });

  it("commits exactly the listed paths and then checks out", async () => {
    const { controller } = harness({
      authorName: "Synthetic Author",
      authorEmail: "author@example.invalid",
    });
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction(
      {
        id: "branch-switch-commit",
        values: { message: "Record work before switching" },
      },
      git,
    );

    const issued = git.calls.slice(before).map((call) => call.request);
    expect(issued[0]).toEqual({
      operation: "stage",
      scope: "vault",
      paths: ["notes/staged.md", "notes/changed.md", "notes/new.md"],
    });
    expect(issued[1]).toEqual({
      operation: "commit",
      scope: "vault",
      message: "Record work before switching",
      authorName: "Synthetic Author",
      authorEmail: "author@example.invalid",
    });
    expect(issued[2]).toEqual({
      operation: "checkout-branch",
      scope: "vault",
      name: "topic",
    });
    expect(controller.model.pendingBranchSwitch).toBeNull();
  });

  it("stashes untracked files only when the vault is not encrypted", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction({ id: "branch-switch-stash" }, git);

    expect(git.calls[before].request).toEqual({
      operation: "stash",
      scope: "vault",
      action: "push",
      message: "Denote: before switching to topic",
      includeUntracked: true,
    });
    expect(git.operations).not.toContain("checkout-branch--force");
  });

  it("refuses to stash an encrypted vault that has untracked files", async () => {
    const { controller } = harness();
    const git = encryptedGit();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );

    expect(controller.model.pendingBranchSwitch).toMatchObject({
      commitAvailable: true,
      stashAvailable: false,
    });
    expect(
      controller.model.pendingBranchSwitch?.stashUnavailableReason,
    ).toContain("encryption manifest");

    const before = git.calls.length;
    await controller.runAction({ id: "branch-switch-stash" }, git);
    expect(git.calls).toHaveLength(before);
    expect(recoveryMessage(controller.model)).toContain("encryption manifest");
  });

  it("cancels a pending switch without running Git or discarding work", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction({ id: "branch-switch-cancel" }, git);

    expect(git.calls).toHaveLength(before);
    expect(controller.model.pendingBranchSwitch).toBeNull();
    expect(controller.model.resourceGroups).not.toEqual([]);
  });

  it("refuses to check anything out while the repository is conflicted", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ status: { stdout: CONFLICTED_STATUS } }),
    );
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );

    expect(git.operations).not.toContain("checkout-branch");
    expect(controller.model.pendingBranchSwitch).toBeNull();
    expect(recoveryMessage(controller.model)).toContain(
      "unresolved conflicts",
    );
    expect(recoveryMessage(controller.model)).toContain("abort");
  });

  it("keeps the work and explains where it is when a checkout still fails", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({
        "checkout-branch": {
          exitCode: 1,
          stderr: "error: your local changes would be overwritten",
        },
      }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );

    await controller.runAction(
      { id: "branch-switch-commit", values: { message: "Keep the work" } },
      git,
    );

    expect(recoveryMessage(controller.model)).toContain("committed on main");
    expect(controller.model.repository.busy).toBe(false);
  });

  /**
   * Once work has been committed or stashed on purpose, nothing that happens
   * afterwards may hide where it went. Every later failure — Git's, the host's,
   * a cancellation, and a scope change — has to carry the same sentence.
   */
  describe("preserve-work messaging", () => {
    /** Resolves the pending switch the way the caller asked for. */
    const resolvePending = async (
      controller: GitRepositoryController,
      git: FakeGit,
      how: "stash" | "commit",
    ) => {
      await controller.runAction(
        how === "stash"
          ? { id: "branch-switch-stash" }
          : {
              id: "branch-switch-commit",
              values: { message: "Keep the work" },
            },
        git,
      );
    };

    const preservedFor = (how: "stash" | "commit") =>
      how === "stash" ? "most recent stash entry" : "committed on main";

    for (const how of ["stash", "commit"] as const) {
      it(`says where the work is when the checkout is cancelled after a ${how}`, async () => {
        const { controller } = harness();
        const git = new FakeGit(
          repositoryResponder({
            "checkout-branch": { cancelled: true },
          }),
        );
        await controller.runAction({ id: "refresh" }, git);
        await controller.runAction(
          { id: "switch-branch", values: { branch: "topic" } },
          git,
        );

        await resolvePending(controller, git, how);

        const message = recoveryMessage(controller.model);
        expect(message).toContain("cancelled");
        expect(message).toContain(preservedFor(how));
        expect(controller.model.repository.busy).toBe(false);
      });

      it(`says where the work is when the host refuses the checkout after a ${how}`, async () => {
        const { controller } = harness();
        const git = new FakeGit((request) =>
          request.operation === "checkout-branch"
            ? Promise.reject(
                new Error(
                  "Git capability lease expired after a vault switch",
                ),
              )
            : repositoryResponder()(request),
        );
        await controller.runAction({ id: "refresh" }, git);
        await controller.runAction(
          { id: "switch-branch", values: { branch: "topic" } },
          git,
        );

        await resolvePending(controller, git, how);

        const message = recoveryMessage(controller.model);
        expect(message).toContain("lease expired");
        expect(message).toContain(preservedFor(how));
      });

      it(`says where the work is when a refresh fails after the checkout and a ${how}`, async () => {
        const { controller } = harness();
        let checkedOut = false;
        const git = new FakeGit((request) => {
          if (request.operation === "checkout-branch") {
            checkedOut = true;
            return {};
          }
          // Only the refresh that follows the checkout fails, so the work is
          // already on the other branch when Denote loses sight of it.
          if (checkedOut && request.operation === "status") {
            return { exitCode: 128, stderr: "fatal: unable to read the index" };
          }
          return repositoryResponder()(request);
        });
        await controller.runAction({ id: "refresh" }, git);
        await controller.runAction(
          { id: "switch-branch", values: { branch: "topic" } },
          git,
        );

        await resolvePending(controller, git, how);

        const message = recoveryMessage(controller.model);
        expect(message).toContain("unable to read the index");
        expect(message).toContain(preservedFor(how));
      });

      it(`still says where the work is when the scope changes mid-checkout after a ${how}`, async () => {
        const { controller, published } = harness();
        const git = new FakeGit((request) => {
          if (request.operation === "checkout-branch") {
            // The user opened another repository while Git was running. The
            // result is discarded, but the sentence about their work is not.
            controller.setScope(
              {
                kind: "project",
                repositoryId: "project:synthetic",
                name: "Synthetic",
              },
              true,
            );
            return {};
          }
          return repositoryResponder()(request);
        });
        await controller.runAction({ id: "refresh" }, git);
        await controller.runAction(
          { id: "switch-branch", values: { branch: "topic" } },
          git,
        );

        await resolvePending(controller, git, how);

        const message = recoveryMessage(last(published)!);
        expect(message).toContain("open repository changed");
        expect(message).toContain(preservedFor(how));
      });
    }
  });

  it("creates a branch without switching, and with switching when asked", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "create-branch", values: { name: "shelf", startPoint: "main" } },
      git,
    );
    expect(git.calls[before].request).toEqual({
      operation: "create-branch",
      scope: "vault",
      name: "shelf",
      startPoint: "main",
    });

    const switching = cleanGit();
    await controller.runAction({ id: "refresh" }, switching);
    const switchingBefore = switching.calls.length;
    await controller.runAction(
      {
        id: "create-branch",
        values: { name: "release", startPoint: "topic", checkout: true },
      },
      switching,
    );
    expect(switching.calls[switchingBefore].request).toMatchObject({
      operation: "discover",
    });
    expect(issued(switching, "create-branch")).toEqual({
      operation: "create-branch",
      scope: "vault",
      name: "release",
      startPoint: "topic",
      checkout: true,
    });
  });

  it("creates a local tracking branch for a remote branch and names collisions", async () => {
    const { controller } = harness();
    const git = cleanGit({
      "list-branches": { stdout: SYNTHETIC_BRANCHES_WITH_REMOTE },
    });
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      {
        id: "checkout-remote-branch",
        values: { remoteBranch: "origin/main", localName: "" },
      },
      git,
    );

    // "main" already exists locally, so the collision is reported rather than
    // silently reusing a branch that points somewhere else.
    expect(git.calls).toHaveLength(before);
    expect(recoveryMessage(controller.model)).toContain(
      "already has a local branch called main",
    );

    await controller.runAction(
      {
        id: "checkout-remote-branch",
        values: { remoteBranch: "origin/release", localName: "" },
      },
      git,
    );
    // The local name is proposed by dropping the remote it lives under.
    expect(issued(git, "create-branch")).toEqual({
      operation: "create-branch",
      scope: "vault",
      name: "release",
      startPoint: "origin/release",
      checkout: true,
    });
  });

  it("renames and deletes only local branches, and never the current one", async () => {
    const { controller } = harness();
    const git = cleanGit();
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "rename-branch", values: { name: "topic", newName: "topic-two" } },
      git,
    );
    expect(git.calls[before].request).toEqual({
      operation: "rename-branch",
      scope: "vault",
      name: "topic",
      newName: "topic-two",
    });

    const remoteRename = cleanGit();
    await controller.runAction({ id: "refresh" }, remoteRename);
    const remoteBefore = remoteRename.calls.length;
    await controller.runAction(
      {
        id: "rename-branch",
        values: { name: "origin/main", newName: "mirror" },
      },
      remoteRename,
    );
    expect(remoteRename.calls).toHaveLength(remoteBefore);
    expect(recoveryMessage(controller.model)).toContain("local branches");

    const deleting = cleanGit();
    await controller.runAction({ id: "refresh" }, deleting);
    const deletingBefore = deleting.calls.length;
    await controller.runAction(
      { id: "delete-branch", values: { name: "main" } },
      deleting,
    );
    expect(deleting.calls).toHaveLength(deletingBefore);
    expect(recoveryMessage(controller.model)).toContain(
      "the branch you are on",
    );

    await controller.runAction(
      { id: "delete-branch", values: { name: "topic" } },
      deleting,
    );
    expect(deleting.calls[deletingBefore].request).toEqual({
      operation: "delete-branch",
      scope: "vault",
      name: "topic",
    });
  });

  it("never checks anything out while fetching or refreshing", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());

    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction({ id: "fetch", values: { remote: "origin" } }, git);

    for (const operation of [
      "checkout-branch",
      "create-branch",
      "stash",
      "merge",
      "rebase",
    ]) {
      expect(git.operations).not.toContain(operation);
    }
  });

  it("drops a pending switch when the repository scope changes", async () => {
    const { controller, published } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "switch-branch", values: { branch: "topic" } },
      git,
    );
    expect(controller.model.pendingBranchSwitch).not.toBeNull();

    controller.setScope({
      kind: "project",
      repositoryId: "project:synthetic",
      name: "Synthetic",
    });

    expect(last(published)?.pendingBranchSwitch).toBeNull();
    const before = git.calls.length;
    await controller.runAction({ id: "branch-switch-commit" }, git);
    expect(git.calls).toHaveLength(before);
  });
});

describe("selected staging and hunks", () => {
  it("reads the working-tree diff for a changed path and parses its hunks", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );

    expect(git.calls[before].request).toEqual({
      operation: "diff",
      scope: "vault",
      target: { kind: "worktree" },
      paths: ["notes/changed.md"],
    });
    expect(controller.model.selectedView).toEqual({
      kind: "diff",
      path: "notes/changed.md",
    });
    expect(controller.model.diffFiles[0].hunks).toHaveLength(2);
    // Counts a status report cannot give are filled in from the parsed diff.
    expect(
      controller.model.resourceGroups
        .flatMap((group) => group.resources)
        .filter((resource) => resource.path === "notes/changed.md")
        .map((resource) => [resource.additions, resource.deletions]),
    ).toEqual([[2, 2]]);
  });

  it("reads the index diff for a staged path", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "staged" } },
      git,
    );

    expect(git.calls[before].request).toMatchObject({
      operation: "diff",
      target: { kind: "index" },
    });
  });

  it("refuses to open a diff for an untracked file", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "open-diff", values: { path: "notes/new.md", group: "untracked" } },
      git,
    );

    expect(git.calls).toHaveLength(before);
    expect(recoveryMessage(controller.model)).toContain("not tracked yet");
  });

  it("sends one structured hunk and refreshes the diff afterwards", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/changed.md", hunk: 1 } },
      git,
    );

    expect(git.calls[before].request).toEqual({
      operation: "stage-hunk",
      scope: "vault",
      path: "notes/changed.md",
      hunk: {
        oldStart: 7,
        oldLines: 3,
        newStart: 7,
        newLines: 3,
        lines: [
          { kind: "context", content: "seven" },
          { kind: "deletion", content: "eight" },
          { kind: "addition", content: "EIGHT" },
          { kind: "context", content: "nine" },
        ],
      },
    });
    // The diff and the status are read again, so the surface never shows a
    // hunk that has already been staged.
    expect(
      git.calls.slice(before + 1).map((call) => call.request.operation),
    ).toEqual(["status", "operation-state", "diff"]);
  });

  it("unstages a hunk from the staged diff", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "staged" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction(
      { id: "unstage-hunk", values: { path: "notes/changed.md", hunk: 0 } },
      git,
    );

    expect(git.calls[before].request).toMatchObject({
      operation: "unstage-hunk",
      path: "notes/changed.md",
    });
  });

  it("refuses both hunk directions in an encrypted vault", async () => {
    const { controller } = harness();
    // Git tracks ciphertext here, so there are no plaintext lines to choose
    // between. The host refuses this natively; the surface must not even ask.
    const git = new FakeGit(
      repositoryResponder({
        discover: {
          stdout: JSON.stringify({ initialized: true, encrypted: true }),
        },
        diff: { stdout: SYNTHETIC_DIFF },
      }),
    );
    await controller.runAction({ id: "refresh" }, git);

    for (const [group, id] of [
      ["unstaged", "stage-hunk"],
      ["staged", "unstage-hunk"],
    ] as const) {
      await controller.runAction(
        { id: "open-diff", values: { path: "notes/changed.md", group } },
        git,
      );
      const before = git.calls.length;

      await controller.runAction(
        { id, values: { path: "notes/changed.md", hunk: 0 } },
        git,
      );

      expect(git.calls).toHaveLength(before);
      expect(git.operations).not.toContain(id);
      expect(recoveryMessage(controller.model)).toContain("stages whole files");
    }
  });

  it("keeps the carriage return of a CRLF file in the hunk it sends", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: CRLF_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/changed.md", hunk: 0 } },
      git,
    );

    expect(git.calls[before].request).toMatchObject({
      operation: "stage-hunk",
      hunk: {
        lines: [
          { kind: "context", content: "one\r" },
          { kind: "deletion", content: "two\r" },
          { kind: "addition", content: "TWO\r" },
          { kind: "context", content: "three\r" },
        ],
      },
    });
  });

  it("refuses a hunk action for a path or index that is no longer open", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/other.md", hunk: 0 } },
      git,
    );
    expect(git.calls).toHaveLength(before);
    expect(recoveryMessage(controller.model)).toContain("no longer open");

    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/changed.md", hunk: 9 } },
      git,
    );
    expect(git.calls).toHaveLength(before);
    expect(recoveryMessage(controller.model)).toContain("no longer part");
  });

  it("refuses a hunk action that disagrees with the diff on screen", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "staged" } },
      git,
    );
    const before = git.calls.length;

    // The open diff is the index against the last commit, so staging forwards
    // would search the index for a block it was never meant to change.
    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/changed.md", hunk: 0 } },
      git,
    );

    expect(git.calls).toHaveLength(before);
    expect(recoveryMessage(controller.model)).toContain("unstaged diff");

    const worktree = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, worktree);
    await controller.runAction(
      {
        id: "open-diff",
        values: { path: "notes/changed.md", group: "unstaged" },
      },
      worktree,
    );
    const worktreeBefore = worktree.calls.length;
    await controller.runAction(
      { id: "unstage-hunk", values: { path: "notes/changed.md", hunk: 0 } },
      worktree,
    );
    expect(worktree.calls).toHaveLength(worktreeBefore);
    expect(recoveryMessage(controller.model)).toContain("staged diff");
  });

  it("refuses hunk actions for a rename, and offers whole-file staging instead", async () => {
    const { controller } = harness();
    const renamed = [
      "diff --git a/notes/old.md b/notes/changed.md",
      "similarity index 90%",
      "rename from notes/old.md",
      "rename to notes/changed.md",
      "--- a/notes/old.md",
      "+++ b/notes/changed.md",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "",
    ].join("\n");
    const git = new FakeGit(repositoryResponder({ diff: { stdout: renamed } }));
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/changed.md", hunk: 0 } },
      git,
    );

    expect(git.calls).toHaveLength(before);
    expect(recoveryMessage(controller.model)).toContain("whole files");
  });

  it("refuses a diff Denote will not parse rather than showing part of it", async () => {
    const { controller } = harness();
    const enormous = [
      "diff --git a/notes/changed.md b/notes/changed.md",
      "--- a/notes/changed.md",
      "+++ b/notes/changed.md",
      "@@ -1,1 +1,20001 @@",
      " one",
      ...Array.from({ length: 20001 }, (_, index) => `+line ${index}`),
    ].join("\n");
    const git = new FakeGit(repositoryResponder({ diff: { stdout: enormous } }));
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );

    expect(controller.model.diffFiles).toEqual([]);
    expect(recoveryMessage(controller.model)).toContain("larger than Denote");
  });

  it("closes the open diff without running Git", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({ diff: { stdout: SYNTHETIC_DIFF } }),
    );
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction(
      { id: "open-diff", values: { path: "notes/changed.md", group: "unstaged" } },
      git,
    );
    const before = git.calls.length;

    await controller.runAction({ id: "close-diff" }, git);

    expect(git.calls).toHaveLength(before);
    expect(controller.model.diffFiles).toEqual([]);
    expect(controller.model.selectedView).toEqual({ kind: "repository" });
  });

  it("keeps the exact whole-file stage and unstage actions", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());

    await controller.runAction(
      { id: "stage", values: { path: "notes/changed.md" } },
      git,
    );

    expect(git.calls[0].request).toEqual({
      operation: "stage",
      scope: "vault",
      paths: ["notes/changed.md"],
    });
  });

  it("keeps the last stable model when the scope changes mid-diff", async () => {
    const { controller, published } = harness();
    const git = new FakeGit(
      repositoryResponder({ status: { stdout: SYNTHETIC_STATUS } }),
    );
    await controller.runAction({ id: "refresh" }, git);

    controller.setScope({
      kind: "project",
      repositoryId: "project:synthetic",
      name: "Synthetic",
    });
    const before = git.calls.length;
    await controller.runAction(
      { id: "stage-hunk", values: { path: "notes/changed.md", hunk: 0 } },
      git,
    );

    expect(git.calls).toHaveLength(before);
    expect(last(published)?.diffFiles).toEqual([]);
  });
});
