import type {
  PluginProjectContext,
  PluginSourceControlBranchChoice,
  PluginSourceControlConflictEntry,
  PluginSourceControlHistoryEntry,
  PluginSourceControlRecoveryState,
  PluginSourceControlRemote,
  PluginSourceControlRepositorySummary,
  PluginSourceControlResourceGroup,
  PluginSourceControlViewModel,
} from "@denote/plugin-sdk";
import type { GitStatusReport } from "./statusOutput";

export type GitScopeKind = "vault" | "project";

export interface GitRepositoryScope {
  kind: GitScopeKind;
  /** Stable identity of the repository a model describes. */
  repositoryId: string;
  name: string;
}

export type GitSelection =
  | {
      tab: "changes";
      view:
        | { kind: "repository" }
        | { kind: "diff"; path: string }
        | { kind: "conflict"; path: string };
    }
  | {
      tab: "history";
      view:
        | { kind: "history" }
        | { kind: "commit"; commitId: string }
        | { kind: "diff"; path: string; commitId: string };
    }
  | { tab: "branches"; view: { kind: "branches" } | { kind: "remotes" } };

export interface GitModelBase {
  repository: PluginSourceControlRepositorySummary;
  resourceGroups: PluginSourceControlResourceGroup[];
  branches: PluginSourceControlBranchChoice[];
  remotes: PluginSourceControlRemote[];
  history: PluginSourceControlHistoryEntry[];
  conflicts: PluginSourceControlConflictEntry[];
  recovery: PluginSourceControlRecoveryState;
}

export const UNREFRESHED_LABEL = "refresh required";

export function vaultScope(): GitRepositoryScope {
  return { kind: "vault", repositoryId: "vault", name: "Vault" };
}

export function scopeFor(
  context: PluginProjectContext | null,
): GitRepositoryScope {
  if (!context) {
    return vaultScope();
  }
  return {
    kind: "project",
    repositoryId: `project:${context.projectId}`,
    name: folderName(context.rootPath) || "Project",
  };
}

/**
 * The model a freshly activated or freshly rescoped provider shows.
 *
 * No Git command has run yet, so it states that a refresh is required instead
 * of describing a repository it has not looked at.
 */
export function initialModel(
  scope: GitRepositoryScope,
): PluginSourceControlViewModel {
  return compose(
    {
      repository: summary(scope, `${scope.name} · ${UNREFRESHED_LABEL}`, false),
      resourceGroups: [],
      branches: [],
      remotes: [],
      history: [],
      conflicts: [],
      recovery: { state: "idle" },
    },
    { tab: "changes", view: { kind: "repository" } },
  );
}

export function compose(
  base: GitModelBase,
  selection: GitSelection,
): PluginSourceControlViewModel {
  // Diffs are not part of this increment, so a model never claims to hold diff
  // content.
  const shared = { ...base, diffFiles: [] };
  if (selection.tab === "history") {
    return { ...shared, selectedTab: "history", selectedView: selection.view };
  }
  if (selection.tab === "branches") {
    return { ...shared, selectedTab: "branches", selectedView: selection.view };
  }
  return { ...shared, selectedTab: "changes", selectedView: selection.view };
}

export function selectionOf(model: PluginSourceControlViewModel): GitSelection {
  if (model.selectedTab === "history") {
    return { tab: "history", view: model.selectedView };
  }
  if (model.selectedTab === "branches") {
    return { tab: "branches", view: model.selectedView };
  }
  return { tab: "changes", view: model.selectedView };
}

export function baseOf(model: PluginSourceControlViewModel): GitModelBase {
  return {
    repository: model.repository,
    resourceGroups: model.resourceGroups,
    branches: model.branches,
    remotes: model.remotes,
    history: model.history,
    conflicts: model.conflicts,
    recovery: model.recovery,
  };
}

export function withBusy(
  model: PluginSourceControlViewModel,
  busyMessage: string,
  activeOperationId: string,
): PluginSourceControlViewModel {
  return compose(
    {
      ...baseOf(model),
      repository: {
        ...model.repository,
        busy: true,
        busyMessage,
        activeOperationId,
      },
    },
    selectionOf(model),
  );
}

/** Clears progress state and reports why the last operation stopped. */
export function withRecovery(
  model: PluginSourceControlViewModel,
  recovery: PluginSourceControlRecoveryState,
): PluginSourceControlViewModel {
  return compose(
    { ...baseOf(model), repository: idle(model.repository), recovery },
    selectionOf(model),
  );
}

export function withSelection(
  model: PluginSourceControlViewModel,
  selection: GitSelection,
): PluginSourceControlViewModel {
  return compose(baseOf(model), selection);
}

