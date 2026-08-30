import { api, errorMessage } from "../lib/api";
import type { PluginView } from "../types";

const ACTIVATION_TIMEOUT_MS = 10_000;
const DEACTIVATION_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 30_000;

export interface PluginCommandContribution {
  pluginId: string;
  id: string;
  title: string;
}

interface Runtime {
  worker: Worker;
  moduleUrl: string;
  bootstrapUrl: string;
  commands: Map<string, PluginCommandContribution>;
  pending: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >;
}

type RuntimeMessage =
  | { type: "activated" }
  | { type: "deactivated"; requestId: string; error?: string }
  | { type: "activation-error"; error: string }
  | { type: "runtime-error"; error: string }
  | { type: "register-command"; id: string; title: string }
  | { type: "unregister-command"; id: string }
  | {
      type: "host-request";
      requestId: string;
      operation: string;
      key?: string;
      value?: unknown;
    }
  | {
      type: "command-result";
      requestId: string;
      error?: string;
    }
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      details?: Record<string, unknown>;
    };

export class PluginWorkerRuntime {
  private readonly runtimes = new Map<string, Runtime>();

  constructor(
    private readonly onCommandsChanged: (
      commands: PluginCommandContribution[],
    ) => void,
    private readonly onError: (pluginId: string, error: unknown) => void,
  ) {}

  async start(plugin: PluginView): Promise<void> {
    const pluginId = plugin.catalog.manifest.id;
    if (this.runtimes.has(pluginId)) {
      return;
    }
    const code = await api.readPluginEntrypoint(pluginId);
    const moduleUrl = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    const bootstrapUrl = URL.createObjectURL(
      new Blob(
        [
          createBootstrap(
            moduleUrl,
            pluginId,
            plugin.catalog.manifest.version,
            plugin.catalog.manifest.permissions.map(
              (permission) => permission.capability,
            ),
          ),
        ],
        { type: "text/javascript" },
      ),
    );
    const runtime: Runtime = {
      worker: new Worker(bootstrapUrl, {
        type: "module",
        name: `denote-plugin-${pluginId}`,
      }),
      moduleUrl,
      bootstrapUrl,
      commands: new Map(),
      pending: new Map(),
    };
    this.runtimes.set(pluginId, runtime);
    runtime.worker.addEventListener("message", (event: MessageEvent<RuntimeMessage>) => {
      void this.handleMessage(pluginId, event.data);
    });
    runtime.worker.addEventListener("error", (event) => {
      const error = new Error(
        event.message || `Plugin ${pluginId} worker crashed.`,
      );
      this.onError(pluginId, error);
      this.rejectPending(runtime, error);
    });

    try {
      const activation = this.waitForActivation(pluginId, runtime);
      runtime.worker.postMessage({ type: "activate" });
      await activation;
    } catch (error) {
      this.terminate(pluginId);
      throw error;
    }
  }

  async stop(pluginId: string): Promise<void> {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      return;
    }
    const requestId = crypto.randomUUID();
    const result = this.waitFor(runtime, requestId, DEACTIVATION_TIMEOUT_MS);
    runtime.worker.postMessage({ type: "deactivate", requestId });
    try {
      await result;
    } finally {
      this.terminate(pluginId);
    }
  }

  async stopAll(): Promise<void> {
    const failures: unknown[] = [];
    for (const pluginId of [...this.runtimes.keys()]) {
      try {
        await this.stop(pluginId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new Error("One or more plugin workers failed to stop cleanly.");
    }
  }

  async runCommand(pluginId: string, commandId: string): Promise<void> {
    const runtime = this.requireRuntime(pluginId);
    if (!runtime.commands.has(commandId)) {
      throw new Error(`Plugin command ${commandId} is not registered.`);
    }
    const requestId = crypto.randomUUID();
    const result = this.waitFor(runtime, requestId, COMMAND_TIMEOUT_MS);
    runtime.worker.postMessage({
      type: "run-command",
      commandId,
      requestId,
    });
    await result;
  }

  private waitForActivation(pluginId: string, runtime: Runtime): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error(`Plugin ${pluginId} activation timed out.`));
      }, ACTIVATION_TIMEOUT_MS);
      const listener = (event: MessageEvent<RuntimeMessage>) => {
        if (event.data.type === "activated") {
          window.clearTimeout(timeout);
          runtime.worker.removeEventListener("message", listener);
          resolve();
        } else if (event.data.type === "activation-error") {
          window.clearTimeout(timeout);
          runtime.worker.removeEventListener("message", listener);
          reject(new Error(event.data.error));
        }
      };
      runtime.worker.addEventListener("message", listener);
    });
  }

  private async handleMessage(
    pluginId: string,
    message: RuntimeMessage,
  ): Promise<void> {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      return;
    }
    switch (message.type) {
      case "register-command": {
        if (!message.id.startsWith(`${pluginId}.`)) {
          this.onError(
            pluginId,
            new Error(`Plugin command ${message.id} must use the ${pluginId}. prefix.`),
          );
          return;
        }
        runtime.commands.set(message.id, {
          pluginId,
          id: message.id,
          title: message.title,
        });
        this.publishCommands();
        return;
      }
      case "unregister-command":
        runtime.commands.delete(message.id);
        this.publishCommands();
        return;
      case "host-request":
        await this.handleHostRequest(pluginId, runtime, message);
        return;
      case "command-result":
      case "deactivated":
        this.settle(runtime, message.requestId, message.error);
        return;
      case "runtime-error":
        this.onError(pluginId, new Error(message.error));
        return;
      case "log":
        console[message.level](`[plugin:${pluginId}] ${message.message}`, message.details);
        return;
      case "activated":
      case "activation-error":
        return;
    }
  }

  private async handleHostRequest(
    pluginId: string,
    runtime: Runtime,
    message: Extract<RuntimeMessage, { type: "host-request" }>,
  ): Promise<void> {
    try {
      const value = await runHostOperation(
        pluginId,
        message.operation,
        message.key,
        message.value,
      );
      runtime.worker.postMessage({
        type: "host-response",
        requestId: message.requestId,
        value,
      });
    } catch (error) {
      runtime.worker.postMessage({
        type: "host-response",
        requestId: message.requestId,
        error: errorMessage(error),
      });
    }
  }

  private waitFor(
    runtime: Runtime,
    requestId: string,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        runtime.pending.delete(requestId);
        reject(new Error("Plugin operation timed out."));
      }, timeoutMs);
      runtime.pending.set(requestId, { resolve, reject, timeout });
    });
  }

  private settle(runtime: Runtime, requestId: string, error?: string): void {
    const pending = runtime.pending.get(requestId);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeout);
    runtime.pending.delete(requestId);
    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(undefined);
    }
  }

  private terminate(pluginId: string): void {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      return;
    }
    runtime.worker.terminate();
    this.rejectPending(runtime, new Error(`Plugin ${pluginId} stopped.`));
    URL.revokeObjectURL(runtime.bootstrapUrl);
    URL.revokeObjectURL(runtime.moduleUrl);
    this.runtimes.delete(pluginId);
    this.publishCommands();
  }

  private rejectPending(runtime: Runtime, error: Error): void {
    for (const pending of runtime.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    runtime.pending.clear();
  }

  private publishCommands(): void {
    this.onCommandsChanged(
      [...this.runtimes.values()].flatMap((runtime) => [
        ...runtime.commands.values(),
      ]),
    );
  }

  private requireRuntime(pluginId: string): Runtime {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      throw new Error(`Plugin ${pluginId} is not running.`);
    }
    return runtime;
  }
}

