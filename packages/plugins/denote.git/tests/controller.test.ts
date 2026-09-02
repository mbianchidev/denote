import { describe, expect, it } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import { GitRepositoryController } from "../src/controller";
import { scopeFor, statusText, vaultScope } from "../src/model";
import {
  FakeGit,
  IDLE_OPERATION_STATE,
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

  it("reads the whole repository once per refresh", async () => {
    const { controller, published } = harness();
    const git = new FakeGit(repositoryResponder());

    await controller.runAction({ id: "refresh" }, git);

    expect(git.operations).toEqual(REFRESH_SEQUENCE);
    expect(git.request("list-history")).toEqual({
      operation: "list-history",
      scope: "vault",
      maxCount: 20,
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
    expect(unstageGit.operations.slice(1)).toEqual(REFRESH_SEQUENCE);
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

  it("changes only the view for tab and commit selection", async () => {
    const { controller } = harness();
    const git = new FakeGit(repositoryResponder());
    await controller.runAction({ id: "refresh" }, git);
    const before = git.calls.length;

    await controller.runAction(
      { id: "select-tab", values: { tab: "history" } },
      git,
    );
    expect(controller.model.selectedTab).toBe("history");
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
    expect(git.calls).toHaveLength(before);

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

    await controller.runAction({ id: "push" }, git);
    expect(git.calls).toHaveLength(operations);
    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "unsupported-push",
      dismissActionId: "dismiss",
    });
    expect(
      controller.model.recovery.state === "failed"
        ? controller.model.recovery.message
        : "",
    ).toContain("push to a remote");
    expect(controller.model.repository.branch).toBe("main");

    await controller.runAction({ id: "dismiss" }, git);
    expect(controller.model.recovery).toEqual({ state: "idle" });
  });

  it("reports an interrupted merge without offering an action it cannot run", async () => {
    const { controller } = harness();
    const git = new FakeGit(
      repositoryResponder({
        "operation-state": {
          stdout: JSON.stringify({
            ...JSON.parse(IDLE_OPERATION_STATE),
            mergeInProgress: true,
          }),
        },
        status: { stdout: SYNTHETIC_STATUS },
      }),
    );

    await controller.runAction({ id: "refresh" }, git);

    expect(controller.model.recovery).toMatchObject({
      state: "failed",
      operationId: "operation-state-merge",
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
