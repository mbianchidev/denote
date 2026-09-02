import type {
  PluginProjectContext,
  PluginSourceControlAdvancedOperation,
  PluginSourceControlAuthMode,
  PluginSourceControlConflictDetail,
  PluginSourceControlBranchChoice,
  PluginSourceControlCommitDetail,
  PluginSourceControlConflictEntry,
  PluginSourceControlDiffFile,
  PluginSourceControlDiffSource,
  PluginSourceControlHistoryEntry,
  PluginSourceControlHistoryPage,
  PluginSourceControlOperationPlan,
  PluginSourceControlOperationProgress,
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

/** How many commits one history page holds. */
export const HISTORY_PAGE_SIZE = 20;

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
  historyPage: PluginSourceControlHistoryPage;
  commitDetail: PluginSourceControlCommitDetail | null;
  diffFiles: PluginSourceControlDiffFile[];
  diffSource: PluginSourceControlDiffSource | null;
  conflicts: PluginSourceControlConflictEntry[];
  conflictDetail: PluginSourceControlConflictDetail | null;
  operationProgress: PluginSourceControlOperationProgress | null;
  operationPlan: PluginSourceControlOperationPlan | null;
  recovery: PluginSourceControlRecoveryState;
  remoteAccess: PluginSourceControlRemoteAccess;
  pendingBranchSwitch: PluginSourceControlPendingBranchSwitch | null;
}

