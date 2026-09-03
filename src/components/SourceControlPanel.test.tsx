import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PluginSourceControlViewModel } from "@denote/plugin-sdk";
import { CloneOnboarding, SourceControlPanel } from "./SourceControlPanel";

describe("SourceControlPanel", () => {
  it("lists detected repositories and selects one explicitly", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = changesModel();
    model.workspaceRepositories = [
      {
        repositoryId: "vault",
        label: "Notes vault",
        selected: false,
        initialized: true,
        branch: "main",
        changes: 0,
      },
      {
        repositoryId: "project:synthetic",
        label: "Synthetic repository",
        selected: true,
        initialized: true,
        branch: "topic",
        changes: 3,
      },
    ];

    render(
      <SourceControlPanel title="Git" model={model} onAction={onAction} />,
    );

    expect(
      screen.getByRole("heading", { name: "Repositories" }),
    ).toBeInTheDocument();
    expect(screen.getByText("topic · 3 changes")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Select Notes vault repository" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "select-workspace-repository",
      values: { repositoryId: "vault" },
    });
  });

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
    expect(
      screen.getByRole("button", { name: "Branch: main" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Git recorded this file as binary content/),
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

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(screen.getByRole("button", { name: "Switch to topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "switch-branch",
      values: { branch: "topic", from: "main" },
    });
    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Find or create branch" }),
      "feature",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Create feature from main and switch",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "create-branch",
      values: {
        name: "feature",
        startPoint: "main",
        checkout: true,
        from: "main",
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Stage draft.md" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "stage",
      values: { path: "draft.md" },
    });

    await user.click(screen.getByRole("button", { name: "Stage all changes" }));
    await user.click(
      screen.getByRole("button", { name: "Unstage all changes" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Restore draft.md from origin/main",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Restore all tracked changes from origin/main",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({ id: "stage-all" });
    expect(onAction).toHaveBeenCalledWith({ id: "unstage-all" });
    expect(onAction).toHaveBeenCalledWith({
      id: "restore-from-upstream",
      values: { path: "draft.md" },
    });
    expect(onAction).toHaveBeenCalledWith({
      id: "restore-all-from-upstream",
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
    expect(screen.getByLabelText(/Signing passphrase/)).toHaveAttribute(
      "type",
      "password",
    );
    await user.type(
      screen.getByLabelText(/Signing passphrase/),
      "synthetic-passphrase",
    );
    await user.click(
      screen.getByRole("button", { name: "Commit" }),
    );
    expect(onAction).toHaveBeenCalledWith(
      {
        id: "commit",
        values: { message: "Synthetic update", sign: true },
      },
      { gitSigningPassphrase: "synthetic-passphrase" },
    );

    // Continue, skip, and abort come from the typed operation the provider
    // reported, so every one of them names the operation it resumes.
    await user.click(
      screen.getByRole("button", { name: "Continue the merge" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Abort the merge" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "continue",
      values: { sequencer: "merge" },
    });
    expect(onAction).toHaveBeenCalledWith({
      id: "abort",
      values: { sequencer: "merge" },
    });
    // Git cannot skip a merge, so no control offers one.
    expect(
      screen.queryByRole("button", { name: /Skip this step/ }),
    ).not.toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Branch: none" })).toBeDisabled();
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
      <CloneOnboarding
        remoteAccess={model.remoteAccess}
        busy={false}
        onAction={onAction}
      />,
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
      <CloneOnboarding
        remoteAccess={model.remoteAccess}
        busy={false}
        onAction={onAction}
      />,
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

  it("opens working-tree and staged patches in the editor", async () => {
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

    expect(
      screen.getByText(/temporary .diff tab in the editor/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Stage hunk/ }),
    ).not.toBeInTheDocument();

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
      screen.queryByRole("heading", { name: /diff/i }),
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

    expect(
      screen.getByRole("button", { name: "Branch: main" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(screen.getByRole("button", { name: "Switch to topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "switch-branch",
      values: { branch: "topic", from: "main" },
    });

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(
      screen.getByRole("button", {
        name: "Check out origin/release as release",
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

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(screen.getByRole("button", { name: "Edit branch topic" }));
    const rename = screen.getByLabelText("New name for topic");
    await user.clear(rename);
    await user.type(rename, "topic-two");
    await user.click(screen.getByRole("button", { name: "Rename topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "rename-branch",
      values: { name: "topic", newName: "topic-two" },
    });

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.click(screen.getByRole("button", { name: "Delete topic" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "delete-branch",
      values: { name: "topic" },
    });

    // The branch that is checked out can never be switched to or deleted.
    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    expect(screen.getByRole("button", { name: "Switch to main" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete main" })).toBeDisabled();
  });

  it("creates and switches from a chosen start point when search has no result", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={remoteBranchesModel()}
        onAction={onAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Branch: main" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Find or create branch" }),
      "release-notes",
    );
    await user.selectOptions(screen.getByLabelText("Create from"), "origin/release");
    await user.click(
      screen.getByRole("button", {
        name: "Create release-notes from origin/release and switch",
      }),
    );

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
      operation: "checkout",
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
    expect(onAction).toHaveBeenCalledWith(
      {
        id: "branch-switch-commit",
        values: {
          message: "Record work before switching",
          sign: true,
          branch: "release",
          from: "main",
          operation: "checkout",
        },
      },
      undefined,
    );

    await user.click(screen.getByRole("button", { name: "Stash and switch" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "branch-switch-stash",
      values: { branch: "release", from: "main", operation: "checkout" },
    });

    await user.click(screen.getByRole("button", { name: "Cancel switch" }));
    expect(onAction).toHaveBeenCalledWith({ id: "branch-switch-cancel" });
  });

  it("names the operation a pending review will actually run", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = baseModel();
    model.pendingBranchSwitch = {
      operation: "rebase",
      target: "topic",
      localBranch: null,
      fromBranch: "main",
      stagedPaths: ["ready.md"],
      unstagedPaths: [],
      untrackedPaths: [],
      commitAvailable: true,
      stashAvailable: true,
      stashUnavailableReason: null,
      commitActionId: "branch-switch-commit",
      stashActionId: "branch-switch-stash",
      cancelActionId: "branch-switch-cancel",
    };
    render(<SourceControlPanel title="Git" model={model} onAction={onAction} />);

    expect(
      screen.getByRole("heading", { name: "Rebase topic" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/rewrites the commits on main/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Stash and rebase" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "branch-switch-stash",
      values: { branch: "topic", from: "main", operation: "rebase" },
    });
  });

  it("disables stashing and explains why when the vault is encrypted", () => {
    const model = baseModel();
    model.pendingBranchSwitch = {
      operation: "checkout",
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

  it("pages history with labelled controls and an announced page status", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = historyModel();
    model.historyPage = {
      pageIndex: 1,
      pageSize: 20,
      hasPrevious: true,
      hasNext: true,
      loading: false,
      error: null,
    };
    render(<SourceControlPanel title="Git" model={model} onAction={onAction} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Page 2, 1 commit, more available");

    await user.click(screen.getByRole("button", { name: "Refresh history" }));
    await user.click(
      screen.getByRole("button", { name: "Previous page of history" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Next page of history" }),
    );
    expect(onAction).toHaveBeenCalledWith({ id: "refresh-history" });
    expect(onAction).toHaveBeenCalledWith({ id: "history-previous" });
    expect(onAction).toHaveBeenCalledWith({ id: "history-next" });
  });

  it("offers no page control for a page that does not exist, and says a read failed", () => {
    const model = historyModel();
    model.historyPage = {
      pageIndex: 0,
      pageSize: 20,
      hasPrevious: false,
      hasNext: false,
      loading: false,
      error: "There are no more commits to show.",
    };
    render(<SourceControlPanel title="Git" model={model} onAction={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Previous page of history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Next page of history" }),
    ).toBeDisabled();
    expect(
      screen.getByText("There are no more commits to show."),
    ).toBeInTheDocument();
  });

  it("announces a history read that is still running", () => {
    const model = historyModel();
    model.historyPage = { ...model.historyPage, loading: true };
    render(<SourceControlPanel title="Git" model={model} onAction={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Reading history…");
    expect(
      screen.getByRole("button", { name: "Refresh history" }),
    ).toBeDisabled();
  });

  it("selects a commit with the keyboard and shows its details and diff", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onOpenFile = vi.fn();
    const { rerender } = render(
      <SourceControlPanel
        title="Git"
        model={historyModel()}
        onAction={onAction}
        onOpenFile={onOpenFile}
      />,
    );

    screen.getByRole("button", { name: /Synthetic commit/ }).focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith({
      id: "open-commit",
      values: { commitId: "commit-1" },
    });

    rerender(
      <SourceControlPanel
        title="Git"
        model={commitModel()}
        onAction={onAction}
        onOpenFile={onOpenFile}
      />,
    );

    const detail = screen.getByRole("region", { name: "Synthetic commit" });
    expect(within(detail).getByText("abc1234")).toBeInTheDocument();
    expect(within(detail).getByText("Example Author")).toBeInTheDocument();
    expect(
      within(detail).getByText("2026-01-01T00:00:00Z"),
    ).toBeInTheDocument();
    expect(within(detail).getByText("commit-0")).toBeInTheDocument();
    expect(within(detail).getByText("main")).toBeInTheDocument();
    expect(within(detail).getByText("Previously older.md")).toBeInTheDocument();
    expect(
      within(detail).getByText(/commit patch is open as a temporary .diff/i),
    ).toBeInTheDocument();
    // A commit is history, so nothing in it can be staged by hunk.
    expect(
      screen.queryByRole("button", { name: /Stage hunk/ }),
    ).not.toBeInTheDocument();

    await user.click(
      within(detail).getByRole("button", { name: "Open file draft.md" }),
    );
    expect(onOpenFile).toHaveBeenCalledWith("draft.md");

    await user.click(
      within(detail).getByRole("button", { name: "Back to history" }),
    );
    expect(onAction).toHaveBeenCalledWith({ id: "close-commit" });
  });

  it("keeps a deleted or binary commit entry reviewable without offering to open it", () => {
    const model = commitModel();
    model.commitDetail = {
      commit: model.commitDetail!.commit,
      limitation:
        "This is a merge commit. Denote shows how the merge result differs from its first parent.",
      files: [
        {
          path: "gone.md",
          previousPath: null,
          status: "deleted",
          additions: 0,
          deletions: 3,
          binary: false,
          hunks: [],
        },
        {
          path: "sealed.md",
          previousPath: null,
          status: "modified",
          additions: 0,
          deletions: 0,
          binary: true,
          hunks: [],
        },
      ],
    };
    render(
      <SourceControlPanel
        title="Git"
        model={model}
        onAction={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByText("gone.md")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open file gone.md" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open file sealed.md" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing left in the vault to open/)).toBeInTheDocument();
    expect(screen.getByText(/Binary content cannot be displayed/)).toBeInTheDocument();
    expect(screen.getByText(/merge commit/)).toBeInTheDocument();
  });

  it("says so when the selected commit changed no files", () => {
    const model = commitModel();
    model.commitDetail = { ...model.commitDetail!, files: [] };
    render(<SourceControlPanel title="Git" model={model} onAction={vi.fn()} />);

    expect(screen.getByText("This commit changed no files.")).toBeInTheDocument();
  });

  it("offers the other side of the index only when both diffs exist", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = diffModel();
    // The same path is both staged and changed, so there are two diffs.
    model.resourceGroups = model.resourceGroups.map((group) => ({
      ...group,
      resources: group.resources.map((resource) => ({
        ...resource,
        path: "draft.md",
      })),
    }));
    render(<SourceControlPanel title="Git" model={model} onAction={onAction} />);

    const toggle = screen.getByRole("group", { name: "Diff side for draft.md" });
    expect(
      within(toggle).getByRole("button", { name: "Working tree" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(
      within(toggle).getByRole("button", { name: "Staged" }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "open-diff",
      values: { path: "draft.md", group: "staged" },
    });
    expect(
      screen.getByRole("heading", { name: "Working tree diff: draft.md" }),
    ).toBeInTheDocument();
  });

  it("offers no diff side toggle when only one side has changes", () => {
    render(
      <SourceControlPanel title="Git" model={diffModel()} onAction={vi.fn()} />,
    );

    expect(
      screen.queryByRole("group", { name: "Diff side for draft.md" }),
    ).not.toBeInTheDocument();
  });

  it("opens a changed file from its row, and never a deleted one", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const model = diffModel();
    model.resourceGroups = [
      ...model.resourceGroups,
      {
        kind: "unstaged",
        label: "Changes",
        resources: [
          {
            path: "removed.md",
            status: "deleted",
            additions: 0,
            deletions: 4,
            binary: false,
          },
        ],
      },
    ];
    render(
      <SourceControlPanel
        title="Git"
        model={model}
        onAction={vi.fn()}
        onOpenFile={onOpenFile}
      />,
    );

    await user.click(
      screen.getAllByRole("button", { name: "Open file draft.md" })[0],
    );
    expect(onOpenFile).toHaveBeenCalledWith("draft.md");
    expect(
      screen.queryByRole("button", { name: "Open file removed.md" }),
    ).not.toBeInTheDocument();
  });

  it("offers no file opening at all when the host supplies no handler", () => {
    render(
      <SourceControlPanel title="Git" model={diffModel()} onAction={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: /^Open file/ }),
    ).not.toBeInTheDocument();
  });


  it("reviews an advanced operation before offering to start it", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={{
          ...branchesModel(),
          operationPlan: {
            operation: "rebase",
            source: "topic",
            sourceDetail: "Local branch.",
            currentBranch: "main",
            risk: "rewrites-history",
            summary: "Replay the commits of main on top of topic.",
            affectedPaths: ["notes/alpha.md"],
            affectedPathsLimitation: "A rebase may not change all of them.",
            startActionId: "rebase",
            cancelActionId: "cancel-operation-plan",
          },
        }}
        onAction={onAction}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Review this rebase" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rewrites commits/)).toBeInTheDocument();
    expect(screen.getByText("notes/alpha.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start rebase" }));
    expect(onAction).toHaveBeenCalledWith({
      id: "rebase",
      // The reviewed branch travels with the action, so the host confirmation
      // can name the branch that changes as well as the source.
      values: { ref: "topic", operation: "rebase", from: "main" },
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAction).toHaveBeenCalledWith({ id: "cancel-operation-plan" });
  });

  it("prepares merge and rebase from the branch that was chosen", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={branchesModel()}
        onAction={onAction}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Branch to use"), "topic");
    await user.click(
      screen.getByRole("button", { name: "Review merging topic" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Review rebasing onto topic" }),
    );

    expect(onAction).toHaveBeenCalledWith({
      id: "prepare-merge",
      values: { ref: "topic" },
    });
    expect(onAction).toHaveBeenCalledWith({
      id: "prepare-rebase",
      values: { ref: "topic" },
    });
  });

  it("offers cherry-pick and revert on the commit that is open", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={commitModel()}
        onAction={onAction}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Review cherry-picking abc1234" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Review reverting abc1234" }),
    );

    expect(onAction).toHaveBeenCalledWith({
      id: "prepare-cherry-pick",
      values: { commitId: "commit-1" },
    });
    expect(onAction).toHaveBeenCalledWith({
      id: "prepare-revert",
      values: { commitId: "commit-1" },
    });
  });

  it("disables continue until Git reports no unmerged paths", () => {
    render(
      <SourceControlPanel
        title="Git"
        model={{
          ...changesModel(),
          operationProgress: {
            operation: "rebase",
            summary: "A rebase stopped on 1 conflicted file.",
            conflictedPaths: ["notes/alpha.md"],
            continueAvailable: false,
            continueUnavailableReason: "Resolve the 1 conflicted file first.",
            skipAvailable: true,
            abortAvailable: true,
          },
        }}
        onAction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue the rebase" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Skip this step of the rebase" }),
    ).toBeEnabled();
    expect(
      screen.getByText("Resolve the 1 conflicted file first."),
    ).toBeInTheDocument();
  });

  it("renders a three-way conflict with keyboard reachable per-change controls", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SourceControlPanel
        title="Git"
        model={conflictModel()}
        onAction={onAction}
      />,
    );

    // Each recorded side is its own labelled pane.
    expect(
      screen.getByRole("heading", { name: "Common ancestor" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("main of notes/alpha.md")).toHaveTextContent(
      "OURS",
    );

    const theirs = screen.getByRole("button", {
      name: "Use Incoming change for change 1",
    });
    theirs.focus();
    expect(theirs).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith({
      id: "choose-conflict-change",
      values: { chunkId: "chunk-1", side: "theirs" },
    });
    expect(
      screen.getByRole("button", { name: "Use main for change 1" }),
    ).toHaveAttribute("aria-pressed", "false");

    await user.click(
      screen.getByRole("button", {
        name: "Use Common ancestor for the whole file",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "use-conflict-side",
      values: { side: "base" },
    });
  });

  it("sends an edited result and marks a conflict resolved", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = conflictModel();
    render(
      <SourceControlPanel title="Git" model={model} onAction={onAction} />,
    );

    const result = screen.getByLabelText("Merged result");
    await user.clear(result);
    await user.type(result, "x");
    expect(onAction).toHaveBeenCalledWith({
      id: "edit-conflict-result",
      values: { result: "x" },
    });

    // An unanswered change keeps the file from being marked resolved.
    expect(screen.getByRole("button", { name: "Mark resolved" })).toBeDisabled();

    render(
      <SourceControlPanel
        title="Git"
        model={{
          ...model,
          conflictDetail: model.conflictDetail
            ? {
                ...model.conflictDetail,
                unresolvedChunks: 0,
                unsavedResult: true,
              }
            : null,
        }}
        onAction={onAction}
      />,
    );
    const [, resolvable] = screen.getAllByRole("button", {
      name: "Mark resolved",
    });
    await user.click(resolvable);
    expect(onAction).toHaveBeenCalledWith({ id: "resolve-conflict" });

    const [, discard] = screen.getAllByRole("button", {
      name: "Discard result",
    });
    await user.click(discard);
    expect(onAction).toHaveBeenCalledWith({ id: "discard-conflict-result" });
  });

  it("offers only whole recorded sides for a conflict it must not decode", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const model = conflictModel();
    render(
      <SourceControlPanel
        title="Git"
        model={{
          ...model,
          conflictDetail: model.conflictDetail
            ? {
                ...model.conflictDetail,
                encrypted: true,
                wholeSideOnly: true,
                chunks: [],
                result: null,
                base: { ...model.conflictDetail.base, present: false, text: null },
                ours: { ...model.conflictDetail.ours, text: null },
                theirs: { ...model.conflictDetail.theirs, text: null },
                limitation: "This vault is encrypted, so Git recorded ciphertext.",
              }
            : null,
        }}
        onAction={onAction}
      />,
    );

    expect(screen.queryByLabelText("Merged result")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark resolved" }),
    ).not.toBeInTheDocument();
    // The stage Git does not hold is never offered.
    expect(
      screen.queryByRole("button", {
        name: "Resolve notes/alpha.md with Common ancestor",
      }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Resolve notes/alpha.md with Incoming change",
      }),
    );
    expect(onAction).toHaveBeenCalledWith({
      id: "resolve-conflict-stage",
      values: { side: "theirs" },
    });
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
    historyPage: {
      pageIndex: 0,
      pageSize: 20,
      hasPrevious: false,
      hasNext: false,
      loading: false,
      error: null,
    },
    commitDetail: null,
    diffFiles: [],
    diffSource: null,
    conflicts: [],
    conflictDetail: null,
    operationProgress: null,
    operationPlan: null,
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
    operationProgress: {
      operation: "merge",
      summary: "This repository has a merge in progress.",
      conflictedPaths: [],
      continueAvailable: true,
      continueUnavailableReason: null,
      skipAvailable: false,
      abortAvailable: true,
    },
  };
}

/** One open, ordinary text diff with a staged and an unstaged row. */
function diffModel(): PluginSourceControlViewModel {
  return {
    ...baseModel(),
    selectedTab: "changes",
    selectedView: { kind: "diff", path: "draft.md" },
    // The provider says which comparison the content came from, so the panel
    // never guesses which direction a hunk action would apply in.
    diffSource: { kind: "worktree" },
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

/** One selected commit, with the exact diff Git reported for it. */
function commitModel(): PluginSourceControlViewModel {
  const history = historyModel();
  const commit = history.history[0];
  return {
    ...history,
    selectedTab: "history",
    selectedView: { kind: "commit", commitId: commit.id },
    diffSource: { kind: "commit", commitId: commit.id },
    commitDetail: {
      commit: { ...commit, parentIds: ["commit-0"] },
      limitation: null,
      files: [
        {
          path: "draft.md",
          previousPath: "older.md",
          status: "renamed",
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
    },
  };
}

/** One text conflict with a single unanswered change. */
function conflictModel(): PluginSourceControlViewModel {
  return {
    ...baseModel(),
    selectedTab: "changes",
    selectedView: { kind: "conflict", path: "notes/alpha.md" },
    conflicts: [
      {
        path: "notes/alpha.md",
        status: "unmerged",
        oursLabel: "main",
        theirsLabel: "Incoming change",
        baseLabel: "Common ancestor",
      },
    ],
    conflictDetail: {
      path: "notes/alpha.md",
      operation: "merge",
      binary: false,
      encrypted: false,
      base: {
        side: "base",
        label: "Common ancestor",
        present: true,
        text: "one\ntwo\n",
        byteLength: 8,
      },
      ours: {
        side: "ours",
        label: "main",
        present: true,
        text: "one\nOURS\n",
        byteLength: 9,
      },
      theirs: {
        side: "theirs",
        label: "Incoming change",
        present: true,
        text: "one\nTHEIRS\n",
        byteLength: 11,
      },
      chunks: [
        {
          id: "chunk-0",
          kind: "stable",
          base: ["one"],
          ours: ["one"],
          theirs: ["one"],
          choice: "ours",
          automatic: true,
        },
        {
          id: "chunk-1",
          kind: "conflict",
          base: ["two"],
          ours: ["OURS"],
          theirs: ["THEIRS"],
          choice: null,
          automatic: false,
        },
      ],
      result: "one\n",
      unsavedResult: false,
      unresolvedChunks: 1,
      wholeSideOnly: false,
      limitation: null,
      status: null,
      error: null,
      loading: false,
    },
  };
}
