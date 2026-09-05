import { describe, expect, it } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import { GitRepositoryController } from "../src/controller";
import { scopeFor, statusText, vaultScope } from "../src/model";
import {
  FakeGit,
  IDLE_OPERATION_STATE,
  SYNTHETIC_REPOSITORY,
  SYNTHETIC_STATUS,
  deferred,
  last,
  repositoryResponder,
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

const REFRESH_SEQUENCE = [
  "discover",
  "status",
  "list-branches",
  "list-remotes",
  "operation-state",
  "list-history",
];
const WORKTREE_REFRESH_SEQUENCE = ["status", "operation-state"];

describe("GitRepositoryController", () => {
  it("starts by asking for a refresh instead of describing a repository", () => {
    const { controller } = harness();

    expect(controller.model.repository.label).toBe("Vault · refresh required");
    expect(controller.model.repository.initialized).toBe(false);
    expect(controller.model.repository.busy).toBe(false);
    expect(controller.model.recovery).toEqual({ state: "idle" });
    expect(controller.model.selectedTab).toBe("changes");
    expect(statusText(controller.model)).toBe("Git: refresh required");
  });

  it("selects and targets a host-issued repository identity", async () => {
    const published: PluginSourceControlViewModel[] = [];
    const controller = new GitRepositoryController(
      vaultScope(),
      {
        publish: (model) => published.push(model),
        readSettings: () => Promise.resolve({}),
        report: () => {},
      },
      [
        vaultScope(),
        {
          kind: "project",
          repositoryId: "project:synthetic-project",
          projectId: "synthetic-project",
          name: "Synthetic project",
        },
      ],
    );
    const git = new FakeGit(repositoryResponder());

    await controller.runAction(
      {
        id: "select-workspace-repository",
        values: { repositoryId: "project:synthetic-project" },
      },
      git,
    );

    expect(controller.model.repository.repositoryId).toBe(
      "project:synthetic-project",
    );
    expect(controller.model.workspaceRepositories).toEqual([
      expect.objectContaining({ repositoryId: "vault", selected: false }),
      expect.objectContaining({
        repositoryId: "project:synthetic-project",
        selected: true,
        branch: "main",
      }),
    ]);
    expect(git.calls[0]).toMatchObject({
      request: { operation: "discover", scope: "project" },
      target: { projectId: "synthetic-project" },
    });
    expect(published[published.length - 1]?.repository.branch).toBe("main");
  });

  it("reads the whole repository once per refresh", async () => {
    const { controller, published } = harness();
    const git = new FakeGit(repositoryResponder());

    await controller.runAction({ id: "refresh" }, git);

    expect(git.operations).toEqual(REFRESH_SEQUENCE);
    expect(git.request("list-history")).toEqual({
      operation: "list-history",
      scope: "vault",
      // One commit beyond the page is read, and never shown, so the surface
      // can say whether an older page exists without counting the whole log.
      maxCount: 21,
    });
    const model = controller.model;
    expect(model.repository).toMatchObject({
      repositoryId: "vault",
      label: "Vault",
      initialized: true,
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      busy: false,
    });
    expect(model.repository.latestCommit).toEqual({
      id: "1111111111111111111111111111111111111111",
      shortId: "1111111",
      // Tabs in a subject and in an author name survive the NUL delimited
      // report intact instead of shifting the fields around them.
      summary: "Record\ta synthetic note",
      authorName: "Synthetic\tAuthor",
      authoredAt: "2026-01-01T00:00:00+00:00",
    });
    expect(model.resourceGroups.map((group) => group.kind)).toEqual([
      "staged",
      "unstaged",
      "untracked",
    ]);
    expect(model.branches.map((branch) => branch.name)).toEqual([
      "main",
      "topic",
    ]);
    expect(model.remotes.map((remote) => remote.name)).toEqual(["origin"]);
    expect(model.history).toHaveLength(2);
    expect(model.recovery).toEqual({ state: "idle" });
    expect(statusText(model)).toBe("Git: main · 3 changes");
    // Every intermediate progress model names the operation the host can cancel.
    const busyModels = published.filter((entry) => entry.repository.busy);
    expect(busyModels).toHaveLength(REFRESH_SEQUENCE.length);
    for (const entry of busyModels) {
      expect(entry.repository.activeOperationId).toMatch(/^operation-\d+$/);
      expect(entry.repository.busyMessage).toBeTruthy();
    }
    expect(controller.model.repository.activeOperationId).toBeUndefined();
  });

  it("stops after discovery when the scope is not a repository", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({
        discover: { stdout: JSON.stringify({ initialized: false }) },
      }),
    );

    await controller.runAction({ id: "refresh" }, git);

    expect(git.operations).toEqual(["discover"]);
    expect(controller.model.repository).toMatchObject({
      label: "Vault",
      initialized: false,
    });
    expect(statusText(controller.model)).toBe("Git: no repository");
  });

  it("initializes with the configured default branch only on the user action", async () => {
    const { controller } = harness({ defaultBranch: "trunk" });
    let initialized = false;
    const git = new FakeGit((request) => {
      if (request.operation === "initialize") {
        initialized = true;
        return {};
      }
      if (request.operation === "discover") {
        return { stdout: JSON.stringify({ initialized }) };
      }
      return repositoryResponder()(request);
    });

    await controller.runAction({ id: "initialize" }, git);

    expect(git.request("initialize")).toEqual({
      operation: "initialize",
      scope: "vault",
      defaultBranch: "trunk",
    });
    expect(controller.model.repository.initialized).toBe(true);
  });

  it("refreshes instead of re-initializing an existing repository", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());

    await controller.runAction({ id: "initialize" }, git);

    expect(git.operations).not.toContain("initialize");
    expect(controller.model.repository.initialized).toBe(true);
  });

  it("stages and unstages the exact path and then refreshes", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());

    await controller.runAction(
      { id: "stage", values: { path: "notes/new.md" } },
      git,
    );
    expect(git.calls[0].request).toEqual({
      operation: "stage",
      scope: "vault",
      paths: ["notes/new.md"],
    });

    const unstageGit = new FakeGit(repositoryResponder());
    await controller.runAction(
      { id: "unstage", values: { path: "notes/staged.md" } },
      unstageGit,
    );
    expect(unstageGit.calls[0].request).toEqual({
      operation: "unstage",
      scope: "vault",
      paths: ["notes/staged.md"],
    });
    expect(unstageGit.operations.slice(1)).toEqual(WORKTREE_REFRESH_SEQUENCE);
    expect(unstageGit.operations).not.toContain("list-history");
    expect(unstageGit.operations).not.toContain("list-branches");
    expect(unstageGit.operations).not.toContain("list-remotes");
  });

  it("stages and unstages every eligible change in one action", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "stage-all" }, git);
    await controller.runAction({ id: "unstage-all" }, git);

    const stage = [...git.calls]
      .reverse()
      .find((call) => call.request.operation === "stage")?.request;
    const unstage = [...git.calls]
      .reverse()
      .find((call) => call.request.operation === "unstage")?.request;
    expect(stage).toEqual({
      operation: "stage",
      scope: "vault",
      paths: ["notes/changed.md", "notes/new.md"],
    });

    expect(unstage).toEqual({
      operation: "unstage",
      scope: "vault",
      paths: ["notes/staged.md"],
    });
  });

  it("restores a tracked file from the current upstream branch", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      {
        id: "restore-from-upstream",
        values: { path: "notes/changed.md" },
      },
      git,
    );

    expect(git.request("restore-from-upstream")).toEqual({
      operation: "restore-from-upstream",
      scope: "vault",
      paths: ["notes/changed.md"],
    });
  });

  it("restores all tracked changes without deleting untracked files", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "restore-all-from-upstream" }, git);

    expect(git.request("restore-from-upstream")).toEqual({
      operation: "restore-from-upstream",
      scope: "vault",
      paths: ["notes/staged.md", "notes/changed.md"],
    });
  });

  it("commits staged changes with the configured identity", async () => {
    const { controller } = harness({
      authorName: "Synthetic Author",
      authorEmail: "author@example.invalid",
    });

    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "commit", values: { message: "  Record a synthetic note  " } },
      git,
    );

    expect(git.request("commit")).toEqual({
      operation: "commit",
      scope: "vault",
      message: "Record a synthetic note",
      authorName: "Synthetic Author",
      authorEmail: "author@example.invalid",
    });
  });

  it("omits the identity when it is not fully configured", async () => {
    const { controller } = harness({ authorName: "Synthetic Author" });
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "commit", values: { message: "Record a synthetic note" } },
      git,
    );

    expect(git.request("commit")).toEqual({
      operation: "commit",
      scope: "vault",
      message: "Record a synthetic note",
    });
  });

  it("refuses a commit without a message or without staged changes", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "commit", values: { message: "  " } }, git);
    expect(git.operations).not.toContain("commit");
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: "A commit needs a message.",
      dismissActionId: "dismiss",
    });

    const empty = new FakeGit(
      repositoryResponder({
        status: { stdout: "# branch.head main\0" },
      }),
    );
    await controller.runAction({ id: "refresh" }, empty);
    await controller.runAction(
      { id: "commit", values: { message: "Record nothing" } },
      empty,
    );
    expect(empty.operations).not.toContain("commit");
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      message: expect.stringContaining("Stage at least one change"),
    });
  });

  it("exposes the running operation and reports a visible, recoverable cancellation", async () => {
    const { controller, published } = harness();
    const pending = deferred<{ cancelled: boolean; exitCode: number }>();
    const git = new FakeGit((request) =>
      request.operation === "discover"
        ? pending.promise
        : repositoryResponder()(request),
    );

    const running = controller.runAction({ id: "refresh" }, git);
    await Promise.resolve();
    const busy = last(published);
    expect(busy?.repository.busy).toBe(true);
    expect(busy?.repository.activeOperationId).toBe("operation-1");

    await controller.runAction(
      { id: "cancel-operation", values: { operationId: "operation-1" } },
      git,
    );
    expect(git.cancelled).toEqual(["operation-1"]);

    pending.resolve({ cancelled: true, exitCode: -1 });
    await running;

    expect(controller.model.repository.busy).toBe(false);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "operation-1",
      retryActionId: "refresh",
      dismissActionId: "dismiss",
    });
    expect(
      controller.model.recovery.state === "failed"
        ? controller.model.recovery.message
        : "",
    ).toContain("cancelled");
  });

  it("cancels the operation Git is actually running, not the one the surface named", async () => {
    const { controller } = harness();
    const statusStarted = deferred<void>();
    const statusResult = deferred<{ cancelled: boolean; exitCode: number }>();
    const git = new FakeGit((request) => {
      if (request.operation === "status") {
        statusStarted.resolve();
        return statusResult.promise;
      }
      return repositoryResponder()(request);
    });

    const running = controller.runAction({ id: "refresh" }, git);
    await statusStarted.promise;
    expect(controller.model.repository.activeOperationId).toBe("operation-2");

    // The surface still holds the ID of the discovery step, which finished
    // while the user was reaching for the button.
    await controller.runAction(
      { id: "cancel-operation", values: { operationId: "operation-1" } },
      git,
    );
    expect(git.cancelled).toEqual(["operation-2"]);

    statusResult.resolve({ cancelled: true, exitCode: -1 });
    await running;
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "operation-2",
    });
  });

  it("says so when nothing matched the operation it was asked to cancel", async () => {
    const { controller, reports } = harness();
    await controller.runAction(
      { id: "refresh" },
      new FakeGit(repositoryResponder()),
    );
    const stable = controller.model;
    // The host reports that no operation matched, which is what happens when
    // the operation finished between the render and the click.
    const git = new FakeGit(repositoryResponder(), () => ({ cancelled: false }));

    await controller.runAction(
      { id: "cancel-operation", values: { operationId: "operation-9" } },
      git,
    );

    expect(git.cancelled).toEqual(["operation-9"]);
    expect(reports).toContain("A Git operation could not be cancelled.");
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "operation-9",
      retryActionId: "refresh",
      dismissActionId: "dismiss",
    });
    expect(
      controller.model.recovery.state === "failed"
        ? controller.model.recovery.message
        : "",
    ).toContain("no longer running");
    // The feedback replaces nothing the last refresh established.
    expect(controller.model.repository).toMatchObject({
      branch: "main",
      initialized: true,
      busy: false,
    });
    expect(controller.model.resourceGroups).toEqual(stable.resourceGroups);
  });

  it("forgets the operation ID once its own operation settles", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder(), () => ({
      cancelled: false,
    }));
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "cancel-operation", values: { operationId: "operation-3" } },
      git,
    );

    // Nothing is running, so the payload is all the controller has left to go
    // on: no finished operation ID is held over to be cancelled later.
    expect(git.cancelled).toEqual(["operation-3"]);
  });

  it("resets on a forced scope change and refuses the interrupted work", async () => {
    const { controller, published } = harness();
    const pending = deferred<{ stdout: string }>();
    const git = new FakeGit((request) =>
      request.operation === "discover"
        ? pending.promise
        : repositoryResponder()(request),
    );
    await controller.runAction(
      { id: "refresh" },
      new FakeGit(repositoryResponder()),
    );
    expect(controller.model.repository).toMatchObject({
      repositoryId: "vault",
      branch: "main",
      initialized: true,
    });

    const running = controller.runAction({ id: "refresh" }, git);
    await Promise.resolve();
    // Another vault reaches the same vault-scoped identity, so only the forced
    // reset can tell the two apart.
    controller.setScope(vaultScope(), true);
    const publishedAfterSwitch = published.length;

    expect(controller.model.repository).toMatchObject({
      repositoryId: "vault",
      label: "Vault · refresh required",
      initialized: false,
      branch: null,
      busy: false,
    });
    expect(controller.model.resourceGroups).toEqual([]);
    expect(controller.model.history).toEqual([]);
    expect(controller.model.branches).toEqual([]);

    pending.resolve({ stdout: JSON.stringify({ initialized: true }) });
    await running;

    // The interrupted sequence neither continues nor publishes into the vault
    // it no longer describes.
    expect(published).toHaveLength(publishedAfterSwitch);
    expect(git.operations).toEqual(["discover"]);
    expect(controller.model.repository.initialized).toBe(false);
  });

  it("ignores a repeated scope that was not forced", async () => {
    const { controller, published } = harness();
    await controller.runAction(
      { id: "refresh" },
      new FakeGit(repositoryResponder()),
    );
    const settled = published.length;

    controller.setScope(vaultScope());

    expect(published).toHaveLength(settled);
    expect(controller.model.repository).toMatchObject({
      branch: "main",
      initialized: true,
    });
  });

  it("cuts a long multi-byte diagnostic on a whole character", async () => {
    const { controller } = harness();
    // Every character is a surrogate pair, so a UTF-16 cut at 200 units would
    // land inside one and leave a lone surrogate in the message.
    const detail = "\u{1f5c2}".repeat(300);
    const failing = new FakeGit(
      repositoryResponder({ discover: { exitCode: 128, stderr: detail } }),
    );

    await controller.runAction({ id: "refresh" }, failing);

    const message = (
      controller.model.recovery as { message: string }
    ).message;
    expect(message).toContain("…");
    const reported = message.slice(message.indexOf("\u{1f5c2}"), -1);
    expect(Array.from(reported)).toHaveLength(200);
    expect(reported.split("\u{1f5c2}").join("")).toBe("");
  });

  it("keeps the last stable model when a Git command fails", async () => {
    const { controller } = harness();
    await controller.runAction({ id: "refresh" }, new FakeGit(repositoryResponder()));
    const stable = controller.model;

    const failing = new FakeGit(
      repositoryResponder({
        status: {
          exitCode: 128,
          stderr: "fatal: synthetic failure\nsecond line",
        },
      }),
    );
    await controller.runAction({ id: "refresh" }, failing);

    expect(controller.model.repository).toMatchObject({
      branch: "main",
      initialized: true,
      busy: false,
    });
    expect(controller.model.resourceGroups).toEqual(stable.resourceGroups);
    expect(controller.model.recovery).toEqual({
      state: "failed",
      operationId: "status-failure",
      message:
        "Git status failed with exit code 128. fatal: synthetic failure",
      retryActionId: "refresh",
      dismissActionId: "dismiss",
    });
  });

  it("discards a result that arrives after the project scope changed", async () => {
    const { controller, published } = harness();
    const pending = deferred<{ stdout: string }>();
    const git = new FakeGit((request) =>
      request.operation === "discover"
        ? pending.promise
        : repositoryResponder()(request),
    );

    const running = controller.runAction({ id: "refresh" }, git);
    await Promise.resolve();
    controller.setScope(
      scopeFor({ projectId: "project-1", rootPath: "/synthetic/vault/alpha" }),
    );
    const publishedAfterSwitch = published.length;

    pending.resolve({ stdout: JSON.stringify({ initialized: true }) });
    await running;

    expect(published).toHaveLength(publishedAfterSwitch);
    // The rest of the sequence never runs against the repository just left.
    expect(git.operations).toEqual(["discover"]);
    expect(controller.repositoryId).toBe("project:project-1");
    expect(controller.model.repository.label).toBe("alpha · refresh required");
    expect(controller.model.repository.initialized).toBe(false);
  });

  it("runs actions again after a scope change interrupted one", async () => {
    const { controller } = harness();
    const pending = deferred<{ stdout: string }>();
    const stalled = new FakeGit(() => pending.promise);
    const running = controller.runAction({ id: "refresh" }, stalled);
    await Promise.resolve();
    controller.setScope(
      scopeFor({ projectId: "project-2", rootPath: "/synthetic/vault/beta" }),
    );

    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    pending.resolve({ stdout: "" });
    await running;

    expect(git.operations).toEqual(REFRESH_SEQUENCE);
    expect(git.calls.every((call) => call.request.scope === "project")).toBe(
      true,
    );
    expect(controller.model.repository.label).toBe("beta");
  });

  it("ignores a second action while Git is already running", async () => {
    const { controller, reports } = harness();
    const pending = deferred<{ stdout: string }>();
    const git = new FakeGit((request) =>
      request.operation === "discover"
        ? pending.promise
        : repositoryResponder()(request),
    );

    const running = controller.runAction({ id: "refresh" }, git);
    await Promise.resolve();
    await controller.runAction({ id: "refresh" }, git);
    expect(git.operations).toEqual(["discover"]);
    expect(reports).toContain(
      "Ignored an action while Git was already running.",
    );

    pending.resolve({ stdout: JSON.stringify({ initialized: false }) });
    await running;
  });

  it("changes only the view for tab selection, and reads Git for a commit", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "select-tab", values: { tab: "history" } },
      git,
    );
    expect(controller.model.selectedTab).toBe("history");
    // Selecting a tab is a view change only: it never runs Git.
    expect(git.calls).toHaveLength(before);

    await controller.runAction(
      {
        id: "open-commit",
        values: { commitId: "1111111111111111111111111111111111111111" },
      },
      git,
    );
    expect(controller.model.selectedView).toEqual({
      kind: "commit",
      commitId: "1111111111111111111111111111111111111111",
    });
    // A commit's own diff is read for it, because a commit that shows nothing
    // would be a heading with no content.
    expect(git.calls).toHaveLength(before + 1);

    // A refresh keeps a selection whose data still exists.
    await controller.runAction({ id: "refresh" }, new FakeGit(repositoryResponder()));
    expect(controller.model.selectedView).toEqual({
      kind: "commit",
      commitId: "1111111111111111111111111111111111111111",
    });

    await controller.runAction(
      { id: "refresh" },
      new FakeGit(repositoryResponder({ "list-history": { stdout: "" } })),
    );
    expect(controller.model.selectedTab).toBe("history");
    expect(controller.model.selectedView).toEqual({ kind: "history" });
    expect(controller.model.commitDetail).toBeNull();
  });

  it("keeps progress visible when the tab changes mid-operation", async () => {
    const { controller, published } = harness();
    const pending = deferred<{ exitCode: number; stderr: string }>();
    const git = new FakeGit((request) =>
      request.operation === "discover"
        ? pending.promise
        : repositoryResponder()(request),
    );

    const running = controller.runAction({ id: "refresh" }, git);
    await Promise.resolve();
    await controller.runAction(
      { id: "select-tab", values: { tab: "branches" } },
      git,
    );
    expect(last(published)?.repository).toMatchObject({
      busy: true,
      activeOperationId: "operation-1",
    });
    expect(last(published)?.selectedTab).toBe("branches");

    pending.resolve({ exitCode: 128, stderr: "fatal: synthetic failure" });
    await running;

    // A busy model is never the fallback a failure restores.
    expect(controller.model.repository.busy).toBe(false);
    expect(controller.model.repository.activeOperationId).toBeUndefined();
    expect(controller.model.recovery).toMatchObject({ state: "failed" });
  });

  it("reports unimplemented actions instead of failing silently", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    const operations = git.calls.length;

    await controller.runAction({ id: "rewrite-everything" }, git);
    expect(git.calls).toHaveLength(operations);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "unsupported-rewrite-everything",
      dismissActionId: "dismiss",
    });
    expect(
      controller.model.recovery.state === "failed"
        ? controller.model.recovery.message
        : "",
    ).toContain("rewrite-everything");
    expect(controller.model.repository.branch).toBe("main");

    await controller.runAction({ id: "dismiss" }, git);
    expect(controller.model.recovery).toEqual({ state: "idle" });
  });

  it("reports a state it cannot run without offering an action for it", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({
        "operation-state": {
          stdout: JSON.stringify({
            ...JSON.parse(IDLE_OPERATION_STATE),
            bisectInProgress: true,
          }),
        },
        status: { stdout: SYNTHETIC_STATUS },
      }),
    );

    await controller.runAction({ id: "refresh" }, git);

    // Denote runs no bisect, so it is reported rather than offered as an
    // action, and no operation controls are published for it.
    expect(controller.model.operationProgress).toBeNull();
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "operation-state-bisect",
      retryActionId: "refresh",
    });
  });

  it("explains a missing Git permission instead of throwing", async () => {
    const { controller } = harness();

    await controller.runAction({ id: "refresh" }, undefined);

    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "missing-git-permission",
    });
  });
});

