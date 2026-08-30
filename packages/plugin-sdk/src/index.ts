import { compare, valid } from "semver";

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
      capability: Exclude<PluginCapability, "network">;
    }
  | {
      capability: "network";
      hosts: string[];
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

export interface PluginSettingsSchema {
  properties: Record<string, PluginSettingDefinition>;
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

export interface PluginCatalogEntry {
  manifest: PluginManifest;
  artifact: PluginArtifact;
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
}

export interface PluginSidebarCapability {
  register: (view: PluginSidebarView) => PluginDisposable;
}

export interface PluginEditorDecoration {
  id: string;
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

export interface PluginWorkspaceReadCapability {
  readText: (path: string) => Promise<string>;
}

export interface PluginWorkspaceWriteCapability
  extends PluginWorkspaceReadCapability {
  writeText: (path: string, content: string) => Promise<void>;
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
  workingDirectory?: string;
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
  editorDecoration?: PluginEditorDecorationCapability;
  noteEvents?: PluginNoteEventsCapability;
  workspaceRead?: PluginWorkspaceReadCapability;
  network?: PluginNetworkCapability;
  clipboardRead?: PluginClipboardReadCapability;
  notifications?: PluginNotificationCapability;
  secureStorage?: PluginSecureStorage;
}

export interface PluginUserActionCapabilities {
  workspaceWrite?: PluginWorkspaceWriteCapability;
  clipboardWrite?: PluginClipboardWriteCapability;
  process?: PluginProcessCapability;
}

export interface PluginUserActionContext {
  capabilities: PluginUserActionCapabilities;
}

export interface PluginActivationContext {
  pluginId: string;
  logger: PluginLogger;
  storage: PluginStorage;
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

export function validatePluginManifest(
  value: unknown,
): PluginValidationResult<PluginManifest> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return invalid("Manifest must be an object.");
  }

  requireEqual(
    value.schemaVersion,
    PLUGIN_MANIFEST_SCHEMA_VERSION,
    "schemaVersion",
    errors,
  );
  requireString(value.id, "id", errors);
  if (
    typeof value.id === "string" &&
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.id)
  ) {
    errors.push(
      "id must be a namespaced lowercase identifier such as denote.example.",
    );
  }
  requireString(value.name, "name", errors);
  requireSemver(value.version, "version", errors);
  requireString(value.description, "description", errors);
  validatePublisher(value.publisher, errors);
  requireString(value.license, "license", errors);
  requireHttpsUrl(value.repository, "repository", errors);
  if (value.homepage !== undefined) {
    requireHttpsUrl(value.homepage, "homepage", errors);
  }
  requireSafeRelativePath(value.icon, "icon", errors);
  if (
    typeof value.category !== "string" ||
    !PLUGIN_CATEGORIES.includes(value.category as PluginCategory)
  ) {
    errors.push(`category must be one of: ${PLUGIN_CATEGORIES.join(", ")}.`);
  }
  validateCompatibility(value.compatibility, errors);
  validatePermissions(value.permissions, errors);
  requireSafeRelativePath(value.entrypoint, "entrypoint", errors);
  if (
    typeof value.entrypoint === "string" &&
    !value.entrypoint.startsWith("dist/")
  ) {
    errors.push("entrypoint must point inside the package dist/ directory.");
  }
  requireSafeRelativePath(value.documentation, "documentation", errors);
  if (value.settings !== undefined) {
    validateSettings(value.settings, errors);
  }

  return errors.length === 0
    ? { valid: true, value: value as unknown as PluginManifest, errors }
    : { valid: false, value: null, errors };
}

export function assertValidPluginManifest(
  value: unknown,
): asserts value is PluginManifest {
  const result = validatePluginManifest(value);
  if (!result.valid) {
    throw new Error(`Invalid plugin manifest:\n- ${result.errors.join("\n- ")}`);
  }
}

export function parsePluginManifest(value: unknown): PluginManifest {
  assertValidPluginManifest(value);
  return value;
}

export function validatePluginCatalogEntry(
  value: unknown,
): PluginValidationResult<PluginCatalogEntry> {
  if (!isRecord(value)) {
    return invalid("Catalog entry must be an object.");
  }
  const errors = validatePluginManifest(value.manifest).errors;
  if (!isRecord(value.artifact)) {
    errors.push("artifact must be an object.");
  } else {
    requireHttpsUrl(value.artifact.url, "artifact.url", errors);
    if (
      typeof value.artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(value.artifact.sha256)
    ) {
      errors.push("artifact.sha256 must be a 64-character SHA-256 hex digest.");
    }
    if (
      typeof value.artifact.sizeBytes !== "number" ||
      !Number.isSafeInteger(value.artifact.sizeBytes) ||
      value.artifact.sizeBytes <= 0
    ) {
      errors.push("artifact.sizeBytes must be a positive integer.");
    }
  }
  requireString(value.guide, "guide", errors);
  if (typeof value.guide === "string") {
    const guide = value.guide.toLowerCase();
    for (const section of PLUGIN_GUIDE_SECTIONS) {
      if (!guide.includes(`## ${section}`)) {
        errors.push(`guide is missing the "${section}" section.`);
      }
    }
  }

  return errors.length === 0
    ? { valid: true, value: value as unknown as PluginCatalogEntry, errors }
    : { valid: false, value: null, errors };
}

export function assertValidPluginCatalogEntry(
  value: unknown,
): asserts value is PluginCatalogEntry {
  const result = validatePluginCatalogEntry(value);
  if (!result.valid) {
    throw new Error(
      `Invalid plugin catalog entry:\n- ${result.errors.join("\n- ")}`,
    );
  }
}

export function checkPluginCompatibility(
  manifest: PluginManifest,
  denoteVersion: string,
  apiVersion: number,
): PluginCompatibilityResult {
  const hostVersion = strictSemver(denoteVersion);
  if (!hostVersion) {
    return {
      compatible: false,
      reason: `Denote host version ${denoteVersion} is not valid semantic versioning.`,
    };
  }
  if (manifest.compatibility.apiVersion !== apiVersion) {
    return {
      compatible: false,
      reason: `Plugin API version ${manifest.compatibility.apiVersion} is incompatible with host API version ${apiVersion}.`,
    };
  }

  const minimum = strictSemver(
    manifest.compatibility.minimumDenoteVersion,
  );
  const maximum = manifest.compatibility.maximumDenoteVersion
    ? strictSemver(manifest.compatibility.maximumDenoteVersion)
    : null;
  if (!minimum || compare(hostVersion, minimum) < 0) {
    return {
      compatible: false,
      reason: `Plugin requires Denote ${manifest.compatibility.minimumDenoteVersion} or newer.`,
    };
  }
  if (maximum && compare(hostVersion, maximum) >= 0) {
    return {
      compatible: false,
      reason: `Plugin requires a Denote version below ${manifest.compatibility.maximumDenoteVersion}.`,
    };
  }
  return { compatible: true, reason: null };
}

function validatePublisher(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("publisher must be an object.");
    return;
  }
  requireString(value.name, "publisher.name", errors);
  if (value.url !== undefined) {
    requireHttpsUrl(value.url, "publisher.url", errors);
  }
}

