import type {
  PluginNetworkRequest,
  PluginProcessRequest,
} from "@denote/plugin-sdk";
import { api } from "../lib/api";
import { parsePluginGitRequest } from "./gitRequests";

export interface PluginActionLeaseScope {
  workspaceScope: string;
  projectId: string | null;
}

export function privilegedHostOperation(operation: string): boolean {
  return (
    operation.startsWith("workspace.") ||
    operation.startsWith("network.") ||
    operation.startsWith("clipboard.") ||
    operation.startsWith("notifications.") ||
    operation.startsWith("process.") ||
    operation.startsWith("git.")
  );
}

export async function runHostOperation(
  pluginId: string,
  operation: string,
  key?: string,
  value?: unknown,
  actionScope?: PluginActionLeaseScope,
  operationId?: string,
): Promise<unknown> {
  switch (operation) {
    case "storage.get":
      return api.pluginStorageGet(pluginId, requireKey(key));
    case "storage.set":
      return api.pluginStorageSet(pluginId, requireKey(key), value);
    case "storage.delete":
      return api.pluginStorageDelete(pluginId, requireKey(key));
    case "storage.clear":
      return api.pluginStorageClear(pluginId);
    case "settings.get":
      return api.getPluginSettings(pluginId);
    case "secret.get":
      return api.pluginSecretGet(pluginId, requireKey(key));
    case "secret.set":
      if (typeof value !== "string") {
        throw new Error("Secret value must be a string.");
      }
      return api.pluginSecretSet(pluginId, requireKey(key), value);
    case "secret.delete":
      return api.pluginSecretDelete(pluginId, requireKey(key));
    case "workspace.read":
      return api.pluginWorkspaceRead(
        pluginId,
        requireActionScope(actionScope).workspaceScope,
        requireObjectValue(value, "path"),
      );
    case "workspace.read-write":
      return api.pluginWorkspaceRead(
        pluginId,
        requireActionScope(actionScope).workspaceScope,
        requireObjectValue(value, "path"),
        true,
      );
    case "workspace.write":
      return api.pluginWorkspaceWrite(
        pluginId,
        requireActionScope(actionScope).workspaceScope,
        requireObjectValue(value, "path"),
        requireObjectValue(value, "content"),
        requireObjectValue(value, "version"),
      );
    case "network.request":
      return api.pluginNetworkRequest(pluginId, parseNetworkRequest(value));
    case "clipboard.read":
      return api.pluginClipboardRead(pluginId);
    case "clipboard.write":
      if (typeof value !== "string") {
        throw new Error("Plugin clipboard value must be text.");
      }
      return api.pluginClipboardWrite(pluginId, value);
    case "notifications.show":
      if (!isRecord(value) || typeof value.title !== "string") {
        throw new Error("Plugin notification requires a title.");
      }
      return api.pluginShowNotification(
        pluginId,
        value.title,
        typeof value.body === "string" ? value.body : undefined,
      );
    case "process.run":
      return api.pluginProcessRequest(
        pluginId,
        parseProcessRequest(value),
        requireActionScope(actionScope).projectId,
      );
    case "git.run": {
      const scope = requireActionScope(actionScope);
      // The request is the only thing a plugin contributes. A custom Git
      // executable lives in host-owned plugin settings, so nothing here can
      // name one.
      return api.pluginGitRequest(
        pluginId,
        parsePluginGitRequest(value),
        scope.workspaceScope,
        scope.projectId,
        requireOperationId(operationId),
      );
    }
    default:
      throw new Error(`Unsupported plugin host operation: ${operation}`);
  }
}

function requireKey(key?: string): string {
  if (!key) {
    throw new Error("Plugin storage request is missing a key.");
  }
  return key;
}

function requireObjectValue(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string") {
    throw new Error(`Plugin action requires string ${key}.`);
  }
  return value[key];
}

function requireActionScope(
  scope?: PluginActionLeaseScope,
): PluginActionLeaseScope {
  if (!scope?.workspaceScope) {
    throw new Error("Workspace action lease has no vault scope.");
  }
  return scope;
}

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The runtime generates one operation ID per Git invocation so the plugin can
 * cancel it. A plugin never chooses it, and the native transport refuses
 * anything that is not a canonical UUID.
 */
function requireOperationId(operationId?: string): string {
  if (!operationId || !OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error("Plugin Git request is missing a valid operation ID.");
  }
  return operationId;
}

function parseNetworkRequest(value: unknown): PluginNetworkRequest {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("Plugin network request requires a URL.");
  }
  if (
    value.method !== undefined &&
    !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(value.method))
  ) {
    throw new Error("Plugin network request method is invalid.");
  }
  return {
    url: value.url,
    method: value.method as PluginNetworkRequest["method"],
    headers: isStringRecord(value.headers) ? value.headers : undefined,
    body: typeof value.body === "string" ? value.body : undefined,
  };
}

function parseProcessRequest(value: unknown): PluginProcessRequest {
  if (
    !isRecord(value) ||
    typeof value.executable !== "string" ||
    !Array.isArray(value.arguments) ||
    value.arguments.some((argument) => typeof argument !== "string")
  ) {
    throw new Error("Plugin process request is invalid.");
  }
  return {
    executable: value.executable,
    arguments: value.arguments,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
