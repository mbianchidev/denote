/// <reference types="vite/client" />
import { mockIPC } from "@tauri-apps/api/mocks";
import { CODE_LANGUAGES, assertValidPluginCatalogEntry, parsePluginManifest, type PluginGitResult } from "@denote/plugin-sdk";
import type { InstalledPlugin, PluginView } from "../src/types";
import type { api } from "../src/lib/api";
import type { ToolEnvironment } from "../src/lib/projectTools";
import catalogJson from "../plugins/catalog.json";
import "./authoringFixture";

interface PluginLifecycleFixtureState {
  prepared: string[];
  committed: string[];
  removed: string[];
  entrypointReads: string[];
  startedWorkers: string[];
  terminatedWorkers: string[];
  activeWorkers: string[];
  installed: string[];
  failNextEnable: string | null;
}
declare global {
  interface Window { __DENOTE_PLUGIN_LIFECYCLE__: PluginLifecycleFixtureState }
}

const state: PluginLifecycleFixtureState = {
  prepared: [], committed: [], removed: [], entrypointReads: [],
  startedWorkers: [], terminatedWorkers: [], activeWorkers: [], installed: [],
  failNextEnable: null,
};
window.__DENOTE_PLUGIN_LIFECYCLE__ = state;
const workers = new Map<Worker, string>();
Object.defineProperty(state, "activeWorkers", { get: () => [...workers.values()].sort() });
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    if (options?.name?.startsWith("denote-plugin-")) {
      const id = options.name.slice("denote-plugin-".length);
      workers.set(this, id);
      state.startedWorkers.push(id);
    }
  }
  terminate() {
    const id = workers.get(this);
    if (id) {
      state.terminatedWorkers.push(id);
      workers.delete(this);
    }
    super.terminate();
  }
};

const files = import.meta.glob<string>("../plugins/*/dist/*.js", {
  eager: true, query: "?raw", import: "default",
});
const roots = new Map(Object.entries(import.meta.glob("../plugins/*/plugin.json", {
  eager: true, import: "default",
})).map(([path, value]) => [parsePluginManifest(value).id, path.slice(0, -"/plugin.json".length)]));
const plugins: PluginView[] = catalogJson.map((value) => {
  const catalog: unknown = value;
  assertValidPluginCatalogEntry(catalog);
  return {
    catalog, status: "not-installed", enabled: false, error: null, approvedPermissions: [],
    previouslyApproved: false, hasCredentials: false,
    settings: Object.fromEntries(Object.entries(catalog.manifest.settings?.properties ?? {})
      .map(([key, definition]) => [key, definition.default])),
  };
});
const transactions = new Map<string, string>();
const storage = new Map<string, Map<string, unknown>>();
const internals: unknown = Reflect.get(window, "__TAURI_INTERNALS__");
if (!internals || typeof internals !== "object") throw new Error("Missing synthetic native host.");
const invoke: unknown = Reflect.get(internals, "invoke");
if (typeof invoke !== "function") throw new Error("Missing synthetic native dispatcher.");

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? Reflect.get(payload, key) : undefined;
}
function argument(payload: unknown, key: string): string {
  const value = field(payload, key);
  if (typeof value !== "string") throw new Error(`Missing synthetic argument: ${key}`);
  return value;
}
function pluginFor(payload: unknown): PluginView {
  const id = argument(payload, "pluginId");
  const plugin = plugins.find((plugin) => plugin.catalog.manifest.id === id);
  if (!plugin) throw new Error(`Unknown synthetic plugin: ${id}`);
  return plugin;
}
function source(plugin: PluginView, entrypoint: string): string {
  const id = plugin.catalog.manifest.id;
  const code = files[`${roots.get(id)}/${entrypoint}`];
  if (typeof code !== "string") throw new Error(`Missing compiled synthetic entrypoint for ${id}.`);
  return code;
}
function scope(payload: unknown) {
  const projectId = field(field(payload, "context"), "projectId");
  if (projectId !== null && typeof projectId !== "string") throw new Error("Missing synthetic project scope.");
  return { projectId, rootPath: "" };
}