function validateCompatibility(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("compatibility must be an object.");
    return;
  }
  if (
    typeof value.apiVersion !== "number" ||
    !Number.isSafeInteger(value.apiVersion) ||
    value.apiVersion <= 0
  ) {
    errors.push("compatibility.apiVersion must be a positive integer.");
  }
  requireSemver(
    value.minimumDenoteVersion,
    "compatibility.minimumDenoteVersion",
    errors,
  );
  if (value.maximumDenoteVersion !== undefined) {
    requireSemver(
      value.maximumDenoteVersion,
      "compatibility.maximumDenoteVersion",
      errors,
    );
  }
  const minimum =
    typeof value.minimumDenoteVersion === "string"
      ? strictSemver(value.minimumDenoteVersion)
      : null;
  const maximum =
    typeof value.maximumDenoteVersion === "string"
      ? strictSemver(value.maximumDenoteVersion)
      : null;
  if (minimum && maximum && compare(minimum, maximum) >= 0) {
    errors.push(
      "compatibility.maximumDenoteVersion must be greater than minimumDenoteVersion.",
    );
  }
}

function validatePermissions(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("permissions must be an array.");
    return;
  }
  const seen = new Set<string>();
  value.forEach((permission, index) => {
    if (!isRecord(permission)) {
      errors.push(`permissions[${index}] must be an object.`);
      return;
    }
    if (
      typeof permission.capability !== "string" ||
      !PLUGIN_CAPABILITIES.includes(
        permission.capability as PluginCapability,
      )
    ) {
      errors.push(
        `permissions[${index}].capability must be one of: ${PLUGIN_CAPABILITIES.join(", ")}.`,
      );
      return;
    }
    if (seen.has(permission.capability)) {
      errors.push(`permissions contains duplicate ${permission.capability}.`);
    }
    seen.add(permission.capability);

    if (permission.capability === "network") {
      if (!Array.isArray(permission.hosts) || permission.hosts.length === 0) {
        errors.push(`permissions[${index}].hosts must be a non-empty array.`);
      } else {
        permission.hosts.forEach((host, hostIndex) => {
          if (
            typeof host !== "string" ||
            !/^(?:\*\.)?[a-z0-9.-]+$/i.test(host)
          ) {
            errors.push(
              `permissions[${index}].hosts[${hostIndex}] is not a valid host pattern.`,
            );
          }
        });
      }
    } else if ("hosts" in permission) {
      errors.push(
        `permissions[${index}].hosts is only valid for network permission.`,
      );
    }
  });
}

