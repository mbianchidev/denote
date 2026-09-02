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
    expect(screen.getByText("@@ -1,1 +1,1 @@")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await user.click(screen.getByRole("button", { name: "Pull" }));
    await user.click(screen.getByRole("button", { name: "Push" }));
    expect(onAction).toHaveBeenCalledWith({ id: "refresh" });
    expect(onAction).toHaveBeenCalledWith({ id: "fetch" });
    expect(onAction).toHaveBeenCalledWith({ id: "pull" });
    expect(onAction).toHaveBeenCalledWith({ id: "push" });

    await user.selectOptions(screen.getByLabelText("Branch"), "topic");
    expect(onAction).toHaveBeenCalledWith({
      id: "switch-branch",
      values: { branch: "topic" },
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
      values: { path: "draft.md" },
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
