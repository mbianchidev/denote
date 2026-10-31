import type { PluginCodeScope, PluginToolDocument, PluginToolFormat, PluginToolKind } from "@denote/plugin-sdk";

export interface ToolConfiguration {
  enabled: boolean;
  executable: string;
  executableSha256: string;
  arguments: string[];
  format: PluginToolFormat;
  columns: "utf16" | "utf8" | "unicode";
  stdin: boolean;
  runOn: "manual" | "save" | "change";
  debounceMs: number;
  timeoutMs: number;
}

export interface ToolContext {
  workspaceScope: string;
  projectId: string | null;
  kind: PluginToolKind;
  language: string;
}

export interface ToolEnvironment {
  configured: boolean;
  scope: PluginCodeScope;
  configuration: ToolConfiguration;
  platform: string;
  terminalSupported: boolean;
  limitation: string | null;
}

export interface ToolStartRequest {
  paths: string[];
  documentPath: string | null;
  input: string | null;
  trigger: "manual" | "save" | "change";
  rows: number;
  cols: number;
}

export interface ToolRun {
  runId: string;
  scope: PluginCodeScope;
  documents: PluginToolDocument[];
}

export interface ToolPoll {
  status: "running" | "succeeded" | "failed" | "cancelled";
  exitCode: number | null;
  error: string | null;
  events: Array<{ stream: "stdout" | "stderr" | "terminal"; data: string }>;
}