function validateSettings(value: unknown, errors: string[]): void {
  if (!isRecord(value) || !isRecord(value.properties)) {
    errors.push("settings.properties must be an object.");
    return;
  }
  for (const [key, definition] of Object.entries(value.properties)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) {
      errors.push(`settings property ${key} must use lower camel case.`);
    }
    if (!isRecord(definition)) {
      errors.push(`settings.properties.${key} must be an object.`);
      continue;
    }
    requireString(definition.title, `settings.properties.${key}.title`, errors);
    if (definition.description !== undefined) {
      requireString(
        definition.description,
        `settings.properties.${key}.description`,
        errors,
      );
    }
    switch (definition.type) {
      case "boolean":
        if (typeof definition.default !== "boolean") {
          errors.push(`settings.properties.${key}.default must be boolean.`);
        }
        break;
      case "string":
        if (typeof definition.default !== "string") {
          errors.push(`settings.properties.${key}.default must be a string.`);
        }
        break;
      case "number":
        if (typeof definition.default !== "number") {
          errors.push(`settings.properties.${key}.default must be a number.`);
        }
        if (
          definition.minimum !== undefined &&
          typeof definition.minimum !== "number"
        ) {
          errors.push(`settings.properties.${key}.minimum must be a number.`);
        }
        if (
          definition.maximum !== undefined &&
          typeof definition.maximum !== "number"
        ) {
          errors.push(`settings.properties.${key}.maximum must be a number.`);
        }
        break;
      case "select":
        if (typeof definition.default !== "string") {
          errors.push(`settings.properties.${key}.default must be a string.`);
        }
        if (!Array.isArray(definition.options) || definition.options.length === 0) {
          errors.push(
            `settings.properties.${key}.options must be a non-empty array.`,
          );
        } else {
          const values = new Set<string>();
          for (const [optionIndex, option] of definition.options.entries()) {
            if (
              !isRecord(option) ||
              typeof option.value !== "string" ||
              typeof option.label !== "string"
            ) {
              errors.push(
                `settings.properties.${key}.options[${optionIndex}] must contain string value and label.`,
              );
              continue;
            }
            values.add(option.value);
          }
          if (
            typeof definition.default === "string" &&
            !values.has(definition.default)
          ) {
            errors.push(
              `settings.properties.${key}.default must match an option value.`,
            );
          }
        }
        break;
      default:
        errors.push(
          `settings.properties.${key}.type must be boolean, string, number, or select.`,
        );
    }
  }
}

function requireEqual(
  value: unknown,
  expected: unknown,
  field: string,
  errors: string[],
): void {
  if (value !== expected) {
    errors.push(`${field} must be ${String(expected)}.`);
  }
}

function requireString(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string.`);
  }
}

function requireHttpsUrl(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (typeof value !== "string") {
    errors.push(`${field} must be an HTTPS URL.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      errors.push(`${field} must be an HTTPS URL.`);
    }
  } catch {
    errors.push(`${field} must be an HTTPS URL.`);
  }
}

function requireSafeRelativePath(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    errors.push(`${field} must be a safe package-relative path.`);
  }
}

function requireSemver(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (
    typeof value !== "string" ||
    strictSemver(value) === null
  ) {
    errors.push(`${field} must be a semantic version.`);
  }
}

function strictSemver(value: string): string | null {
  const exactSemver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (!exactSemver.test(value)) {
    return null;
  }
  return valid(value);
}

function invalid<T>(message: string): PluginValidationResult<T> {
  return { valid: false, value: null, errors: [message] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
