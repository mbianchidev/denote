import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import { SourceControlPanel } from "./SourceControlPanel";

describe("SourceControlPanel", () => {
  it("renders typed changes, conflicts, diffs, and standardized action payloads", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={changesModel()}
        onAction={onAction}
      />,
    );

    expect(screen.getByRole("heading", { name: "Synthetic repository" })).toBeInTheDocument();
    expect(screen.getByLabelText("Branch")).toHaveValue("main");
    expect(
      screen.getByText(/This is a binary conflict/),
    ).toBeInTheDocument();
    // A conflict is selected, not a diff, so no diff content is shown.
    expect(screen.queryByText("@@ -1,1 +1,1 @@")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await user.click(screen.getByRole("button", { name: "Pull" }));
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(onAction).toHaveBeenCalledWith({ id: "refresh" });
    expect(onAction).toHaveBeenCalledWith({
      id: "fetch",
      values: { remote: "origin" },
    });
    expect(onAction).toHaveBeenCalledWith({
      id: "pull",
      values: { remote: "origin", branch: "main" },
    });
    expect(onAction).toHaveBeenCalledWith({
      id: "push",
      values: { remote: "origin", branch: "main" },
    });

    await user.selectOptions(screen.getByLabelText("Branch"), "topic");
    expect(onAction).toHaveBeenCalledWith({
      id: "switch-branch",
      values: { branch: "topic", from: "main" },
    });

    await user.click(
      screen.getByRole("button", { name: "Stage draft.md" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "stage",
      values: { path: "draft.md" },
    });

    await user.click(
      screen.getByRole("button", { name: "Unstage ready.md" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "unstage",
      values: { path: "ready.md" },
    });

    await user.click(
      screen.getByRole("button", { name: "Open diff for draft.md" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "open-diff",
      values: { path: "draft.md", group: "unstaged" },
    });

    await user.click(
      screen.getByRole("button", { name: "Open conflict for image.bin" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "open-conflict",
      values: { path: "image.bin" },
    });

    await user.type(screen.getByLabelText("Commit message"), "Synthetic update");
    await user.click(
      screen.getByRole("button", { name: "Commit staged changes" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "commit",
      values: { message: "Synthetic update" },
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: "Abort" }));
    expect(onAction).toHaveBeenCalledWith({ id: "continue" });
    expect(onAction).toHaveBeenCalledWith({ id: "skip" });
    expect(onAction).toHaveBeenCalledWith({ id: "abort" });
  });

  it("supports arrow-key tab selection and renders history and branch models", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { rerender } = render(
      <SourceControlPanel
        title="Git"
        model={changesModel()}
        onAction={onAction}
      />,
    );

    const changesTab = screen.getByRole("tab", { name: "Changes" });
    changesTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
    expect(onAction).toHaveBeenCalledWith({
      id: "select-tab",
      values: { tab: "history" },
    });

    rerender(
      <SourceControlPanel
        title="Git"
        model={historyModel()}
        onAction={onAction}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Synthetic commit/ }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "open-commit",
      values: { commitId: "commit-1" },
    });

    rerender(
      <SourceControlPanel
        title="Git"
        model={branchesModel()}
        onAction={onAction}
      />,
    );
    expect(screen.getByRole("heading", { name: "Remotes" })).toBeInTheDocument();
    expect(screen.getByText("Fetch: https://example.invalid/repo.git")).toBeInTheDocument();
  });

  it("renders initialization and failed recovery actions only when available", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={{
          ...changesModel(),
          repository: {
            ...changesModel().repository,
            initialized: false,
            branch: null,
          },
          branches: [],
          recovery: {
            state: "failed",
            operationId: "operation-1",
            message: "Synthetic recovery failed",
            retryActionId: "provider-retry",
            dismissActionId: "provider-dismiss",
          },
        }}
        onAction={onAction}
      />,
    );

    expect(screen.getByLabelText("Branch")).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Initialize repository" }),
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAction).toHaveBeenCalledWith({ id: "initialize" });
    expect(onAction).toHaveBeenCalledWith({ id: "provider-retry" });
    expect(onAction).toHaveBeenCalledWith({ id: "provider-dismiss" });
  });

  it("offers cancellation only while a busy provider reports an operation ID", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { rerender } = render(
      <SourceControlPanel
        title="Git"
        model={busyModel()}
        onAction={onAction}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Refreshing");
    await user.click(
      screen.getByRole("button", { name: "Cancel operation" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "cancel-operation",
      values: { operationId: "11111111-2222-4333-8444-555555555555" },
    });

    const withoutId = busyModel();
    withoutId.repository.activeOperationId = undefined;
    rerender(
      <SourceControlPanel
        title="Git"
        model={withoutId}
        onAction={onAction}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel operation" }),
    ).not.toBeInTheDocument();

    const settled = busyModel();
    settled.repository.busy = false;
    rerender(
      <SourceControlPanel title="Git" model={settled} onAction={onAction} />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel operation" }),
    ).not.toBeInTheDocument();
  });
  it("manages remotes with labelled controls and exact action payloads", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = baseModel();
    model.selectedTab = "branches";
    model.selectedView = { kind: "remotes" };
    render(
      <SourceControlPanel title="Git" model={model} onAction={onAction} />,
    );

    const url = screen.getByLabelText("URL for origin");
    await user.clear(url);
    await user.type(url, "https://example.invalid/moved.git");
    await user.click(
      screen.getByRole("button", { name: "Save the URL for origin" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "set-remote-url",
      values: { name: "origin", url: "https://example.invalid/moved.git" },
    });

    await user.click(
      screen.getByRole("button", { name: "Remove the origin remote" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "remove-remote",
      values: { name: "origin" },
    });

    await user.type(screen.getByLabelText("New remote name"), "backup");
    await user.type(
      screen.getByLabelText("New remote URL"),
      "https://example.invalid/backup.git",
    );
    await user.click(screen.getByRole("button", { name: "Add remote" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "add-remote",
      values: { name: "backup", url: "https://example.invalid/backup.git" },
    });
  });

  it("offers clone onboarding, GitHub selection, and explicit clean-up", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = baseModel();
    model.remoteAccess = {
      authMode: "github-https",
      cloneAvailable: true,
      githubAvailable: true,
      repositories: [
        {
          nameWithOwner: "synthetic-owner/synthetic-notes",
          httpsUrl: "https://github.com/synthetic-owner/synthetic-notes.git",
          sshUrl: "ssh://git@github.com/synthetic-owner/synthetic-notes.git",
          defaultBranch: "main",
          private: true,
        },
      ],
      cleanup: { token: "synthetic-token", label: "the folder you chose" },
      review: null,
    };
    render(
      <SourceControlPanel title="Git" model={model} onAction={onAction} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Browse GitHub repositories" }),
    );
    expect(onAction).toHaveBeenCalledWith({ id: "browse-github" });

    await user.click(
      screen.getByRole("button", {
        name: "Use synthetic-owner/synthetic-notes",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "select-repository",
      values: {
        nameWithOwner: "synthetic-owner/synthetic-notes",
        url: "https://github.com/synthetic-owner/synthetic-notes.git",
      },
    });
    // Selecting a repository fills the form the user is about to submit.
    expect(screen.getByLabelText("Repository URL")).toHaveValue(
      "https://github.com/synthetic-owner/synthetic-notes.git",
    );
    expect(screen.getByLabelText("Branch (optional)")).toHaveValue("main");

    await user.click(
      screen.getByRole("button", { name: "Choose folder and clone" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "clone",
      values: {
        url: "https://github.com/synthetic-owner/synthetic-notes.git",
        branch: "main",
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Clean incomplete clone" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "clean-failed-clone",
      values: { token: "synthetic-token" },
    });
  });

  it("reviews the last remote operation and offers retry", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = baseModel();
    model.remoteAccess = {
      ...model.remoteAccess,
      review: {
        operation: "Fetch",
        outcome: "failed",
        summary: "Git fetch failed with exit code 128.",
        detail: "The remote refused the connection.",
        retryActionId: "refresh",
      },
    };
    render(
      <SourceControlPanel title="Git" model={model} onAction={onAction} />,
    );

    expect(
      screen.getByText("Fetch: Git fetch failed with exit code 128."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onAction).toHaveBeenCalledWith({ id: "refresh" });
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAction).toHaveBeenCalledWith({ id: "dismiss-review" });
  });

  it("shows the configured authentication mode without offering to change it", () => {
    const onAction = vi.fn();
    const model = baseModel();
    model.remoteAccess = { ...model.remoteAccess, authMode: "ssh-agent" };
    render(
      <SourceControlPanel title="Git" model={model} onAction={onAction} />,
    );

    // The mode is a host-persisted setting, so the panel reports it and sends
    // the user to Settings instead of offering a control that would only ever
    // disagree with what a remote operation actually uses.
    expect(screen.getByText("SSH agent")).toBeInTheDocument();
    expect(screen.getByText(/Change it in Settings/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Authentication")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: /authentication/i }),
    ).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("refuses remote actions until a remote exists", () => {
    const onAction = vi.fn();
    const model = baseModel();
    model.remotes = [];
    render(
      <SourceControlPanel title="Git" model={model} onAction={onAction} />,
    );

    expect(screen.getByRole("button", { name: "Fetch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
    expect(
      screen.getByText(/This repository has no remote yet/),
    ).toBeInTheDocument();
  });

  it("stages and unstages one hunk of the open diff", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { rerender } = render(
      <SourceControlPanel
        title="Git"
        model={diffModel()}
        onAction={onAction}
      />,
    );

    // The panel names the group the row came from, so the provider knows which
    // side of the index to read.
    await user.click(screen.getByRole("button", { name: "Open diff for draft.md" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "open-diff",
      values: { path: "draft.md", group: "unstaged" },
    });

    await user.click(
      screen.getByRole("button", {
        name: "Stage hunk @@ -1,1 +1,1 @@ in draft.md",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "stage-hunk",
      values: { path: "draft.md", hunk: 0 },
    });

    rerender(
      <SourceControlPanel
        title="Git"
        model={diffModel()}
        onAction={onAction}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open diff for ready.md" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "open-diff",
      values: { path: "ready.md", group: "staged" },
    });
  });

  it("offers no hunk action for a change Denote stages as a whole file", () => {
    const model = diffModel();
    model.diffFiles = [
      {
        ...model.diffFiles[0],
        status: "renamed",
        previousPath: "older.md",
      },
    ];
    render(
      <SourceControlPanel title="Git" model={model} onAction={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: /Stage hunk/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/stages this change as a whole file/)).toBeInTheDocument();
  });

  it("shows no diff, and no hunk action, outside a diff selection", () => {
    const model = diffModel();
    // Selecting the History tab keeps the diff content in the model, but it
    // belongs to the Changes tab; showing it here would offer the inverse hunk
    // action for the same lines.
    const history = {
      ...model,
      selectedTab: "history" as const,
      selectedView: { kind: "history" as const },
    };
    render(
      <SourceControlPanel title="Git" model={history} onAction={vi.fn()} />,
    );

    expect(
      screen.queryByRole("heading", { name: "Diff" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Stage hunk/ }),
    ).not.toBeInTheDocument();
  });

  it("offers no diff for an untracked file that Git cannot compare", () => {
    const model = diffModel();
    model.resourceGroups = [
      {
        kind: "untracked",
        label: "Untracked",
        resources: [
          {
            path: "fresh.md",
            status: "added",
            additions: 0,
            deletions: 0,
            binary: false,
          },
        ],
      },
    ];
    render(
      <SourceControlPanel title="Git" model={model} onAction={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: "Open diff for fresh.md" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stage fresh.md" }),
    ).toBeInTheDocument();
  });

  it("keeps the branch selector visible and offers every branch control", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={remoteBranchesModel()}
        onAction={onAction}
      />,
    );

    expect(screen.getByLabelText("Branch")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "switch-branch",
      values: { branch: "topic", from: "main" },
    });

    await user.click(
      screen.getByRole("button", {
        name: "Check out origin/release as a local branch",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "checkout-remote-branch",
      values: {
        remoteBranch: "origin/release",
        localName: "release",
        from: "main",
      },
    });

    const rename = screen.getByLabelText("New name for topic");
    await user.clear(rename);
    await user.type(rename, "topic-two");
    await user.click(screen.getByRole("button", { name: "Rename topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "rename-branch",
      values: { name: "topic", newName: "topic-two" },
    });

    await user.click(screen.getByRole("button", { name: "Delete topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "delete-branch",
      values: { name: "topic" },
    });

    // The branch that is checked out can never be switched to or deleted.
    expect(screen.getByRole("button", { name: "Switch to main" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete main" })).toBeDisabled();
  });

  it("creates a branch from a chosen start point, with or without checking out", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={remoteBranchesModel()}
        onAction={onAction}
      />,
    );

    await user.type(screen.getByLabelText("New branch name"), "release-notes");
    await user.selectOptions(screen.getByLabelText("Start point"), "origin/release");
    await user.click(
      screen.getByLabelText("Check out the new branch straight away"),
    );
    await user.click(screen.getByRole("button", { name: "Create branch" }));

    expect(onAction).toHaveBeenCalledWith({
      id: "create-branch",
      values: {
        name: "release-notes",
        startPoint: "origin/release",
        checkout: true,
        from: "main",
      },
    });
  });

  it("shows a pending switch with the exact paths and the three answers", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = baseModel();
    model.pendingBranchSwitch = {
      target: "origin/release",
      localBranch: "release",
      fromBranch: "main",
      stagedPaths: ["ready.md"],
      unstagedPaths: ["draft.md"],
      untrackedPaths: ["fresh.md"],
      commitAvailable: true,
      stashAvailable: true,
      stashUnavailableReason: null,
      commitActionId: "branch-switch-commit",
      stashActionId: "branch-switch-stash",
      cancelActionId: "branch-switch-cancel",
    };
    render(<SourceControlPanel title="Git" model={model} onAction={onAction} />);

    expect(
      screen.getByRole("heading", { name: "Switch to release" }),
    ).toBeInTheDocument();
    for (const path of ["ready.md", "draft.md", "fresh.md"]) {
      expect(screen.getByText(path)).toBeInTheDocument();
    }

    await user.type(
      screen.getByLabelText("Commit message for the switch"),
      "Record work before switching",
    );
    await user.click(
      screen.getByRole("button", { name: "Commit all and switch" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "branch-switch-commit",
      values: {
        message: "Record work before switching",
        branch: "release",
        from: "main",
      },
    });

    await user.click(screen.getByRole("button", { name: "Stash and switch" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "branch-switch-stash",
      values: { branch: "release", from: "main" },
    });

    await user.click(screen.getByRole("button", { name: "Cancel switch" }));
    expect(onAction).toHaveBeenCalledWith({ id: "branch-switch-cancel" });
  });

  it("disables stashing and explains why when the vault is encrypted", () => {
    const model = baseModel();
    model.pendingBranchSwitch = {
      target: "topic",
      localBranch: null,
      fromBranch: "main",
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: ["fresh.md"],
      commitAvailable: true,
      stashAvailable: false,
      stashUnavailableReason:
        "This vault is encrypted, so Denote cannot stash while untracked files are present.",
      commitActionId: "branch-switch-commit",
      stashActionId: "branch-switch-stash",
      cancelActionId: "branch-switch-cancel",
    };
    render(<SourceControlPanel title="Git" model={model} onAction={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Stash and switch" }),
    ).toBeDisabled();
    expect(screen.getByText(/This vault is encrypted/)).toBeInTheDocument();
  });

});

function busyModel(): PluginSourceControlViewModel {
  const model = baseModel();
  model.repository.busy = true;
  model.repository.busyMessage = "Refreshing the repository";
  model.repository.activeOperationId = "11111111-2222-4333-8444-555555555555";
  return model;
}

function baseModel(): PluginSourceControlViewModel {
  return {
    selectedTab: "changes",
    selectedView: { kind: "repository" },
    repository: {
      repositoryId: "synthetic-repository",
      label: "Synthetic repository",
      initialized: true,
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 2,
      latestCommit: {
        id: "commit-1",
        shortId: "abc1234",
        summary: "Synthetic commit",
        authorName: "Example Author",
        authoredAt: "2026-01-01T00:00:00Z",
      },
      busy: false,
    },
    resourceGroups: [],
    branches: [
      {
        name: "main",
        current: true,
        remote: false,
        upstream: "origin/main",
        ahead: 1,
        behind: 2,
      },
      {
        name: "topic",
        current: false,
        remote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ],
    remotes: [
      {
        name: "origin",
        fetchUrl: "https://example.invalid/repo.git",
        pushUrl: "https://example.invalid/repo.git",
      },
    ],
    history: [],
    diffFiles: [],
    conflicts: [],
    recovery: { state: "idle" },
    pendingBranchSwitch: null,
    remoteAccess: {
      authMode: "public" as const,
      cloneAvailable: true,
      githubAvailable: false,
      repositories: [],
      cleanup: null,
      review: null,
    },
  };
}

function changesModel(): PluginSourceControlViewModel {
  return {
    ...baseModel(),
    selectedTab: "changes",
    selectedView: { kind: "conflict", path: "image.bin" },
    resourceGroups: [
      {
        kind: "staged",
        label: "Staged",
        resources: [
          {
            path: "ready.md",
            status: "modified",
            additions: 2,
            deletions: 1,
            binary: false,
          },
        ],
      },
      {
        kind: "unstaged",
        label: "Changes",
        resources: [
          {
            path: "draft.md",
            status: "modified",
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
      },
      {
        kind: "conflicted",
        label: "Conflicts",
        resources: [
          {
            path: "image.bin",
            status: "unmerged",
            additions: 0,
            deletions: 0,
            binary: true,
          },
        ],
      },
    ],
    conflicts: [
      {
        path: "image.bin",
        status: "unmerged",
        oursLabel: "Current branch",
        theirsLabel: "Incoming branch",
        baseLabel: "Merge base",
      },
    ],
    diffFiles: [
      {
        path: "draft.md",
        previousPath: null,
        status: "modified",
        additions: 1,
        deletions: 1,
        binary: false,
        hunks: [
          {
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              {
                kind: "deletion",
                oldLineNumber: 1,
                newLineNumber: null,
                content: "old synthetic line",
              },
              {
                kind: "addition",
                oldLineNumber: null,
                newLineNumber: 1,
                content: "new synthetic line",
              },
            ],
          },
        ],
      },
    ],
    recovery: {
      state: "running",
      operationId: "operation-1",
      message: "Resolve conflicts to continue",
    },
  };
}

/** One open, ordinary text diff with a staged and an unstaged row. */
function diffModel(): PluginSourceControlViewModel {
  return {
    ...baseModel(),
    selectedTab: "changes",
    selectedView: { kind: "diff", path: "draft.md" },
    resourceGroups: [
      {
        kind: "staged",
        label: "Staged",
        resources: [
          {
            path: "ready.md",
            status: "modified",
            additions: 2,
            deletions: 1,
            binary: false,
          },
        ],
      },
      {
        kind: "unstaged",
        label: "Changes",
        resources: [
          {
            path: "draft.md",
            status: "modified",
            additions: 1,
            deletions: 1,
            binary: false,
          },
        ],
      },
    ],
    diffFiles: [
      {
        path: "draft.md",
        previousPath: null,
        status: "modified",
        additions: 1,
        deletions: 1,
        binary: false,
        hunks: [
          {
            header: "@@ -1,1 +1,1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              {
                kind: "deletion",
                oldLineNumber: 1,
                newLineNumber: null,
                content: "old synthetic line",
              },
              {
                kind: "addition",
                oldLineNumber: null,
                newLineNumber: 1,
                content: "new synthetic line",
              },
            ],
          },
        ],
      },
    ],
  };
}

/** The Branches tab with one remote-tracking branch to check out. */
function remoteBranchesModel(): PluginSourceControlViewModel {
  const base = baseModel();
  return {
    ...base,
    selectedTab: "branches",
    selectedView: { kind: "branches" },
    branches: [
      ...base.branches,
      {
        name: "origin/release",
        current: false,
        remote: true,
        upstream: null,
        ahead: 0,
        behind: 0,
      },
    ],
  };
}

function historyModel(): PluginSourceControlViewModel {
  const base = baseModel();
  return {
    ...base,
    selectedTab: "history",
    selectedView: { kind: "history" },
    history: [
      {
        id: "commit-1",
        shortId: "abc1234",
        summary: "Synthetic commit",
        authorName: "Example Author",
        authoredAt: "2026-01-01T00:00:00Z",
        parentIds: [],
        refs: ["main"],
      },
    ],
  };
}

function branchesModel(): PluginSourceControlViewModel {
  return {
    ...baseModel(),
    selectedTab: "branches",
    selectedView: { kind: "branches" },
  };
}