describe("GitRepositoryController remotes and cloning", () => {
  it("fetches explicitly with the configured authentication mode", async () => {
    const { controller } = harness({ authenticationMode: "ssh-agent" });
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "fetch", values: { remote: "origin" } },
      git,
    );

    expect(git.request("fetch")).toEqual({
      operation: "fetch",
      scope: "vault",
      remote: "origin",
      prune: true,
      authMode: "ssh-agent",
    });
    // The model is re-read after the operation, so nothing on screen predates
    // the fetch.
    expect(git.operations.slice(-6)).toEqual(REFRESH_SEQUENCE);
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Fetch",
      outcome: "succeeded",
    });
  });

  it("pulls and pushes exactly the remote and branch it was given", async () => {
    const { controller } = harness({ pullStrategy: "merge" });
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "pull", values: { remote: "origin", branch: "main" } },
      git,
    );
    await controller.runAction(
      { id: "push", values: { remote: "origin", branch: "main" } },
      git,
    );

    expect(git.request("pull")).toEqual({
      operation: "pull",
      scope: "vault",
      remote: "origin",
      branch: "main",
      strategy: "merge",
      authMode: "system",
    });
    expect(git.request("push")).toEqual({
      operation: "push",
      scope: "vault",
      remote: "origin",
      branch: "main",
      // The synthetic repository already tracks origin/main, so nothing new is
      // recorded.
      setUpstream: false,
      mode: "normal",
      authMode: "system",
    });
  });

  it("records an upstream on the first push of an untracked branch", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({
        status: {
          stdout: [
            "# branch.oid 1111111111111111111111111111111111111111",
            "# branch.head topic",
          ].join("\0"),
        },
      }),
    );
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "push", values: { remote: "origin", branch: "topic" } },
      git,
    );

    expect(git.request("push")).toMatchObject({ setUpstream: true });
  });

  it("never asks for a force push", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      { id: "push", values: { remote: "origin", branch: "main" } },
      git,
    );

    expect(git.request("push")).toMatchObject({ mode: "normal" });
  });

  it("refuses a remote operation that names no remote", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    const operations = git.calls.length;

    await controller.runAction({ id: "fetch" }, git);

    expect(git.calls).toHaveLength(operations);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "action-refused",
    });
    // The last stable repository state is still on screen.
    expect(controller.model.repository.branch).toBe("main");
  });

  it("adds, changes, and removes a remote and re-reads the repository", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction(
      {
        id: "add-remote",
        values: { name: "backup", url: "https://example.invalid/backup.git" },
      },
      git,
    );
    await controller.runAction(
      {
        id: "set-remote-url",
        values: { name: "backup", url: "https://example.invalid/moved.git" },
      },
      git,
    );
    await controller.runAction(
      { id: "remove-remote", values: { name: "backup" } },
      git,
    );

    expect(git.request("add-remote")).toEqual({
      operation: "add-remote",
      scope: "vault",
      name: "backup",
      url: "https://example.invalid/backup.git",
    });
    expect(git.request("set-remote-url")).toEqual({
      operation: "set-remote-url",
      scope: "vault",
      name: "backup",
      url: "https://example.invalid/moved.git",
    });
    expect(git.request("remove-remote")).toEqual({
      operation: "remove-remote",
      scope: "vault",
      name: "backup",
    });
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Remove remote",
      outcome: "succeeded",
    });
  });

  it("keeps the last stable model when a remote operation fails", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({
        fetch: { exitCode: 128, stderr: "fatal: could not read from remote" },
      }),
    );
    await controller.runAction({ id: "refresh" }, git);
    const stable = controller.model;

    await controller.runAction(
      { id: "fetch", values: { remote: "origin" } },
      git,
    );

    expect(controller.model.repository.branch).toBe(stable.repository.branch);
    expect(controller.model.repository.busy).toBe(false);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "fetch-failure",
      retryActionId: "refresh",
    });
  });

  it("browses GitHub only after GitHub sign-in is selected", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder(), undefined, {
      repositories: [SYNTHETIC_REPOSITORY],
    });
    await controller.runAction({ id: "refresh" }, git);

    await controller.runAction({ id: "browse-github" }, git);
    expect(git.listed).toHaveLength(0);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "action-refused",
    });

    const authenticated = harness({ authenticationMode: "github-https" });
    const authenticatedGit = new FakeGit(repositoryResponder(), undefined, {
      repositories: [SYNTHETIC_REPOSITORY],
    });
    await authenticated.controller.runAction({ id: "refresh" }, authenticatedGit);

    await authenticated.controller.runAction(
      { id: "browse-github" },
      authenticatedGit,
    );

    expect(authenticatedGit.listed).toEqual([{ limit: 50 }]);
    expect(authenticated.controller.model.remoteAccess.repositories).toEqual([
      SYNTHETIC_REPOSITORY,
    ]);
    expect(authenticated.controller.model.repository.busy).toBe(false);
  });

  it("clones with the configured authentication and reports the opened vault", async () => {
    const { controller, reports } = harness({
      authenticationMode: "github-https",
    });
    const git = new FakeGit(repositoryResponder(), undefined, {
      clone: {
        status: "cloned",
        label: "synthetic-notes",
        remoteUrl: "https://github.com/synthetic-owner/synthetic-notes.git",
        branch: "main",
        defaultBranch: "main",
        upstream: "origin/main",
      },
    });

    await controller.runAction(
      {
        id: "clone",
        values: {
          url: "https://github.com/synthetic-owner/synthetic-notes.git",
          branch: "main",
        },
      },
      git,
    );

    expect(git.clones).toEqual([
      {
        url: "https://github.com/synthetic-owner/synthetic-notes.git",
        authMode: "github-https",
        branch: "main",
      },
    ]);
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Clone",
      outcome: "succeeded",
    });
    expect(controller.model.remoteAccess.cleanup).toBeNull();
    expect(reports).toContain("Cloned a repository.");
  });

  it("treats a cancelled folder chooser as an ordinary answer", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder(), undefined, {
      clone: { status: "cancelled" },
    });

    await controller.runAction(
      { id: "clone", values: { url: "https://example.invalid/repo.git" } },
      git,
    );

    expect(controller.model.remoteAccess.review).toMatchObject({
      outcome: "cancelled",
    });
    expect(controller.model.recovery).toEqual({ state: "idle" });
    expect(controller.model.remoteAccess.cleanup).toBeNull();
  });

  it("keeps a failed clone recoverable behind an explicit clean-up", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder(), undefined, {
      clone: {
        status: "failed",
        message: "Git could not clone this repository.",
        cleanupToken: "synthetic-cleanup-token",
      },
    });

    await controller.runAction(
      { id: "clone", values: { url: "https://example.invalid/repo.git" } },
      git,
    );

    expect(controller.model.remoteAccess.cleanup).toEqual({
      token: "synthetic-cleanup-token",
      label: "the folder you chose",
    });
    // Nothing is deleted on its own.
    expect(git.cleanups).toHaveLength(0);

    await controller.runAction(
      {
        id: "clean-failed-clone",
        values: { token: "synthetic-cleanup-token" },
      },
      git,
    );

    expect(git.cleanups).toEqual(["synthetic-cleanup-token"]);
    // A spent token is never offered again.
    expect(controller.model.remoteAccess.cleanup).toBeNull();
    expect(controller.model.remoteAccess.review).toMatchObject({
      operation: "Clean incomplete clone",
      outcome: "succeeded",
    });
  });

  it("carries the configured authentication mode and clean-up token across a scope change", async () => {
    const { controller } = harness({ authenticationMode: "ssh-agent" });
    const git = new FakeGit(repositoryResponder(), undefined, {
      clone: {
        status: "failed",
        message: "Git could not clone this repository.",
        cleanupToken: "synthetic-cleanup-token",
      },
    });
    await controller.syncRemoteAccess();
    await controller.runAction(
      { id: "clone", values: { url: "https://example.invalid/repo.git" } },
      git,
    );

    controller.setScope(
      scopeFor({ projectId: "synthetic-project", rootPath: "/synthetic/project" }),
    );
    await settle();

    expect(controller.model.remoteAccess.authMode).toBe("ssh-agent");
    expect(controller.model.remoteAccess.cleanup?.token).toBe(
      "synthetic-cleanup-token",
    );
    // Everything read from the previous repository is gone.
    expect(controller.model.repository.branch).toBeNull();
    expect(controller.model.remotes).toEqual([]);
  });

  it("shows the configured authentication mode and offers no action that changes it", async () => {
    const settings: Record<string, unknown> = {
      authenticationMode: "github-https",
    };
    const { controller, published } = harness(settings);
    const git = new FakeGit(repositoryResponder(), undefined, {
      repositories: [SYNTHETIC_REPOSITORY],
    });
    await controller.syncRemoteAccess();

    expect(controller.model.remoteAccess.authMode).toBe("github-https");
    expect(controller.model.remoteAccess.githubAvailable).toBe(true);

    // The mode is host-persisted, so there is no action that can change it and
    // an attempt to reach the deleted one is refused like any other unknown
    // action instead of quietly rewriting the mode.
    const before = published.length;
    await controller.runAction(
      { id: "set-auth-mode", values: { authMode: "public" } },
      git,
    );

    expect(controller.model.remoteAccess.authMode).toBe("github-https");
    expect(published.length).toBe(before + 1);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "unsupported-set-auth-mode",
    });
  });

  it("re-reads the configured mode and drops a stale listing when settings change", async () => {
    const settings: Record<string, unknown> = {
      authenticationMode: "github-https",
    };
    const { controller } = harness(settings);
    const git = new FakeGit(repositoryResponder(), undefined, {
      repositories: [SYNTHETIC_REPOSITORY],
    });
    await controller.syncRemoteAccess();
    await controller.runAction({ id: "refresh" }, git);
    await controller.runAction({ id: "browse-github" }, git);
    expect(controller.model.remoteAccess.repositories).toHaveLength(1);

    // Settings are changed outside the plugin, exactly as the host does it.
    settings.authenticationMode = "public";
    controller.setScope(
      scopeFor({ projectId: "synthetic-project", rootPath: "/synthetic/project" }),
    );
    await settle();

    expect(controller.model.remoteAccess.authMode).toBe("public");
    expect(controller.model.remoteAccess.repositories).toEqual([]);
    expect(controller.model.remoteAccess.githubAvailable).toBe(false);
  });

  it("refuses a GitHub browse when the configured mode is not GitHub sign-in", async () => {
    const { controller } = harness({ authenticationMode: "ssh-agent" });
    const git = new FakeGit(repositoryResponder(), undefined, {
      repositories: [SYNTHETIC_REPOSITORY],
    });
    await controller.syncRemoteAccess();

    await controller.runAction({ id: "browse-github" }, git);

    expect(git.listed).toHaveLength(0);
    expect(controller.model.recovery).toMatchObject({ state: "failed" });
  });

  it("publishes the host operation ID for a clone and a browse so Cancel reaches them", async () => {
    const settings = { authenticationMode: "github-https" };
    const { controller, published } = harness(settings);
    const pendingClone = deferred<{ status: "cancelled" }>();
    const pendingList = deferred<typeof SYNTHETIC_REPOSITORY[]>();
    const git = new FakeGit(repositoryResponder(), undefined, {
      clonePending: pendingClone.promise,
      listPending: pendingList.promise,
    });
    await controller.syncRemoteAccess();

    const cloning = controller.runAction(
      { id: "clone", values: { url: "https://example.invalid/repo.git" } },
      git,
    );
    await settle();
    const cloneBusy = last(published);
    expect(cloneBusy?.repository.busy).toBe(true);
    expect(cloneBusy?.repository.activeOperationId).toBe(
      git.cloneOperationIds[0],
    );
    pendingClone.resolve({ status: "cancelled" });
    await cloning;

    const browsing = controller.runAction({ id: "browse-github" }, git);
    await settle();
    const browseBusy = last(published);
    expect(browseBusy?.repository.busy).toBe(true);
    expect(browseBusy?.repository.activeOperationId).toBe(
      git.listOperationIds[0],
    );
    pendingList.resolve([]);
    await browsing;
  });

  it("cancels the clone that is running rather than a stale identifier", async () => {
    const { controller } = harness();
    const pendingClone = deferred<{ status: "cancelled" }>();
    const git = new FakeGit(repositoryResponder(), undefined, {
      clonePending: pendingClone.promise,
    });

    const cloning = controller.runAction(
      { id: "clone", values: { url: "https://example.invalid/repo.git" } },
      git,
    );
    await settle();
    await controller.runAction(
      { id: "cancel-operation", values: { operationId: "" } },
      git,
    );

    expect(git.cancelled).toEqual([git.cloneOperationIds[0]]);
    pendingClone.resolve({ status: "cancelled" });
    await cloning;
  });
});

/** Lets already-resolved host promises settle before the model is read. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
