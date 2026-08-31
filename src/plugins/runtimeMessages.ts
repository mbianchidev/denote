import type {
  PluginCapability,
  PluginNoteEvent,
} from "@denote/plugin-sdk";

export interface PluginCommandContribution {
  pluginId: string;
  id: string;
  title: string;
}

export interface PluginSidebarContribution {
  pluginId: string;
  id: string;
  title: string;
  content: string;
}

export interface PluginStatusContribution {
  pluginId: string;
  id: string;
  text: string;
}

export interface PluginDecorationContribution {
  pluginId: string;
  id: string;
  pattern: string;
  style: "highlight" | "warning" | "muted";
  caseSensitive: boolean;
}

export interface PluginWorkerConnectMessage {
  type: "connect";
  moduleUrl: string;
  pluginId: string;
  expectedVersion: string;
  permissions: PluginCapability[];
}

export type PluginHostMessage =
  | { type: "activate" }
  | { type: "run-command"; commandId: string; requestId: string }
  | { type: "note-event"; event: PluginNoteEvent }
  | { type: "deactivate"; requestId: string }
  | {
      type: "host-response";
      requestId: string;
      value?: unknown;
      error?: string;
    };

export type PluginRuntimeMessage =
  | { type: "ready" }
  | { type: "activated" }
  | { type: "deactivated"; requestId: string; error?: string }
  | { type: "activation-error"; error: string }
  | { type: "runtime-error"; error: string }
  | { type: "register-command"; id: string; title: string }
  | { type: "unregister-command"; id: string }
  | { type: "register-sidebar"; id: string; title: string; content: string }
  | { type: "unregister-sidebar"; id: string }
  | { type: "register-status"; id: string; text: string }
  | { type: "unregister-status"; id: string }
  | {
      type: "register-decoration";
      id: string;
      pattern: string;
      style: "highlight" | "warning" | "muted";
      caseSensitive: boolean;
    }
  | { type: "unregister-decoration"; id: string }
  | {
      type: "host-request";
      requestId: string;
      operation: string;
      actionId?: string;
      key?: string;
      value?: unknown;
    }
  | { type: "command-result"; requestId: string; error?: string }
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      details?: Record<string, unknown>;
    };

export function isPluginRuntimeMessage(
  value: unknown,
): value is PluginRuntimeMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "ready":
    case "activated":
      return true;
    case "activation-error":
    case "runtime-error":
      return typeof value.error === "string";
    case "deactivated":
    case "command-result":
      return (
        typeof value.requestId === "string" &&
        (value.error === undefined || typeof value.error === "string")
      );
    case "register-command":
      return typeof value.id === "string" && typeof value.title === "string";
    case "unregister-command":
      return typeof value.id === "string";
    case "register-sidebar":
      return (
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.content === "string"
      );
    case "unregister-sidebar":
      return typeof value.id === "string";
    case "register-status":
      return typeof value.id === "string" && typeof value.text === "string";
    case "unregister-status":
      return typeof value.id === "string";
    case "register-decoration":
      return (
        typeof value.id === "string" &&
        typeof value.pattern === "string" &&
        ["highlight", "warning", "muted"].includes(String(value.style)) &&
        typeof value.caseSensitive === "boolean"
      );
    case "unregister-decoration":
      return typeof value.id === "string";
    case "host-request":
      return (
        typeof value.requestId === "string" &&
        typeof value.operation === "string" &&
        (value.key === undefined || typeof value.key === "string") &&
        (value.actionId === undefined || typeof value.actionId === "string")
      );
    case "log":
      return (
        ["debug", "info", "warn", "error"].includes(String(value.level)) &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
