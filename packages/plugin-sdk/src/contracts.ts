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
  /**
   * True when the host switched to a different workspace, which invalidates
   * everything a plugin read from the previous one. It is reported even when
   * `previous` and `current` are both null, because a workspace without a
   * project still changes the repository behind every path a plugin can reach.
   * The workspace itself is never identified: only the fact that it changed.
   */
  workspaceChanged: boolean;
}

export interface PluginProjectContextCapability {
  getCurrent: () => PluginProjectContext | null;
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

export type PluginSourceControlDiffLineKind =
  | "context"
  | "addition"
  | "deletion";

export interface PluginSourceControlDiffLine {
  kind: PluginSourceControlDiffLineKind;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
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
  resourceGroups: PluginSourceControlResourceGroup[];
  branches: PluginSourceControlBranchChoice[];
  remotes: PluginSourceControlRemote[];
  history: PluginSourceControlHistoryEntry[];
  diffFiles: PluginSourceControlDiffFile[];
  conflicts: PluginSourceControlConflictEntry[];
  recovery: PluginSourceControlRecoveryState;
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

export type PluginGitDiffTarget =
  | { kind: "worktree" }
  | { kind: "index" }
  | { kind: "commit"; commit: string }
  | { kind: "range"; fromCommit: string; toCommit: string };

export type PluginGitConflictResolution =
  | { kind: "stage"; stage: PluginGitConflictStage }
  | { kind: "content"; contentBase64: string };

export type PluginGitRunRequest =
  | { operation: "discover"; scope: PluginGitScope }
  | { operation: "status"; scope: PluginGitScope }
  | { operation: "operation-state"; scope: PluginGitScope }
  | { operation: "initialize"; scope: PluginGitScope; defaultBranch: string }
  | { operation: "stage"; scope: PluginGitScope; paths: string[] }
  | { operation: "unstage"; scope: PluginGitScope; paths: string[] }
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
  | { operation: "fetch"; scope: PluginGitScope; remote: string; prune?: boolean }
  | {
      operation: "pull";
      scope: PluginGitScope;
      remote: string;
      branch: string;
      strategy: PluginGitPullStrategy;
    }
  | {
      operation: "push";
      scope: PluginGitScope;
      remote: string;
      branch: string;
      setUpstream?: boolean;
      mode?: PluginGitPushMode;
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

export interface PluginGitCapability {
  /**
   * Runs one typed Git operation. The request is the only input: the Git
   * executable is host-owned, read by the host from this plugin's persisted
   * `gitExecutablePath` setting, so an invocation can never name a binary,
   * raw argument, flag, or environment value.
   */
  run: (request: PluginGitRunRequest) => PluginGitOperation;
  /**
   * Cancels one of this plugin's operations by ID. The resolved result
   * describes the cancelled operation, and `cancelled` is false when no
   * matching operation is running.
   */
  cancel: (operationId: string) => Promise<PluginGitResult>;
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