async function runHostOperation(
  pluginId: string,
  operation: string,
  key?: string,
  value?: unknown,
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
    case "secret.get":
      return api.pluginSecretGet(pluginId, requireKey(key));
    case "secret.set":
      if (typeof value !== "string") {
        throw new Error("Secret value must be a string.");
      }
      return api.pluginSecretSet(pluginId, requireKey(key), value);
    case "secret.delete":
      return api.pluginSecretDelete(pluginId, requireKey(key));
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

function createBootstrap(
  moduleUrl: string,
  pluginId: string,
  version: string,
  permissions: string[],
): string {
  return `
import plugin from ${JSON.stringify(moduleUrl)};

const pluginId = ${JSON.stringify(pluginId)};
const expectedVersion = ${JSON.stringify(version)};
const permissions = new Set(${JSON.stringify(permissions)});
const commandHandlers = new Map();
const subscriptions = [];
const pending = new Map();

function hostRequest(operation, key, value) {
  const requestId = crypto.randomUUID();
  postMessage({ type: "host-request", requestId, operation, key, value });
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

const logger = Object.fromEntries(
  ["debug", "info", "warn", "error"].map((level) => [
    level,
    (message, details) => postMessage({ type: "log", level, message, details }),
  ]),
);
const capabilities = {};
if (permissions.has("commands")) {
  capabilities.commands = {
    register(command) {
      if (!command || typeof command.id !== "string" || typeof command.title !== "string" || typeof command.run !== "function") {
        throw new Error("Invalid command registration.");
      }
      if (commandHandlers.has(command.id)) {
        throw new Error("Command " + command.id + " is already registered.");
      }
      commandHandlers.set(command.id, command.run);
      postMessage({ type: "register-command", id: command.id, title: command.title });
      return {
        dispose() {
          commandHandlers.delete(command.id);
          postMessage({ type: "unregister-command", id: command.id });
        },
      };
    },
  };
}
if (permissions.has("secure-storage")) {
  capabilities.secureStorage = {
    get: (key) => hostRequest("secret.get", key),
    set: (key, value) => hostRequest("secret.set", key, value),
    delete: (key) => hostRequest("secret.delete", key),
  };
}
const context = {
  pluginId,
  logger,
  storage: {
    get: (key) => hostRequest("storage.get", key),
    set: (key, value) => hostRequest("storage.set", key, value),
    delete: (key) => hostRequest("storage.delete", key),
    clear: () => hostRequest("storage.clear"),
  },
  capabilities,
  subscriptions: {
    add(disposable) {
      if (!disposable || typeof disposable.dispose !== "function") {
        throw new Error("Plugin subscription must be disposable.");
      }
      subscriptions.push(disposable);
    },
  },
};

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "host-response") {
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.value);
    return;
  }
  if (message.type === "activate") {
    try {
      if (!plugin || plugin.manifest?.id !== pluginId || plugin.manifest?.version !== expectedVersion || typeof plugin.activate !== "function") {
        throw new Error("Loaded plugin does not match catalog metadata.");
      }
      await plugin.activate(context);
      postMessage({ type: "activated" });
    } catch (error) {
      postMessage({ type: "activation-error", error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type === "run-command") {
    try {
      const run = commandHandlers.get(message.commandId);
      if (!run) throw new Error("Plugin command is no longer registered.");
      await run({ capabilities: {} });
      postMessage({ type: "command-result", requestId: message.requestId });
    } catch (error) {
      postMessage({ type: "command-result", requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type === "deactivate") {
    const failures = [];
    try {
      if (typeof plugin.deactivate === "function") await plugin.deactivate();
    } catch (error) {
      failures.push(error);
    }
    for (const disposable of subscriptions.reverse()) {
      try {
        await disposable.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    postMessage({
      type: "deactivated",
      requestId: message.requestId,
      error: failures.length > 0 ? "Plugin cleanup failed." : undefined,
    });
  }
};
`;
}
