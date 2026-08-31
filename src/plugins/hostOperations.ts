import type {
  PluginNetworkRequest,
  PluginProcessRequest,
} from "@denote/plugin-sdk";
import { api } from "../lib/api";

export function privilegedHostOperation(operation: string): boolean {
  return (
    operation.startsWith("workspace.") ||
    operation.startsWith("network.") ||
    operation.startsWith("clipboard.") ||
    operation.startsWith("notifications.") ||
    operation.startsWith("process.")
  );
}

export async function runHostOperation(
  pluginId: string,
  operation: string,
  key?: string,
  value?: unknown,
  workspaceScope?: string,
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
        requireWorkspaceScope(workspaceScope),
        requireObjectValue(value, "path"),
      );
    case "workspace.read-write":
      return api.pluginWorkspaceRead(
        pluginId,
        requireWorkspaceScope(workspaceScope),
        requireObjectValue(value, "path"),
        true,
      );
    case "workspace.write":
      return api.pluginWorkspaceWrite(
        pluginId,
        requireWorkspaceScope(workspaceScope),
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
      return api.pluginProcessRequest(pluginId, parseProcessRequest(value));
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

function requireWorkspaceScope(scope?: string): string {
  if (!scope) {
    throw new Error("Workspace action lease has no vault scope.");
  }
  return scope;
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
