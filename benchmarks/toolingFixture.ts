/// <reference types="vite/client" />
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { parsePluginManifest } from "@denote/plugin-sdk";
import type { PluginView, WorkspaceSnapshot, NoteStats } from "../src/types";
import type { ToolConfiguration, ToolContext } from "../src/lib/projectTools";
import linterManifest from "../plugins/linter/plugin.json";
import compilerManifest from "../plugins/compiler/plugin.json";
import terminalManifest from "../plugins/terminal/plugin.json";
import linterCode from "../plugins/linter/dist/index.js?raw";
import compilerCode from "../plugins/compiler/dist/index.js?raw";
import terminalCode from "../plugins/terminal/dist/index.js?raw";

interface ToolingFixtureState {
  documents: Record<string, string>;
  starts: Array<{ pluginId: string; kind: string; runId: string; input: unknown; trigger: string }>;
  stops: string[];
  input: string[];
  unexpectedCommands: string[];
  lintMode: "fix" | "clean";
  holdBuild: boolean;
  blockSaves: boolean;
  failSaves: boolean;
  releaseSaves: () => void;
  platform: "linux" | "windows";
  copies: string[];
  externalLinks: string[];
  browserWindowOpens: string[];
}
declare global { interface Window { __DENOTE_TOOLING__: ToolingFixtureState } }

const waiters: Array<() => void> = [];
const state: ToolingFixtureState = {
  documents: { "example.ts": 'const demo = "example";\n', "other.ts": "export const other = 1;\n" },
  starts: [], stops: [], input: [], unexpectedCommands: [], lintMode: "fix", holdBuild: false,
  blockSaves: false, failSaves: false, platform: "linux", copies: [], externalLinks: [], browserWindowOpens: [],
  releaseSaves: () => { state.blockSaves = false; for (const resolve of waiters.splice(0)) resolve(); },
};
window.__DENOTE_TOOLING__ = state;
window.open = (url) => { state.browserWindowOpens.push(String(url)); return null; };
const versions = new Map<string, number>();
function hash(path: string): string {
  if (!Object.prototype.hasOwnProperty.call(state.documents, path)) throw new Error("Unknown synthetic source.");
  return String(versions.get(path) ?? 1).padStart(64, "0");
}
const sources = new Map([
  [linterManifest.id, linterCode], [compilerManifest.id, compilerCode], [terminalManifest.id, terminalCode],
]);
const plugins: PluginView[] = [linterManifest, compilerManifest, terminalManifest].map((value) => {
  const manifest = parsePluginManifest(value);
  return { catalog: { manifest, artifact: { url: `https://github.com/mbianchidev/denote/releases/download/v0.13.0/${manifest.id}-${manifest.version}.tgz`,
    sizeBytes: 100, sha256: "a".repeat(64) }, provenance: { publisherId: "denote", sourceCommit: "a".repeat(40), trusted: true }, guide: "# Synthetic guide" },
    enabled: true, status: "enabled", error: null, approvedPermissions: manifest.permissions,
    settings: {}, hasCredentials: false, previouslyApproved: true };
});
const snapshot: WorkspaceSnapshot = {
  vaultPath: "/synthetic-tooling-vault", vaultName: "Synthetic tooling", pluginScopeId: "synthetic-tooling", default: false,
  tree: Object.entries(state.documents).map(([path, content]) => ({ path, name: path, kind: "text", size: content.length,
    children: [], modifiedAt: null, bookmarked: false, pinned: false })),
  bookmarks: [], recent: [], trash: [], tagColors: [], markdownViewMode: "source", restoreTabs: false, tabSession: null,
  welcomePage: { customPath: null, effectivePath: null }, ignoredPaths: [], suggestGitProject: false, fromCache: false,
  projectRoots: [{ id: "project-example", rootPath: "", explicit: true, available: true, workspaceId: null }],
  projectWorkspaces: [], encryption: { enabled: false, unlocked: true, phase: null, remainingRecoveryCodes: 0 },
};
const stats: NoteStats = { openCount: 1, editCount: 0, saveCount: 0, lastOpenedAt: null, lastEditedAt: null, lastSavedAt: null, bookmarked: false };
const configurations = new Map<string, ToolConfiguration>();
const runs = new Map<string, { kind: string; pluginId: string; polls: number; stopped: boolean }>();
const defaultConfiguration: ToolConfiguration = {
  enabled: false, executable: "", executableSha256: "", arguments: [], format: "unix",
  columns: "unicode", stdin: false, runOn: "manual", debounceMs: 200, timeoutMs: 1000,
};
function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? Reflect.get(payload, key) : undefined;
}
function argument(payload: unknown, key: string): string {
  const value = field(payload, key);
  if (typeof value !== "string") throw new Error(`Missing synthetic argument ${key}.`);
  return value;
}
function context(payload: unknown): ToolContext {
  const value = field(payload, "context");
  const projectId = field(value, "projectId");
  const kind = argument(value, "kind");
  if ((projectId !== null && typeof projectId !== "string") || (kind !== "linter" && kind !== "build" && kind !== "terminal")) {
    throw new Error("Invalid synthetic tool context.");
  }
  return { workspaceScope: argument(value, "workspaceScope"), projectId, kind, language: argument(value, "language") };
}
function configKey(value: ToolContext): string { return JSON.stringify([value.kind, value.projectId, value.language]); }
function configuration(value: ToolContext): ToolConfiguration {
  return configurations.get(configKey(value)) ?? configurations.get(configKey({ ...value, language: "all" })) ?? defaultConfiguration;
}

