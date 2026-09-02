import type {
  PluginProjectContext,
  PluginSourceControlAuthMode,
  PluginSourceControlBranchChoice,
  PluginSourceControlConflictEntry,
  PluginSourceControlDiffFile,
  PluginSourceControlHistoryEntry,
  PluginSourceControlOperationReview,
  PluginSourceControlPendingBranchSwitch,
  PluginSourceControlRecoveryState,
  PluginSourceControlRemote,
  PluginSourceControlRemoteAccess,
  PluginSourceControlRepositorySummary,
  PluginSourceControlResource,
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
  diffFiles: PluginSourceControlDiffFile[];
  conflicts: PluginSourceControlConflictEntry[];
  recovery: PluginSourceControlRecoveryState;
  remoteAccess: PluginSourceControlRemoteAccess;
  pendingBranchSwitch: PluginSourceControlPendingBranchSwitch | null;
}

/**
 * Remote and clone state before anything has been read or attempted.
 *
 * Cloning is always offered, because it does not depend on the current scope
 * having a repository. GitHub browsing is offered only when the user selected
 * GitHub sign-in, so no adapter is consulted unless it was asked for.
 */
export function initialRemoteAccess(
  authMode: PluginSourceControlAuthMode = "public",
): PluginSourceControlRemoteAccess {
  return {
    authMode,
    cloneAvailable: true,
    githubAvailable: authMode === "github-https",
    repositories: [],
    cleanup: null,
    review: null,
  };
}

export function withRemoteAccess(
  model: PluginSourceControlViewModel,
  remoteAccess: PluginSourceControlRemoteAccess,
): PluginSourceControlViewModel {
  return compose({ ...baseOf(model), remoteAccess }, selectionOf(model));
}

/** Records the outcome of the last remote operation for review. */
export function withReview(
  model: PluginSourceControlViewModel,
  review: PluginSourceControlOperationReview | null,
): PluginSourceControlViewModel {
  return withRemoteAccess(model, { ...model.remoteAccess, review });
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
  remoteAccess: PluginSourceControlRemoteAccess = initialRemoteAccess(),
): PluginSourceControlViewModel {
  return compose(
    {
      repository: summary(scope, `${scope.name} · ${UNREFRESHED_LABEL}`, false),
      resourceGroups: [],
      branches: [],
      remotes: [],
      history: [],
      diffFiles: [],
      conflicts: [],
      recovery: { state: "idle" },
      pendingBranchSwitch: null,
      // Remote and clone state survives a scope change: it describes how the
      // user signs in and what a failed clone left behind, neither of which
      // belongs to the repository that was open.
      remoteAccess,
    },
    { tab: "changes", view: { kind: "repository" } },
  );
}

export function compose(
  base: GitModelBase,
  selection: GitSelection,
): PluginSourceControlViewModel {
  const shared = { ...base };
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
    diffFiles: model.diffFiles,
    conflicts: model.conflicts,
    recovery: model.recovery,
    remoteAccess: model.remoteAccess,
    pendingBranchSwitch: model.pendingBranchSwitch,
  };
}

/**
 * Publishes a checkout that is waiting for an explicit answer, or clears one.
 * A pending review never carries progress state, so the surface it replaces is
 * the last settled one.
 */
export function withPendingBranchSwitch(
  model: PluginSourceControlViewModel,
  pendingBranchSwitch: PluginSourceControlPendingBranchSwitch | null,
): PluginSourceControlViewModel {
  return compose(
    {
      ...baseOf(model),
      repository: idle(model.repository),
      pendingBranchSwitch,
    },
    selectionOf(model),
  );
}

/** Replaces the diff content a model reports, keeping everything else. */
export function withDiffFiles(
  model: PluginSourceControlViewModel,
  diffFiles: PluginSourceControlDiffFile[],
  selection: GitSelection,
): PluginSourceControlViewModel {
  const base = { ...baseOf(model), diffFiles };
  return compose(
    { ...base, resourceGroups: countedGroups(base.resourceGroups, diffFiles) },
    selection,
  );
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
  /** Diff content read for the selected path, when one is open. */
  diffFiles: PluginSourceControlDiffFile[];
  recovery: PluginSourceControlRecoveryState;
  remoteAccess: PluginSourceControlRemoteAccess;
  pendingBranchSwitch: PluginSourceControlPendingBranchSwitch | null;
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
    resourceGroups: countedGroups(resourceGroups(data.status), data.diffFiles),
    branches: data.branches,
    remotes: data.remotes,
    history: data.history,
    diffFiles: data.diffFiles,
    conflicts: conflictEntries(data.status),
    recovery: data.recovery,
    remoteAccess: data.remoteAccess,
    pendingBranchSwitch: data.pendingBranchSwitch,
  };
  return compose(base, resolveSelection(selection, base));
}

/** Builds the model for a scope Git reports is not a repository yet. */
export function uninitializedModel(
  scope: GitRepositoryScope,
  remoteAccess: PluginSourceControlRemoteAccess = initialRemoteAccess(),
): PluginSourceControlViewModel {
  return compose(
    {
      repository: summary(scope, scope.name, false),
      resourceGroups: [],
      branches: [],
      remotes: [],
      history: [],
      diffFiles: [],
      conflicts: [],
      recovery: { state: "idle" },
      remoteAccess,
      pendingBranchSwitch: null,
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
  // A diff selection survives only while the model still holds that file's
  // parsed content, so a surface never labels an empty panel with a path.
  if (
    view.kind === "diff" &&
    base.diffFiles.some((file) => file.path === view.path)
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

/**
 * Fills in the line counts a status report cannot give.
 *
 * `git status` reports which files changed, never by how much, so a row shows
 * zeros until a diff for that exact path has been read. Counts are applied
 * only for paths the parsed diff actually covers; nothing is estimated.
 */
function countedGroups(
  groups: PluginSourceControlResourceGroup[],
  diffFiles: PluginSourceControlDiffFile[],
): PluginSourceControlResourceGroup[] {
  if (diffFiles.length === 0) {
    return groups;
  }
  const counts = new Map<string, PluginSourceControlDiffFile>();
  for (const file of diffFiles) {
    counts.set(file.path, file);
  }
  return groups.map((group) => ({
    ...group,
    resources: group.resources.map((resource) =>
      counted(resource, counts.get(resource.path)),
    ),
  }));
}

function counted(
  resource: PluginSourceControlResource,
  file: PluginSourceControlDiffFile | undefined,
): PluginSourceControlResource {
  if (!file) {
    return resource;
  }
  return {
    ...resource,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
  };
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