/** The page state of a provider that has not read any history yet. */
export function emptyHistoryPage(): PluginSourceControlHistoryPage {
  return {
    pageIndex: 0,
    pageSize: HISTORY_PAGE_SIZE,
    hasPrevious: false,
    hasNext: false,
    loading: false,
    error: null,
  };
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
      historyPage: emptyHistoryPage(),
      commitDetail: null,
      diffFiles: [],
      diffSource: null,
      conflicts: [],
      conflictDetail: null,
      operationProgress: null,
      operationPlan: null,
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

/**
 * Builds one model from its data and its selection.
 *
 * Content that belongs to a view is dropped whenever the selection is not that
 * view, so a model can never carry a diff, a commit, or a conflict editor that
 * nothing on screen names.
 */
export function compose(
  base: GitModelBase,
  selection: GitSelection,
): PluginSourceControlViewModel {
  const shared = pruned(base, selection);
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
    historyPage: model.historyPage,
    commitDetail: model.commitDetail,
    diffFiles: model.diffFiles,
    diffSource: model.diffSource,
    conflicts: model.conflicts,
    conflictDetail: model.conflictDetail,
    operationProgress: model.operationProgress,
    operationPlan: model.operationPlan,
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

/**
 * Publishes an advanced operation that has been prepared and not run, or
 * clears one. A review never carries progress state, so the surface it
 * replaces is the last settled one.
 */
export function withOperationPlan(
  model: PluginSourceControlViewModel,
  operationPlan: PluginSourceControlOperationPlan | null,
): PluginSourceControlViewModel {
  return compose(
    {
      ...baseOf(model),
      repository: idle(model.repository),
      operationPlan,
    },
    selectionOf(model),
  );
}

/**
 * Publishes the conflicted path a surface has open.
 *
 * The selection moves with it, so the model never carries a conflict editor
 * for a path nothing on screen names.
 */
export function withConflictDetail(
  model: PluginSourceControlViewModel,
  conflictDetail: PluginSourceControlConflictDetail,
): PluginSourceControlViewModel {
  return compose(
    {
      ...baseOf(model),
      repository: conflictDetail.loading
        ? model.repository
        : idle(model.repository),
      conflictDetail,
      // A conflict is not a diff: the working tree copy holds Git's markers,
      // which Denote never renders as content.
      diffFiles: [],
      diffSource: null,
    },
    { tab: "changes", view: { kind: "conflict", path: conflictDetail.path } },
  );
}

/** Closes the conflict editor, dropping every side it had read. */
export function withoutConflictDetail(
  model: PluginSourceControlViewModel,
): PluginSourceControlViewModel {
  return compose(
    { ...baseOf(model), conflictDetail: null },
    { tab: "changes", view: { kind: "repository" } },
  );
}

/** Replaces the diff content a model reports, keeping everything else. */
export function withDiffFiles(
  model: PluginSourceControlViewModel,
  diffFiles: PluginSourceControlDiffFile[],
  selection: GitSelection,
  diffSource: PluginSourceControlDiffSource | null = null,
): PluginSourceControlViewModel {
  const base = { ...baseOf(model), diffFiles, diffSource };
  return compose(
    { ...base, resourceGroups: countedGroups(base.resourceGroups, diffFiles) },
    selection,
  );
}

/**
 * Publishes one page of history, and the selection it leaves behind.
 *
 * A page replaces the commits on screen wholesale, so a commit that is no
 * longer in it stops being the selection: nothing is ever labelled with a
 * commit whose content the model does not hold.
 */
export function withHistoryPage(
  model: PluginSourceControlViewModel,
  history: PluginSourceControlHistoryEntry[],
  historyPage: PluginSourceControlHistoryPage,
): PluginSourceControlViewModel {
  const base: GitModelBase = {
    ...baseOf(model),
    repository: idle(model.repository),
    history,
    historyPage,
  };
  const selection = resolveSelection(
    {
      tab: "history",
      view:
        model.selectedTab === "history"
          ? model.selectedView
          : { kind: "history" },
    },
    base,
  );
  return compose(pruned(base, selection), selection);
}

/** Reports that a history read is running, or why the last one stopped. */
export function withHistoryStatus(
  model: PluginSourceControlViewModel,
  status: { loading: boolean; error?: string | null },
): PluginSourceControlViewModel {
  return compose(
    {
      ...baseOf(model),
      historyPage: {
        ...model.historyPage,
        loading: status.loading,
        error: status.error === undefined ? model.historyPage.error : status.error,
      },
    },
    selectionOf(model),
  );
}

/** Publishes one selected commit, its exact diff, and the selection for it. */
export function withCommitDetail(
  model: PluginSourceControlViewModel,
  detail: PluginSourceControlCommitDetail,
): PluginSourceControlViewModel {
  return compose(
    {
      ...baseOf(model),
      repository: idle(model.repository),
      commitDetail: detail,
      // History content is never the working tree's, so the diff a Changes
      // selection was showing is dropped rather than left under a commit.
      diffFiles: [],
      diffSource: { kind: "commit", commitId: detail.commit.id },
      historyPage: { ...model.historyPage, loading: false, error: null },
    },
    { tab: "history", view: { kind: "commit", commitId: detail.commit.id } },
  );
}

/** Returns to the history list, dropping whatever commit was open. */
export function withoutCommitDetail(
  model: PluginSourceControlViewModel,
): PluginSourceControlViewModel {
  return compose(
    {
      ...baseOf(model),
      commitDetail: null,
      diffFiles: [],
      diffSource: null,
    },
    { tab: "history", view: { kind: "history" } },
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

/**
 * Moves to another view, dropping content the new one cannot describe.
 *
 * Diff and commit content belongs to exactly one selection, so leaving that
 * selection clears it rather than leaving a stale diff behind for the next
 * view to show.
 */
export function withSelection(
  model: PluginSourceControlViewModel,
  selection: GitSelection,
): PluginSourceControlViewModel {
  return compose(pruned(baseOf(model), selection), selection);
}

export interface GitRefreshData {
  status: GitStatusReport;
  branches: PluginSourceControlBranchChoice[];
  remotes: PluginSourceControlRemote[];
  history: PluginSourceControlHistoryEntry[];
  historyPage: PluginSourceControlHistoryPage;
  /** The selected commit and its diff, when one is open. */
  commitDetail: PluginSourceControlCommitDetail | null;
  /** Diff content read for the selected path, when one is open. */
  diffFiles: PluginSourceControlDiffFile[];
  diffSource: PluginSourceControlDiffSource | null;
  /** The conflict a surface has open, when it still exists. */
  conflictDetail: PluginSourceControlConflictDetail | null;
  /** The operation Git reports is in progress, when there is one. */
  operationProgress: PluginSourceControlOperationProgress | null;
  /** An advanced operation waiting for review, when one is waiting. */
  operationPlan: PluginSourceControlOperationPlan | null;
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
      // The newest commit of the first page is the repository's newest commit,
      // so a later page never renames what the summary calls the latest one.
      latestCommit:
        latest && data.historyPage.pageIndex === 0
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
    historyPage: data.historyPage,
    commitDetail: data.commitDetail,
    diffFiles: data.diffFiles,
    diffSource: data.diffSource,
    conflicts: conflictEntries(
      data.status,
      data.operationProgress?.operation ?? null,
    ),
    conflictDetail: data.conflictDetail,
    operationProgress: data.operationProgress,
    operationPlan: data.operationPlan,
    recovery: data.recovery,
    remoteAccess: data.remoteAccess,
    pendingBranchSwitch: data.pendingBranchSwitch,
  };
  const resolved = resolveSelection(selection, base);
  return compose(pruned(base, resolved), resolved);
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
      historyPage: emptyHistoryPage(),
      commitDetail: null,
      diffFiles: [],
      diffSource: null,
      conflicts: [],
      conflictDetail: null,
      operationProgress: null,
      operationPlan: null,
      recovery: { state: "idle" },
      remoteAccess,
      pendingBranchSwitch: null,
    },
    { tab: "changes", view: { kind: "repository" } },
  );
}

/**
 * Drops diff, commit, and conflict content the selection cannot display.
 *
 * Only three views hold content of their own: an open file diff, an open
 * commit, and an open conflict. Everything else clears them, so a diff read
 * for the working tree is never left behind under a commit, a commit's files
 * never survive a return to the Changes tab, and a conflict editor never
 * survives moving to a different path.
 */
export function pruned(
  base: GitModelBase,
  selection: GitSelection,
): GitModelBase {
  const showsFileDiff =
    selection.tab === "changes" && selection.view.kind === "diff";
  const showsCommit =
    selection.tab === "history" && selection.view.kind === "commit";
  const conflictPath =
    selection.tab === "changes" && selection.view.kind === "conflict"
      ? selection.view.path
      : null;
  return {
    ...base,
    commitDetail: showsCommit ? base.commitDetail : null,
    diffFiles: showsFileDiff ? base.diffFiles : [],
    diffSource: showsFileDiff || showsCommit ? base.diffSource : null,
    conflictDetail:
      base.conflictDetail && base.conflictDetail.path === conflictPath
        ? base.conflictDetail
        : null,
  };
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

/**
 * Names the two sides of every conflicted path.
 *
 * Which side is which depends on the operation Git is running: a rebase and a
 * cherry-pick replay a commit onto the branch, so "ours" is what the branch
 * already held and "theirs" is the commit being replayed. Saying that plainly
 * is what stops a user choosing the wrong side because a label assumed a
 * merge.
 */
function conflictEntries(
  status: GitStatusReport,
  operation: PluginSourceControlAdvancedOperation | null,
): PluginSourceControlConflictEntry[] {
  const labels = conflictSideLabels(status.branch, operation);
  return status.conflicted.map((resource) => ({
    path: resource.path,
    status: "unmerged" as const,
    oursLabel: labels.ours,
    theirsLabel: labels.theirs,
    baseLabel: labels.base,
  }));
}

/** The three side labels for one operation, or for an unknown one. */
export function conflictSideLabels(
  branch: string | null,
  operation: PluginSourceControlAdvancedOperation | null,
): { base: string; ours: string; theirs: string } {
  const current = branch ?? "the current branch";
  const base = "Common ancestor";
  switch (operation) {
    case "rebase":
      return {
        base,
        ours: `Commits already on ${current}`,
        theirs: "The commit being replayed",
      };
    case "cherry-pick":
      return {
        base,
        ours: `${current} as it is now`,
        theirs: "The commit being cherry-picked",
      };
    case "revert":
      return {
        base,
        ours: `${current} as it is now`,
        theirs: "The reversal of the commit",
      };
    case "merge":
      return { base, ours: current, theirs: "The branch being merged in" };
    default:
      return { base, ours: current, theirs: "Incoming change" };
  }
}

function folderName(rootPath: string): string {
  const segments = rootPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}
