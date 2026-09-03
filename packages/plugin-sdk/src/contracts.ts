export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;
export const PLUGIN_API_VERSION = 1 as const;

export const PLUGIN_CATEGORIES = [
  "code",
  "productivity",
  "knowledge-management",
  "editor-writing",
  "diagrams-visualization",
  "collaboration",
  "accessibility",
  "security-privacy",
  "other",
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export const PLUGIN_CAPABILITIES = [
  "commands",
  "sidebar",
  "status",
  "editor-decoration",
  "note-events",
  "project-context",
  "source-control",
  "automatic-local-commit",
  "git",
  "workspace-read",
  "workspace-write",
  "network",
  "clipboard-read",
  "clipboard-write",
  "notifications",
  "process",
  "secure-storage",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export type PluginPermissionRequest =
  | {
      capability: Exclude<PluginCapability, "network" | "process">;
    }
  | {
      capability: "network";
      hosts: string[];
    }
  | {
      capability: "process";
      executables: {
        macos?: string[];
        linux?: string[];
        windows?: string[];
      };
    };

export interface PluginPublisher {
  name: string;
  url?: string;
}

export interface PluginCompatibility {
  apiVersion: number;
  minimumDenoteVersion: string;
  maximumDenoteVersion?: string;
}

interface PluginSettingBase {
  title: string;
  description?: string;
}

export interface PluginBooleanSetting extends PluginSettingBase {
  type: "boolean";
  default: boolean;
}

export interface PluginStringSetting extends PluginSettingBase {
  type: "string";
  default: string;
  sensitive?: boolean;
}

export interface PluginNumberSetting extends PluginSettingBase {
  type: "number";
  default: number;
  minimum?: number;
  maximum?: number;
}

export interface PluginSelectSetting extends PluginSettingBase {
  type: "select";
  default: string;
  options: Array<{
    value: string;
    label: string;
  }>;
}

export type PluginSettingDefinition =
  | PluginBooleanSetting
  | PluginStringSetting
  | PluginNumberSetting
  | PluginSelectSetting;

export interface PluginSettingsMigration {
  from: number;
  to: number;
  rename?: Record<string, string>;
  remove?: string[];
  defaults?: Record<string, unknown>;
}

export interface PluginSettingsSchema {
  version: number;
  properties: Record<string, PluginSettingDefinition>;
  migrations?: PluginSettingsMigration[];
}

export interface PluginManifest {
  schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: PluginPublisher;
  license: string;
  repository: string;
  homepage?: string;
  icon: string;
  category: PluginCategory;
  compatibility: PluginCompatibility;
  permissions: PluginPermissionRequest[];
  entrypoint: string;
  documentation: string;
  settings?: PluginSettingsSchema;
}

export interface PluginArtifact {
  url: string;
  sha256: string;
  sizeBytes: number;
}

export interface PluginProvenance {
  publisherId: string;
  sourceCommit: string;
  trusted: boolean;
}

export interface PluginRevocation {
  reason: string;
  revokedAt: string;
}

export interface PluginBundleRole {
  id: string;
  name: string;
  candidatePluginIds: string[];
}

export interface PluginBundle {
  id: string;
  name: string;
  categories: PluginCategory[];
  roles: PluginBundleRole[];
}

export interface PluginCatalogEntry {
  manifest: PluginManifest;
  artifact: PluginArtifact;
  provenance: PluginProvenance;
  revoked?: PluginRevocation;
  guide: string;
}

export type PluginInstallState = "downloading" | "verifying" | "installing";

export type PluginLifecycleState =
  | "not-installed"
  | PluginInstallState
  | "enabled"
  | "disabling"
  | "disabled"
  | "update-available"
  | "incompatible"
  | "failed";

export const PLUGIN_GUIDE_SECTIONS = [
  "purpose",
  "enablement and permissions",
  "usage",
  "settings",
  "disable behavior",
  "troubleshooting",
] as const;

export interface PluginDisposable {
  dispose: () => void | Promise<void>;
}

export interface PluginSubscriptions {
  add: (disposable: PluginDisposable) => void;
}

export interface PluginLogger {
  debug: (message: string, details?: Record<string, unknown>) => void;
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
}

export interface PluginStorage {
  get: <T>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

export interface PluginSettings {
  getAll: () => Promise<Record<string, unknown>>;
}

export interface PluginSecureStorage {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export interface PluginCommand {
  id: string;
  title: string;
  run: (context: PluginUserActionContext) => void | Promise<void>;
}

export interface PluginCommandCapability {
  register: (command: PluginCommand) => PluginDisposable;
}

export interface PluginSidebarView {
  id: string;
  title: string;
  content: string;
}

export interface PluginSidebarCapability {
  register: (view: PluginSidebarView) => PluginDisposable;
}

export interface PluginStatusItem {
  id: string;
  text: string;
}

export interface PluginStatusCapability {
  register: (item: PluginStatusItem) => PluginDisposable;
}

export interface PluginEditorDecoration {
  id: string;
  pattern: string;
  style: "highlight" | "warning" | "muted";
  caseSensitive?: boolean;
}

export interface PluginEditorDecorationCapability {
  register: (decoration: PluginEditorDecoration) => PluginDisposable;
}

export interface PluginNoteEvent {
  path: string;
  kind: "opened" | "changed" | "saved" | "closed";
}

export interface PluginNoteEventsCapability {
  subscribe: (
    listener: (event: PluginNoteEvent) => void | Promise<void>,
  ) => PluginDisposable;
}

export interface PluginProjectContext {
  projectId: string;
  rootPath: string;
}

export interface PluginProjectContextChangeEvent {
  previous: PluginProjectContext | null;
  current: PluginProjectContext | null;
  repositories?: PluginProjectRepositoryContext[];
  /**
   * True when the host switched to a different workspace, which invalidates
   * everything a plugin read from the previous one. It is reported even when
   * `previous` and `current` are both null, because a workspace without a
   * project still changes the repository behind every path a plugin can reach.
   * The workspace itself is never identified: only the fact that it changed.
   */
  workspaceChanged: boolean;
}

/**
 * One repository the host found at the vault root or at a configured project
 * root. The opaque IDs can target typed Git operations; no filesystem path is
 * exposed for inactive repositories.
 */
export interface PluginProjectRepositoryContext {
  repositoryId: string;
  projectId: string | null;
  label: string;
}

export interface PluginProjectContextCapability {
  getCurrent: () => PluginProjectContext | null;
  getRepositories: () => PluginProjectRepositoryContext[];
  subscribe: (
    listener: (
      event: PluginProjectContextChangeEvent,
    ) => void | Promise<void>,
  ) => PluginDisposable;
}

export interface PluginSourceControlCommitSummary {
  id: string;
  shortId: string;
  summary: string;
  authorName: string;
  authoredAt: string;
}

export interface PluginSourceControlRepositorySummary {
  repositoryId: string;
  label: string;
  initialized: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  latestCommit: PluginSourceControlCommitSummary | null;
  busy: boolean;
  busyMessage?: string;
  /**
   * Identifies the operation a busy provider is running, so the host can offer
   * a cancel control that returns the exact ID to the provider.
   */
  activeOperationId?: string;
}

export interface PluginSourceControlWorkspaceRepository {
  repositoryId: string;
  label: string;
  selected: boolean;
  initialized: boolean;
  branch: string | null;
  changes: number;
}

export type PluginSourceControlResourceGroupKind =
  | "staged"
  | "unstaged"
  | "untracked"
  | "conflicted"
  | "ignored";

export type PluginSourceControlResourceStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

export interface PluginSourceControlResource {
  path: string;
  status: PluginSourceControlResourceStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface PluginSourceControlResourceGroup {
  kind: PluginSourceControlResourceGroupKind;
  label: string;
  resources: PluginSourceControlResource[];
}

export interface PluginSourceControlBranchChoice {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface PluginSourceControlRemote {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
}

export interface PluginSourceControlHistoryEntry
  extends PluginSourceControlCommitSummary {
  parentIds: string[];
  refs: string[];
}

/**
 * Where the commits a model carries sit in the repository's log.
 *
 * History is always read one bounded page at a time, so a surface describes
 * the page it holds rather than the size of the log: `hasNext` is what the
 * provider learned by asking for one commit beyond the page, and nothing here
 * implies a total count that was never counted.
 */
export interface PluginSourceControlHistoryPage {
  /** Zero-based index of the page the model carries. */
  pageIndex: number;
  /** How many commits one page holds. */
  pageSize: number;
  /** True while an earlier, newer page exists. */
  hasPrevious: boolean;
  /** True while a later, older page exists. */
  hasNext: boolean;
  /** True while a history page or a commit is being read. */
  loading: boolean;
  /** Why the last history read stopped, or null when it succeeded. */
  error: string | null;
}

/**
 * One commit the user selected, with the exact diff Git reported for it.
 *
 * The commit fields are the ones the history page already carried, so nothing
 * about a commit is re-derived; `files` is the structured diff, and
 * `limitation` says why a diff is not the plain one-parent comparison, such as
 * a merge commit compared with its first parent.
 */
export interface PluginSourceControlCommitDetail {
  commit: PluginSourceControlHistoryEntry;
  files: PluginSourceControlDiffFile[];
  limitation: string | null;
}

/**
 * Which comparison produced the diff a model carries.
 *
 * A surface may only offer a hunk action for `worktree` and `index`, because
 * those are the two directions the host can apply one hunk in. A commit diff
 * is history: it is read-only, and no hunk action applies to it.
 */
export type PluginSourceControlDiffSource =
  | { kind: "worktree" }
  | { kind: "index" }
  | { kind: "commit"; commitId: string };

export type PluginSourceControlDiffLineKind =
  | "context"
  | "addition"
  | "deletion";

export interface PluginSourceControlDiffLine {
  kind: PluginSourceControlDiffLineKind;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
  /**
   * True when Git reported "\ No newline at end of file" straight after this
   * line. It is carried so a hunk can be restaged exactly as it was read.
   */
  noNewlineAtEndOfFile?: boolean;
}

export interface PluginSourceControlDiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PluginSourceControlDiffLine[];
}

export interface PluginSourceControlDiffFile {
  path: string;
  previousPath: string | null;
  status: PluginSourceControlResourceStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: PluginSourceControlDiffHunk[];
}

export interface PluginSourceControlConflictEntry {
  path: string;
  status: PluginSourceControlResourceStatus;
  oursLabel: string;
  theirsLabel: string;
  baseLabel: string | null;
}

/** One operation that replays, combines, or reverses commits. */
export type PluginSourceControlAdvancedOperation =
  | "merge"
  | "rebase"
  | "cherry-pick"
  | "revert";

/**
 * What an advanced operation can disturb, decided from the operation itself
 * rather than from anything a surface renders.
 */
export type PluginSourceControlOperationRisk =
  | "creates-commit"
  | "may-conflict"
  | "rewrites-history";

/**
 * One advanced operation that has been prepared and not run.
 *
 * It names the exact source, the branch it would change, what it risks, and
 * the files it is expected to touch, so the operation on screen is reviewed
 * before anything in the repository moves. Nothing here starts on its own: a
 * refresh, an activation, or a restart only ever publishes the review.
 *
 * A review describes one comparison, read from one branch at one commit, so it
 * stops being valid as soon as either moves. A provider is expected to publish
 * `null` instead of a review it would no longer run, and the branch it names
 * travels with the action a surface returns, so a host confirmation names the
 * exact branch that changes.
 */
export interface PluginSourceControlOperationPlan {
  operation: PluginSourceControlAdvancedOperation;
  /** The branch, ref, or commit the operation reads from. */
  source: string;
  /** How Git described the source, such as a commit summary. */
  sourceDetail: string | null;
  /** The branch the operation changes, when the repository is on one. */
  currentBranch: string | null;
  risk: PluginSourceControlOperationRisk;
  summary: string;
  /** Bounded repository-relative paths the operation is expected to touch. */
  affectedPaths: string[];
  /** Why that list is partial or absent. Null while it is exact. */
  affectedPathsLimitation: string | null;
  startActionId: string;
  cancelActionId: string;
}

/**
 * An operation Git reports is in progress, and only the controls that are
 * valid for it.
 *
 * A merge cannot be skipped, so it never offers one. Continue is offered only
 * while Git reports no unmerged paths; until then the reason is stated instead
 * of leaving a control that would fail.
 */
export interface PluginSourceControlOperationProgress {
  operation: PluginSourceControlAdvancedOperation;
  summary: string;
  /** Repository-relative paths Git still reports as unmerged. */
  conflictedPaths: string[];
  continueAvailable: boolean;
  /** Why Continue is unavailable. Null while it is offered. */
  continueUnavailableReason: string | null;
  skipAvailable: boolean;
  abortAvailable: boolean;
}

/** Which recorded side of a conflict a choice or a pane refers to. */
export type PluginSourceControlConflictSideKind = "base" | "ours" | "theirs";

/**
 * One recorded side of a conflicted path.
 *
 * `present` is what Git holds: an added/added conflict has no base, and a
 * delete/modify conflict is missing one of the other two. A stage that is
 * absent is reported as absent rather than shown as empty content that the
 * repository does not contain. `text` is the exact UTF-8 of the stage, and is
 * null whenever the content is binary, encrypted, absent, or too large to
 * read.
 */
export interface PluginSourceControlConflictSide {
  side: PluginSourceControlConflictSideKind;
  label: string;
  present: boolean;
  text: string | null;
  byteLength: number;
}

export type PluginSourceControlConflictChunkKind =
  | "stable"
  | "resolved"
  | "conflict";

/**
 * One region of a three-way merge.
 *
 * `stable` is text every side holds, `resolved` is a change Denote could take
 * without asking, and `conflict` carries all three sides with no answer until
 * the user makes one. Every line of every side belongs to exactly one chunk,
 * so nothing a side holds is ever dropped from the model.
 */
export interface PluginSourceControlConflictChunk {
  id: string;
  kind: PluginSourceControlConflictChunkKind;
  base: string[];
  ours: string[];
  theirs: string[];
  /** Which side supplies the chunk's lines, or null while unanswered. */
  choice: PluginSourceControlConflictSideKind | null;
  /** True when the merge chose the side, false when the user did. */
  automatic: boolean;
}

/**
 * The conflicted path a surface has open.
 *
 * Everything here was read from the index for exactly this path: nothing is
 * derived from conflict markers in the working tree, because a note may
 * legitimately contain them. Binary and encrypted conflicts never carry line
 * content at all, and are resolved by choosing a whole recorded side.
 */
export interface PluginSourceControlConflictDetail {
  path: string;
  /** The operation the conflict belongs to, when Git reports one. */
  operation: PluginSourceControlAdvancedOperation | null;
  binary: boolean;
  encrypted: boolean;
  base: PluginSourceControlConflictSide;
  ours: PluginSourceControlConflictSide;
  theirs: PluginSourceControlConflictSide;
  /** The three-way chunks, or empty when no line content may be shown. */
  chunks: PluginSourceControlConflictChunk[];
  /** The editable merged result, or null when there is no text to edit. */
  result: string | null;
  /** True while the result differs from the merge Denote last derived. */
  unsavedResult: boolean;
  /** How many chunks still need an answer. */
  unresolvedChunks: number;
  /** True while only a whole recorded side may be chosen. */
  wholeSideOnly: boolean;
  /** Why line content is unavailable. Null while the editor is complete. */
  limitation: string | null;
  /** What the editor is doing, or what it last did. */
  status: string | null;
  /** Why the last read or resolution stopped. Null while it succeeded. */
  error: string | null;
  loading: boolean;
}

/**
 * How a remote operation authenticates.
 *
 * `public` is an unauthenticated HTTPS remote, `ssh-agent` is an SSH remote
 * served by an already-running agent, and `github-https` asks the host's own
 * GitHub adapter for credentials. A plugin only ever names the mode: no token,
 * key, or credential of any kind passes through it.
 */
export type PluginSourceControlAuthMode =
  | "system"
  | "public"
  | "ssh-agent"
  | "github-https";

/**
 * One repository the host's GitHub adapter offered for selection. Only this
 * bounded metadata crosses into a plugin; the token that produced it never
 * leaves the native host.
 */
export interface PluginSourceControlRepositoryChoice {
  nameWithOwner: string;
  httpsUrl: string;
  sshUrl: string;
  defaultBranch: string | null;
  private: boolean;
}

/**
 * A clone that failed and left a destination behind. The token is opaque and
 * host-owned: it names nothing on disk, is bound to the exact failed
 * destination, and can only be spent once, on an explicit dangerous
 * confirmation.
 */
export interface PluginSourceControlCloneCleanup {
  token: string;
  /** Host-redacted description of the destination, safe to display. */
  label: string;
}

/** The last remote operation, kept on screen so the user can review it. */
export interface PluginSourceControlOperationReview {
  operation: string;
  outcome: "succeeded" | "failed" | "cancelled";
  summary: string;
  detail: string | null;
  retryActionId?: string;
}

/**
 * Everything the host needs to render remote and clone controls. The provider
 * describes state only; the host owns every confirmation, the folder chooser,
 * and the credentials.
 */
export interface PluginSourceControlRemoteAccess {
  /**
   * The authentication mode that is configured for this plugin in Settings.
   *
   * It is reported so a surface can show what every remote operation will
   * use. It is not a control: the value is host-persisted, so it is changed in
   * Settings and never by an action.
   */
  authMode: PluginSourceControlAuthMode;
  /** True while the provider can start clone onboarding. */
  cloneAvailable: boolean;
  /** True when the host's GitHub adapter is configured for browsing. */
  githubAvailable: boolean;
  repositories: PluginSourceControlRepositoryChoice[];
  cleanup: PluginSourceControlCloneCleanup | null;
  review: PluginSourceControlOperationReview | null;
}

/**
 * Which prepared operation a pending review belongs to. It is one of the typed
 * operations Denote can run, so a host confirmation names what will run rather
 * than repeating a label a provider supplied.
 */
export type PluginSourceControlPendingOperation =
  | "checkout"
  | PluginSourceControlAdvancedOperation;

/**
 * One checkout, or one advanced operation, that has been prepared but not run,
 * because the working tree holds changes it could block or alter.
 *
 * The provider publishes it instead of running the operation, so the user
 * chooses explicitly what happens to that work. Nothing here discards
 * anything: the only offers are to commit the listed paths, to stash them, or
 * to cancel.
 */
export interface PluginSourceControlPendingBranchSwitch {
  /**
   * Which operation is waiting. It is the typed operation, never a label, so
   * the host confirms what will actually run.
   */
  operation: PluginSourceControlPendingOperation;
  /** The exact ref the user asked to check out, merge, replay, or reverse. */
  target: string;
  /**
   * The local branch a remote-tracking checkout will create, or null when the
   * target is already a local branch.
   */
  localBranch: string | null;
  /** The branch the checkout would leave, when there is one. */
  fromBranch: string | null;
  /** Repository-relative paths, exactly as the last refresh reported them. */
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
  /** True while committing every listed path is offered. */
  commitAvailable: boolean;
  /** True while stashing every listed path is offered. */
  stashAvailable: boolean;
  /**
   * Why stashing is not offered. It is set only when `stashAvailable` is
   * false, so a surface can explain the limitation rather than hide it.
   */
  stashUnavailableReason: string | null;
  commitActionId: string;
  stashActionId: string;
  cancelActionId: string;
}

export type PluginSourceControlRecoveryState =
  | { state: "idle" }
  | {
      state: "running";
      operationId: string;
      message: string;
    }
  | {
      state: "failed";
      operationId: string;
      message: string;
      retryActionId?: string;
      dismissActionId?: string;
    };

interface PluginSourceControlViewModelBase {
  repository: PluginSourceControlRepositorySummary;
  workspaceRepositories?: PluginSourceControlWorkspaceRepository[];
  resourceGroups: PluginSourceControlResourceGroup[];
  branches: PluginSourceControlBranchChoice[];
  remotes: PluginSourceControlRemote[];
  history: PluginSourceControlHistoryEntry[];
  /** Where the commits in `history` sit in the log. */
  historyPage: PluginSourceControlHistoryPage;
  /** The selected commit and its exact diff, or null when none is selected. */
  commitDetail: PluginSourceControlCommitDetail | null;
  diffFiles: PluginSourceControlDiffFile[];
  /**
   * Which comparison produced `diffFiles`. Null whenever no diff is loaded, so
   * a surface never has to guess which side of the index it is looking at.
   */
  diffSource: PluginSourceControlDiffSource | null;
  conflicts: PluginSourceControlConflictEntry[];
  /**
   * The conflicted path a surface has open, with the three sides Git recorded
   * for it. Null whenever no conflict is open.
   */
  conflictDetail: PluginSourceControlConflictDetail | null;
  /**
   * The merge, rebase, cherry-pick, or revert Git reports is in progress, with
   * only the controls that are valid for it. Null while nothing is running.
   */
  operationProgress: PluginSourceControlOperationProgress | null;
  /**
   * An advanced operation that has been prepared for review and not started.
   * Null whenever nothing is waiting for an answer.
   */
  operationPlan: PluginSourceControlOperationPlan | null;
  recovery: PluginSourceControlRecoveryState;
  remoteAccess: PluginSourceControlRemoteAccess;
  /**
   * A checkout that is waiting for an explicit answer about the working tree
   * changes it would disturb. Null whenever no checkout is pending.
   */
  pendingBranchSwitch: PluginSourceControlPendingBranchSwitch | null;
}

export type PluginSourceControlViewModel =
  | (PluginSourceControlViewModelBase & {
      selectedTab: "changes";
      selectedView:
        | { kind: "repository" }
        | { kind: "diff"; path: string }
        | { kind: "conflict"; path: string };
    })
  | (PluginSourceControlViewModelBase & {
      selectedTab: "history";
      selectedView:
        | { kind: "history" }
        | { kind: "commit"; commitId: string }
        | { kind: "diff"; path: string; commitId: string };
    })
  | (PluginSourceControlViewModelBase & {
      selectedTab: "branches";
      selectedView: { kind: "branches" } | { kind: "remotes" };
    });

export interface PluginSourceControlAction {
  id: string;
  values?: Record<string, string | boolean | number>;
}

export interface PluginSourceControlProvider {
  id: string;
  title: string;
  initialModel: PluginSourceControlViewModel;
  runAction: (
    action: PluginSourceControlAction,
    context: PluginUserActionContext,
  ) => void | Promise<void>;
}

export interface PluginSourceControlRegistration extends PluginDisposable {
  update: (model: PluginSourceControlViewModel) => void;
}

export interface PluginSourceControlCapability {
  register: (
    provider: PluginSourceControlProvider,
  ) => PluginSourceControlRegistration;
}

/**
 * One standing automatic local commit. A plugin describes what should be
 * committed and how often; it never receives a vault path, a project ID, or a
 * Git capability for it. The host owns the timer, the repository scope, and
 * the commit itself.
 */
export interface PluginAutomaticLocalCommitSchedule {
  id: string;
  /** Whole minutes between runs. Must be greater than zero and bounded. */
  intervalMinutes: number;
  message: string;
  /**
   * Repository-relative path prefixes. An empty list means the whole
   * repository. Excludes always win over includes.
   */
  includePatterns?: string[];
  excludePatterns?: string[];
  /** Optional commit identity. Both halves are required together. */
  authorName?: string;
  authorEmail?: string;
}

export type PluginAutomaticLocalCommitUpdate = Omit<
  PluginAutomaticLocalCommitSchedule,
  "id"
>;

export interface PluginAutomaticLocalCommitRegistration
  extends PluginDisposable {
  /** Replaces every field except the ID, which identifies the schedule. */
  update: (schedule: PluginAutomaticLocalCommitUpdate) => void;
}

export interface PluginAutomaticLocalCommitCapability {
  register: (
    schedule: PluginAutomaticLocalCommitSchedule,
  ) => PluginAutomaticLocalCommitRegistration;
}

export interface PluginTextDocument {
  content: string;
  version: string;
}

/**
 * Git transport contract.
 *
 * Every request names one fixed operation with exact structured fields. The
 * host maps each operation to a fixed Git argument template, so plugins never
 * supply raw argument arrays, option flags, or shell input.
 */
export type PluginGitScope = "vault" | "project";

export type PluginGitSequencer = "merge" | "rebase" | "cherry-pick" | "revert";

export type PluginGitConflictStage = "base" | "ours" | "theirs";

export type PluginGitStashAction = "push" | "pop" | "apply" | "drop" | "list";

export type PluginGitPullStrategy =
  | "merge"
  | "rebase"
  | "fast-forward-only";

export type PluginGitPushMode = "normal" | "force-with-lease";

/**
 * How the host authenticates a remote operation. Only the mode crosses the
 * plugin boundary: the host resolves every credential itself and never returns
 * one.
 */
export type PluginGitAuthMode =
  | "system"
  | "public"
  | "ssh-agent"
  | "github-https";

/** A host-issued repository target for one typed Git request. */
export interface PluginGitRepositoryTarget {
  projectId: string | null;
}

export type PluginGitDiffTarget =
  | { kind: "worktree" }
  | { kind: "index" }
  | { kind: "commit"; commit: string }
  | { kind: "range"; fromCommit: string; toCommit: string };

export type PluginGitConflictResolution =
  | { kind: "stage"; stage: PluginGitConflictStage }
  | { kind: "content"; contentBase64: string };

export type PluginGitHunkLineKind = "context" | "addition" | "deletion";

/**
 * One line of one hunk. The content never carries its unified-diff prefix, a
 * line terminator, or any other control character: the host adds the prefix
 * and the newline when it reconstructs the patch, so a plugin cannot write a
 * diff header, a second hunk, or another path into a patch.
 */
export interface PluginGitHunkLine {
  kind: PluginGitHunkLineKind;
  content: string;
  /**
   * True when Git reported "\ No newline at end of file" straight after this
   * line. It is the only diff annotation a plugin can ask the host to emit.
   */
  noNewlineAtEndOfFile?: boolean;
}

/**
 * One hunk of one file, described structurally.
 *
 * A plugin never supplies patch text. It names the exact line range and the
 * exact lines, and the host reconstructs a bounded unified patch for one
 * validated path from them.
 */
export interface PluginGitHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PluginGitHunkLine[];
}

export type PluginGitRunRequest =
  | { operation: "discover"; scope: PluginGitScope }
  | { operation: "status"; scope: PluginGitScope }
  /**
   * Reports every path the index currently holds unmerged, with the stages Git
   * recorded for each one. It names exact repository-relative paths and reads
   * nothing else, so a conflict surface never has to infer which sides exist.
   */
  | { operation: "list-conflicts"; scope: PluginGitScope }
  | { operation: "operation-state"; scope: PluginGitScope }
  | { operation: "initialize"; scope: PluginGitScope; defaultBranch: string }
  | { operation: "stage"; scope: PluginGitScope; paths: string[] }
  | { operation: "unstage"; scope: PluginGitScope; paths: string[] }
  | {
      operation: "restore-from-upstream";
      scope: PluginGitScope;
      paths: string[];
    }
  /**
   * Stages, or unstages, exactly one hunk of exactly one path. The host
   * reconstructs the patch and applies it to the index only, so neither the
   * worktree nor any other path is touched.
   */
  | {
      operation: "stage-hunk";
      scope: PluginGitScope;
      path: string;
      hunk: PluginGitHunk;
    }
  | {
      operation: "unstage-hunk";
      scope: PluginGitScope;
      path: string;
      hunk: PluginGitHunk;
    }
  | {
      operation: "commit";
      scope: PluginGitScope;
      message: string;
      amend?: boolean;
      allowEmpty?: boolean;
      /**
       * Optional commit identity. The host applies a present value as a
       * highest-precedence command-line configuration override, so repository
       * configuration cannot replace it. Omitting both keeps whatever safe
       * repository-local identity the repository already has.
       */
      authorName?: string;
      authorEmail?: string;
    }
  | { operation: "list-branches"; scope: PluginGitScope }
  | { operation: "list-remotes"; scope: PluginGitScope }
  | {
      operation: "list-history";
      scope: PluginGitScope;
      maxCount: number;
      skip?: number;
      ref?: string;
      path?: string;
    }
  | {
      operation: "diff";
      scope: PluginGitScope;
      target: PluginGitDiffTarget;
      paths?: string[];
    }
  | {
      operation: "fetch";
      scope: PluginGitScope;
      remote: string;
      prune?: boolean;
      authMode?: PluginGitAuthMode;
    }
  | {
      operation: "pull";
      scope: PluginGitScope;
      remote: string;
      branch: string;
      strategy: PluginGitPullStrategy;
      authMode?: PluginGitAuthMode;
    }
  | {
      operation: "push";
      scope: PluginGitScope;
      remote: string;
      branch: string;
      setUpstream?: boolean;
      mode?: PluginGitPushMode;
      authMode?: PluginGitAuthMode;
    }
  | { operation: "add-remote"; scope: PluginGitScope; name: string; url: string }
  | {
      operation: "set-remote-url";
      scope: PluginGitScope;
      name: string;
      url: string;
    }
  | { operation: "remove-remote"; scope: PluginGitScope; name: string }
  | {
      operation: "create-branch";
      scope: PluginGitScope;
      name: string;
      startPoint?: string;
      checkout?: boolean;
    }
  | { operation: "checkout-branch"; scope: PluginGitScope; name: string }
  | {
      operation: "rename-branch";
      scope: PluginGitScope;
      name: string;
      newName: string;
    }
  | {
      operation: "delete-branch";
      scope: PluginGitScope;
      name: string;
      force?: boolean;
    }
  | {
      operation: "rename-remote-branch";
      scope: PluginGitScope;
      remote: string;
      name: string;
      newName: string;
      authMode?: PluginGitAuthMode;
    }
  | {
      operation: "delete-remote-branch";
      scope: PluginGitScope;
      remote: string;
      name: string;
      authMode?: PluginGitAuthMode;
    }
  | {
      operation: "stash";
      scope: PluginGitScope;
      action: PluginGitStashAction;
      message?: string;
      includeUntracked?: boolean;
      entry?: number;
    }
  | {
      operation: "merge";
      scope: PluginGitScope;
      ref: string;
      fastForwardOnly?: boolean;
      noCommit?: boolean;
    }
  | { operation: "rebase"; scope: PluginGitScope; upstream: string }
  | { operation: "cherry-pick"; scope: PluginGitScope; commit: string }
  | { operation: "revert"; scope: PluginGitScope; commit: string }
  | {
      operation: "continue";
      scope: PluginGitScope;
      sequencer: PluginGitSequencer;
    }
  | { operation: "skip"; scope: PluginGitScope; sequencer: PluginGitSequencer }
  | { operation: "abort"; scope: PluginGitScope; sequencer: PluginGitSequencer }
  | {
      operation: "read-conflict-stage";
      scope: PluginGitScope;
      path: string;
      stage: PluginGitConflictStage;
    }
  | {
      operation: "resolve-conflict";
      scope: PluginGitScope;
      path: string;
      resolution: PluginGitConflictResolution;
    }
  | {
      operation: "clone";
      scope: PluginGitScope;
      url: string;
      directory: string;
      branch?: string;
      authMode?: PluginGitAuthMode;
    };

export type PluginGitCancelRequest = {
  operation: "cancel";
  operationId: string;
};

export type PluginGitRequest = PluginGitRunRequest | PluginGitCancelRequest;

export interface PluginGitResult {
  operationId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  /**
   * True when the operation stopped because it was cancelled. A mutating
   * command that already reached its own Git command boundary reports its real
   * exit code and output instead, because its work is done: cancellation then
   * stops the next step of the operation, if there is one.
   */
  cancelled: boolean;
}

/**
 * A started Git operation. The host generates `operationId` and returns it
 * before the operation completes, so a concurrent source-control action can
 * cancel the operation while it is still running.
 */
export interface PluginGitOperation {
  operationId: string;
  result: Promise<PluginGitResult>;
}

/**
 * One GitHub repository the host's `gh` adapter reported. This bounded
 * metadata is the only thing the adapter returns to a plugin: the GitHub token
 * that authorised the listing is obtained, used, and destroyed inside the
 * native host.
 */
export interface PluginGitHubRepository {
  nameWithOwner: string;
  httpsUrl: string;
  sshUrl: string;
  defaultBranch: string | null;
  private: boolean;
}

export interface PluginGitHubListRequest {
  /** Bounded number of repositories to report. */
  limit: number;
}

export interface PluginGitCloneVaultRequest {
  url: string;
  authMode: PluginGitAuthMode;
  branch?: string;
}

/**
 * The outcome of a clone the host performed into a folder the user chose.
 *
 * A successful clone never returns a path, a workspace snapshot, or anything
 * else that identifies the destination: the host renderer opens the vault
 * itself. A failure returns an opaque cleanup token instead of a path, so the
 * only thing a plugin can ask for is deletion of that exact destination, and
 * only behind an explicit dangerous confirmation the host owns.
 */
export type PluginGitCloneVaultResult =
  | { status: "cancelled" }
  | {
      status: "cloned";
      label: string;
      remoteUrl: string;
      branch: string | null;
      defaultBranch: string | null;
      upstream: string | null;
    }
  | {
      status: "failed";
      message: string;
      cleanupToken: string | null;
    };

export interface PluginGitCloneCleanupResult {
  cleaned: boolean;
  message: string;
}

/**
 * A clone in progress.
 *
 * The ID is published before the clone is awaited, exactly like
 * {@link PluginGitOperation}, so a surface can offer Cancel while the folder
 * chooser, the credentials, and Git are still working.
 */
export interface PluginGitCloneVaultOperation {
  operationId: string;
  result: Promise<PluginGitCloneVaultResult>;
}

/** A repository listing in progress, cancellable by the same operation ID. */
export interface PluginGitHubListOperation {
  operationId: string;
  result: Promise<PluginGitHubRepository[]>;
}

export interface PluginGitCapability {
  /**
   * Runs one typed Git operation. The request is the only input: the Git
   * executable is host-owned, read by the host from this plugin's persisted
   * `gitExecutablePath` setting, so an invocation can never name a binary,
   * raw argument, flag, or environment value.
   */
  run: (
    request: PluginGitRunRequest,
    target?: PluginGitRepositoryTarget,
  ) => PluginGitOperation;
  /**
   * Cancels one of this plugin's operations by ID. The resolved result
   * describes the cancelled operation, and `cancelled` is false when no
   * matching operation is running.
   */
  cancel: (operationId: string) => Promise<PluginGitResult>;
  /**
   * Lists GitHub repositories through the host's own `gh` adapter. The host
   * resolves `gh`, obtains and destroys the token, and returns only bounded
   * structured metadata. The returned operation ID cancels the listing while
   * it is still running.
   */
  listGitHubRepositories: (
    request: PluginGitHubListRequest,
  ) => PluginGitHubListOperation;
  /**
   * Clones a repository into an empty folder the user picks in a native host
   * chooser, then opens it as a vault. Cancelling the chooser is not an error.
   * The returned operation ID cancels the clone while it is still running.
   */
  cloneVault: (
    request: PluginGitCloneVaultRequest,
  ) => PluginGitCloneVaultOperation;
  /**
   * Deletes the destination of a clone that failed, named only by the opaque
   * token that clone returned. The host revalidates that the destination is
   * still that failed clone before deleting anything, and the token cannot be
   * spent twice.
   */
  cleanFailedClone: (
    cleanupToken: string,
  ) => Promise<PluginGitCloneCleanupResult>;
}

export interface PluginWorkspaceReadCapability {
  readText: (path: string) => Promise<PluginTextDocument>;
}

export interface PluginWorkspaceWriteCapability
  extends PluginWorkspaceReadCapability {
  writeText: (path: string, content: string, version: string) => Promise<void>;
}

export interface PluginNetworkRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface PluginNetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface PluginNetworkCapability {
  request: (request: PluginNetworkRequest) => Promise<PluginNetworkResponse>;
}

export interface PluginClipboardReadCapability {
  readText: () => Promise<string>;
}

export interface PluginClipboardWriteCapability {
  writeText: (text: string) => Promise<void>;
}

export interface PluginNotificationCapability {
  show: (title: string, body?: string) => Promise<void>;
}

export interface PluginProcessRequest {
  executable: string;
  arguments: string[];
}

export interface PluginProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PluginProcessCapability {
  run: (request: PluginProcessRequest) => Promise<PluginProcessResult>;
}

export interface PluginCapabilities {
  commands?: PluginCommandCapability;
  sidebar?: PluginSidebarCapability;
  status?: PluginStatusCapability;
  editorDecoration?: PluginEditorDecorationCapability;
  noteEvents?: PluginNoteEventsCapability;
  projectContext?: PluginProjectContextCapability;
  sourceControl?: PluginSourceControlCapability;
  automaticLocalCommit?: PluginAutomaticLocalCommitCapability;
  secureStorage?: PluginSecureStorage;
}

export interface PluginUserActionContext {
  capabilities: {
    workspaceRead?: PluginWorkspaceReadCapability;
    workspaceWrite?: PluginWorkspaceWriteCapability;
    network?: PluginNetworkCapability;
    clipboardRead?: PluginClipboardReadCapability;
    clipboardWrite?: PluginClipboardWriteCapability;
    notifications?: PluginNotificationCapability;
    process?: PluginProcessCapability;
    git?: PluginGitCapability;
  };
}

export interface PluginActivationContext {
  pluginId: string;
  logger: PluginLogger;
  storage: PluginStorage;
  settings: PluginSettings;
  capabilities: PluginCapabilities;
  subscriptions: PluginSubscriptions;
}

export interface DenotePlugin {
  manifest: PluginManifest;
  activate: (context: PluginActivationContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export interface PluginValidationResult<T> {
  valid: boolean;
  value: T | null;
  errors: string[];
}

export interface PluginCompatibilityResult {
  compatible: boolean;
  reason: string | null;
}
