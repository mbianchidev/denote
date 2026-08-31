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

export interface PluginBundle {
  id: string;
  name: string;
  categories: PluginCategory[];
  pluginIds: string[];
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