mockWindows("main");
mockIPC((command, payload) => {
  switch (command) {
    case "get_runtime_info": return { operatingSystem: "linux", architecture: "x86_64", bundleType: "deb", updateChannel: "stable", updaterConfigured: false };
    case "get_last_vault":
    case "refresh_vault": return structuredClone(snapshot);
    case "list_plugins": return structuredClone(plugins);
    case "list_plugin_bundles":
    case "list_known_vaults":
    case "list_history":
    case "get_plugin_tool_status": return [];
    case "list_known_vault_files": return { files: [], skippedVaultCount: 0, skippedEntryCount: 0, truncated: false };
    case "list_search_documents": return { documents: [], skippedCount: 0, skippedPaths: [], truncated: false };
    case "refresh_gitignore_status": return { scopePaths: [], ignoredPaths: [], complete: true };
    case "get_plugin_settings": return {};
    case "read_plugin_entrypoint": {
      const source = sources.get(argument(payload, "pluginId"));
      if (!source) throw new Error("Unknown synthetic plugin.");
      return source;
    }
    case "read_note": {
      const path = argument(payload, "path");
      return { path, content: state.documents[path], contentHash: hash(path), encoding: "utf8", lineEnding: "lf", stats };
    }
    case "record_edit": return stats;
    case "save_note": {
      const path = argument(payload, "path");
      const content = argument(payload, "content");
      const save = () => {
        if (state.failSaves) throw new Error("Synthetic save conflict. The editor draft remains.");
        if (field(payload, "expectedHash") !== hash(path)) throw new Error("Synthetic source version conflict.");
        state.documents[path] = content;
        versions.set(path, (versions.get(path) ?? 1) + 1);
        return { path, changed: true, savedAt: "2026-01-01T00:00:00Z", contentHash: hash(path), historyCount: 1, stats };
      };
      if (state.blockSaves) return new Promise((resolve, reject) => waiters.push(() => {
        try { resolve(save()); } catch (error) { reject(error); }
      }));
      return save();
    }
    case "tool_environment": {
      const value = context(payload);
      return { configured: configurations.has(configKey(value)) || configurations.has(configKey({ ...value, language: "all" })),
        scope: { projectId: value.projectId, rootPath: "" }, configuration: configuration(value),
        platform: state.platform, terminalSupported: state.platform !== "windows",
        limitation: state.platform === "windows" ? "Windows PTY process-tree shutdown is not yet verified." : null };
    }
    case "choose_tool_executable": return `/synthetic/${argument(payload, "kind")}`;
    case "save_tool_configuration": {
      const value = field(payload, "configuration");
      if (!value || typeof value !== "object") throw new Error("Missing synthetic approval.");
      configurations.set(configKey(context(payload)), { ...defaultConfiguration, ...value, executableSha256: "a".repeat(64) });
      return null;
    }
    case "start_tool_session": {
      const value = context(payload);
      if (!configuration(value).enabled) throw new Error("Synthetic executable was not approved.");
      if (value.kind === "terminal" && state.platform === "windows") throw new Error("Synthetic Windows terminal is unsupported.");
      const request = field(payload, "request");
      const runId = `synthetic-run-${state.starts.length + 1}`;
      const paths = field(request, "paths");
      if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) throw new Error("Invalid synthetic source snapshot.");
      state.starts.push({ pluginId: argument(payload, "pluginId"), kind: value.kind, runId,
        input: field(request, "input"), trigger: argument(request, "trigger") });
      runs.set(runId, { kind: value.kind, pluginId: argument(payload, "pluginId"), polls: 0, stopped: false });
      return { runId, scope: { projectId: value.projectId, rootPath: "" }, documents: paths.map((path) => ({ path, version: hash(path) })) };
    }
    case "poll_tool_session": {
      const run = runs.get(argument(payload, "runId"));
      if (!run || run.stopped) return { status: "cancelled", exitCode: null, error: "Tool cancelled.", events: [] };
      const first = run.polls++ === 0;
      if (run.kind === "terminal") return { status: "running", exitCode: null, error: null, events: first ? [{
        stream: "terminal", data: btoa(String.fromCharCode(...new TextEncoder().encode("\u001b[31mInvented λ terminal\u001b[0m\r\nexample.ts:1:1\r\nhttps://example.test/\r\n"))),
      }] : [] };
      if (run.kind === "linter") return {
        status: state.lintMode === "clean" ? "succeeded" : "failed", exitCode: state.lintMode === "clean" ? 0 : 1, error: null,
        events: [{ stream: "stdout", data: JSON.stringify(state.lintMode === "clean" ? [] : [{
          filePath: "example.ts", messages: [{ line: 1, column: 14, severity: 1, ruleId: "quotes", message: "Use single quotes.",
            fix: { range: [13, 22], text: "'example'" } }],
        }]) }],
      };
      if (first || state.holdBuild) return { status: "running", exitCode: null, error: null,
        events: first ? [{ stream: "stdout", data: "Building synthetic source\n" }] : [] };
      return { status: "failed", exitCode: 2, error: null, events: [{
        stream: "stderr", data: "example.ts:1:1: warning: Example warning. [W1]\nexample.ts:1:7: error: Example compiler error. [E1]\n",
      }] };
    }
    case "validate_tool_documents": {
      const documents = field(payload, "documents");
      if (!Array.isArray(documents)) throw new Error("Missing synthetic source versions.");
      return documents.filter((document) => argument(document, "version") !== hash(argument(document, "path")))
        .map((document) => argument(document, "path"));
    }
    case "stop_tool_session": {
      const id = argument(payload, "runId");
      state.stops.push(id); const run = runs.get(id); if (run) run.stopped = true;
      return null;
    }
    case "stop_tool_sessions": {
      const id = argument(payload, "pluginId");
      for (const [runId, run] of runs) if (run.pluginId === id) { run.stopped = true; state.stops.push(runId); }
      return null;
    }
    case "write_tool_input": state.input.push(argument(payload, "data")); return null;
    case "resize_tool_terminal": return null;
    case "read_clipboard_text": return "synthetic paste";
    case "copy_file_content": state.copies.push(argument(payload, "content")); return null;
    case "open_external_uri": state.externalLinks.push(argument(payload, "uri")); return null;
    case "plugin:deep-link|get_current":
    case "recover_plugin_transactions":
    case "save_tab_session":
    case "prepare_exit": return null;
    default: state.unexpectedCommands.push(command); throw new Error(`Unexpected tooling fixture IPC: ${command}`);
  }
}, { shouldMockEvents: true });