mockIPC((command, payload) => {
  switch (command) {
    case "list_plugins": return structuredClone(plugins);
    case "get_plugin_tool_statuses": return [];
    case "get_plugin_settings": return structuredClone(pluginFor(payload).settings);
    case "prepare_plugin_enable": {
      const plugin = pluginFor(payload);
      const id = plugin.catalog.manifest.id;
      state.prepared.push(id);
      if (state.failNextEnable === id) {
        state.failNextEnable = null;
        plugin.status = "failed";
        plugin.error = "Synthetic package verification failed. Review permissions and retry.";
        throw new Error(plugin.error);
      }
      if (JSON.stringify(field(payload, "approvedPermissions")) !== JSON.stringify(plugin.catalog.manifest.permissions)) {
        throw new Error("Synthetic package permissions were not approved.");
      }
      const transactionId = crypto.randomUUID();
      transactions.set(transactionId, id);
      plugin.approvedPermissions = structuredClone(plugin.catalog.manifest.permissions);
      plugin.runtimeManifest = plugin.catalog.manifest;
      state.installed.push(id);
      const installed: InstalledPlugin = {
        pluginId: id, version: plugin.catalog.manifest.version,
        entrypoint: plugin.catalog.manifest.entrypoint, transactionId,
      };
      return installed;
    }
    case "commit_plugin_enable": {
      const transaction = argument(payload, "transactionId");
      const id = transactions.get(transaction);
      const plugin = plugins.find((plugin) => plugin.catalog.manifest.id === id);
      if (!id || !plugin) throw new Error("Unknown synthetic transaction.");
      plugin.enabled = true;
      plugin.previouslyApproved = true;
      plugin.status = "enabled";
      plugin.error = null;
      transactions.delete(transaction);
      state.committed.push(id);
      return null;
    }
    case "rollback_plugin_enable": {
      const transaction = argument(payload, "transactionId");
      const id = transactions.get(transaction);
      if (!id) throw new Error("Unknown synthetic rollback.");
      transactions.delete(transaction);
      state.installed = state.installed.filter((value) => value !== id);
      return null;
    }
    case "read_plugin_entrypoint": {
      const plugin = pluginFor(payload);
      const id = plugin.catalog.manifest.id;
      if (!state.installed.includes(id)) throw new Error("Synthetic package was not installed.");
      state.entrypointReads.push(id);
      return source(plugin, plugin.catalog.manifest.entrypoint);
    }
    case "read_plugin_diagram_renderer": {
      const plugin = pluginFor(payload);
      const entrypoint = plugin.catalog.manifest.diagramRenderer?.entrypoint;
      if (!plugin.enabled || !entrypoint) throw new Error("Synthetic renderer is not enabled.");
      return source(plugin, entrypoint);
    }
    case "disable_plugin": {
      const plugin = pluginFor(payload);
      const id = plugin.catalog.manifest.id;
      plugin.enabled = false;
      plugin.status = "disabled";
      state.removed.push(id);
      state.installed = state.installed.filter((value) => value !== id);
      if (field(payload, "clearData") === true) storage.delete(id);
      return null;
    }
    case "plugin_storage_get":
      return structuredClone(storage.get(pluginFor(payload).catalog.manifest.id)?.get(argument(payload, "key")) ?? null);
    case "plugin_storage_set": {
      const id = pluginFor(payload).catalog.manifest.id;
      const values = storage.get(id) ?? new Map<string, unknown>();
      values.set(argument(payload, "key"), structuredClone(field(payload, "value")));
      storage.set(id, values);
      return null;
    }
    case "plugin_storage_delete":
      storage.get(pluginFor(payload).catalog.manifest.id)?.delete(argument(payload, "key"));
      return null;
    case "plugin_storage_clear":
      storage.delete(pluginFor(payload).catalog.manifest.id);
      return null;
    case "plugin_clock_sample":
    case "plugin_time_tracking_clock":
      return { bootId: "synthetic-plugin-boot", wallTimeMs: Date.now(), monotonicMs: Math.floor(performance.now()) };
    case "tool_environment": {
      const environment: ToolEnvironment = {
        configured: false, profileLanguage: "all", scope: scope(payload), platform: "macos",
        terminalSupported: true, limitation: null,
        configuration: {
          enabled: false, executable: "", executableSha256: "", arguments: [], format: "unix",
          columns: "unicode", stdin: false, runOn: "manual", debounceMs: 200, timeoutMs: 1000,
        },
      };
      return environment;
    }
    case "code_tool_environment": {
      const requested = argument(field(payload, "context"), "language");
      const language = CODE_LANGUAGES.find((language) => language === requested);
      if (!language) throw new Error("Unsupported synthetic code language.");
      const configuration = {
        enabled: false, executable: "", executableSha256: "", arguments: [],
        transport: "stdio" as const, options: {}, launch: {}, attach: {},
      };
      const environment: Awaited<ReturnType<typeof api.codeToolEnvironment>> = {
        scope: scope(payload), language,
        lsp: configuration, dap: configuration,
      };
      return environment;
    }
    case "plugin_git_request": {
      if (field(field(payload, "request"), "operation") !== "discover") {
        throw new Error("The synthetic lifecycle fixture permits only read-only Git discovery.");
      }
      const result: PluginGitResult = {
        operationId: argument(payload, "operationId"), exitCode: 0, cancelled: false,
        stdout: JSON.stringify({ initialized: false, encrypted: false }), stderr: "",
      };
      return result;
    }
    case "stop_code_sessions":
    case "stop_tool_sessions":
      pluginFor(payload);
      return null;
    default: return invoke(command, payload);
  }
}, { shouldMockEvents: true });