export interface GitRefreshData {
  status: GitStatusReport;
  branches: PluginSourceControlBranchChoice[];
  remotes: PluginSourceControlRemote[];
  history: PluginSourceControlHistoryEntry[];
  recovery: PluginSourceControlRecoveryState;
}

/** Builds one coherent model from a completed refresh. */
export function refreshedModel(
  scope: GitRepositoryScope,
  selection: GitSelection,
  data: GitRefreshData,
): PluginSourceControlViewModel {
  const latest = data.history[0] ?? null;
  const base: GitModelBase = {
    repository: {
      ...summary(scope, scope.name, true),
      branch: data.status.branch,
      upstream: data.status.upstream,
      ahead: data.status.ahead,
      behind: data.status.behind,
      latestCommit: latest
        ? {
            id: latest.id,
            shortId: latest.shortId,
            summary: latest.summary,
            authorName: latest.authorName,
            authoredAt: latest.authoredAt,
          }
        : null,
    },
    resourceGroups: resourceGroups(data.status),
    branches: data.branches,
    remotes: data.remotes,
    history: data.history,
    conflicts: conflictEntries(data.status),
    recovery: data.recovery,
  };
  return compose(base, resolveSelection(selection, base));
}

/** Builds the model for a scope Git reports is not a repository yet. */
export function uninitializedModel(
  scope: GitRepositoryScope,
): PluginSourceControlViewModel {
  return compose(
    {
      repository: summary(scope, scope.name, false),
      resourceGroups: [],
      branches: [],
      remotes: [],
      history: [],
      conflicts: [],
      recovery: { state: "idle" },
    },
    { tab: "changes", view: { kind: "repository" } },
  );
}

/** Keeps the selected tab and view only while the data behind it still exists. */
export function resolveSelection(
  selection: GitSelection,
  base: GitModelBase,
): GitSelection {
  if (selection.tab === "history") {
    const view = selection.view;
    if (
      view.kind === "commit" &&
      base.history.some((entry) => entry.id === view.commitId)
    ) {
      return { tab: "history", view };
    }
    return { tab: "history", view: { kind: "history" } };
  }
  if (selection.tab === "branches") {
    return selection;
  }
  const view = selection.view;
  if (
    view.kind === "conflict" &&
    base.conflicts.some((conflict) => conflict.path === view.path)
  ) {
    return { tab: "changes", view };
  }
  return { tab: "changes", view: { kind: "repository" } };
}

/** Short, content-free text for the host status item. */
export function statusText(model: PluginSourceControlViewModel): string {
  const { repository } = model;
  if (repository.busy) {
    return `Git: ${repository.busyMessage ?? "working"}`;
  }
  if (repository.label.endsWith(UNREFRESHED_LABEL)) {
    return "Git: refresh required";
  }
  if (!repository.initialized) {
    return "Git: no repository";
  }
  const changes = model.resourceGroups.reduce(
    (total, group) => total + group.resources.length,
    0,
  );
  const plural = changes === 1 ? "" : "s";
  return `Git: ${repository.branch ?? "detached"} · ${changes} change${plural}`;
}

function summary(
  scope: GitRepositoryScope,
  label: string,
  initialized: boolean,
): PluginSourceControlRepositorySummary {
  return {
    repositoryId: scope.repositoryId,
    label,
    initialized,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    latestCommit: null,
    busy: false,
  };
}

function idle(
  repository: PluginSourceControlRepositorySummary,
): PluginSourceControlRepositorySummary {
  return {
    repositoryId: repository.repositoryId,
    label: repository.label,
    initialized: repository.initialized,
    branch: repository.branch,
    upstream: repository.upstream,
    ahead: repository.ahead,
    behind: repository.behind,
    latestCommit: repository.latestCommit,
    busy: false,
  };
}

function resourceGroups(
  status: GitStatusReport,
): PluginSourceControlResourceGroup[] {
  const groups: PluginSourceControlResourceGroup[] = [
    { kind: "staged", label: "Staged changes", resources: status.staged },
    { kind: "unstaged", label: "Changes", resources: status.unstaged },
    { kind: "untracked", label: "Untracked", resources: status.untracked },
    { kind: "conflicted", label: "Conflicts", resources: status.conflicted },
  ];
  return groups.filter((group) => group.resources.length > 0);
}

function conflictEntries(
  status: GitStatusReport,
): PluginSourceControlConflictEntry[] {
  const oursLabel = status.branch ?? "Current branch";
  return status.conflicted.map((resource) => ({
    path: resource.path,
    status: "unmerged" as const,
    oursLabel,
    theirsLabel: "Incoming change",
    baseLabel: null,
  }));
}

function folderName(rootPath: string): string {
  const segments = rootPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}
