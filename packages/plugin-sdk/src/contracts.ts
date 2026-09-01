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

export interface PluginTextDocument {
  content: string;
  version: string;
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
