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

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
}

interface PendingHandshake {
  reject: (error: Error) => void;
  timeout: number;
}

interface Runtime {
  worker: Worker;
  port: MessagePort;
  commands: Map<string, PluginCommandContribution>;
  stagedCommands: Map<string, PluginCommandContribution>;
  permissions: Set<string>;
  pending: Map<string, PendingRequest>;
  hostRequests: Set<Promise<void>>;
  handshakes: Set<PendingHandshake>;
  activated: boolean;
  phase: "starting" | "activating" | "active" | "deactivating" | "stopping";
}

interface PendingStart {
  generation: number;
  operation: Promise<void>;
}

type RuntimeMessage =
  | { type: "ready" }
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
  | { type: "command-result"; requestId: string; error?: string }
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      details?: Record<string, unknown>;
    };

export class PluginWorkerRuntime {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly starts = new Map<string, PendingStart>();
  private readonly stops = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly onCommandsChanged: (
      commands: PluginCommandContribution[],
    ) => void,
    private readonly onError: (pluginId: string, error: unknown) => void,
  ) {}

  async start(plugin: PluginView): Promise<void> {
    const pluginId = plugin.catalog.manifest.id;
    const stopping = this.stops.get(pluginId);
    if (stopping) {
      await stopping;
    }
    if (this.runtimes.get(pluginId)?.activated) {
      return;
    }
    const existing = this.starts.get(pluginId);
    if (existing) {
      return existing.operation;
    }
    const generation = this.nextGeneration(pluginId);
    const operation = this.startRuntime(plugin, generation);
    this.starts.set(pluginId, { generation, operation });
    try {
      await operation;
    } finally {
      if (this.starts.get(pluginId)?.operation === operation) {
        this.starts.delete(pluginId);
      }
    }
  }

  async stop(pluginId: string): Promise<void> {
    const existing = this.stops.get(pluginId);
    if (existing) {
      return existing;
    }
    const operation = this.stopRuntime(pluginId);
    this.stops.set(pluginId, operation);
    try {
      await operation;
    } finally {
      if (this.stops.get(pluginId) === operation) {
        this.stops.delete(pluginId);
      }
    }
  }

  private async stopRuntime(pluginId: string): Promise<void> {
    this.nextGeneration(pluginId);
    const starting = this.starts.get(pluginId);
    if (starting) {
      await starting.operation.catch(() => {});
    }
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      return;
    }
    runtime.phase = "deactivating";
    const requestId = crypto.randomUUID();
    const result = this.waitForRequest(
      runtime,
      requestId,
      DEACTIVATION_TIMEOUT_MS,
    );
    runtime.port.postMessage({ type: "deactivate", requestId });
    try {
      await result;
    } finally {
      runtime.phase = "stopping";
      await Promise.allSettled([...runtime.hostRequests]);
      this.terminate(pluginId);
    }
  }

  async stopAll(): Promise<void> {
    const failures: unknown[] = [];
    while (
      this.starts.size > 0 ||
      this.runtimes.size > 0 ||
      this.stops.size > 0
    ) {
      const pluginIds = new Set([
        ...this.starts.keys(),
        ...this.runtimes.keys(),
        ...this.stops.keys(),
      ]);
      for (const pluginId of pluginIds) {
        try {
          await this.stop(pluginId);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error("One or more plugin workers failed to stop cleanly.");
    }
  }

  async runCommand(pluginId: string, commandId: string): Promise<void> {
    const runtime = this.requireRuntime(pluginId);
    if (!runtime.activated || !runtime.commands.has(commandId)) {
      throw new Error(`Plugin command ${commandId} is not registered.`);
    }
    const requestId = crypto.randomUUID();
    const result = this.waitForRequest(runtime, requestId, COMMAND_TIMEOUT_MS);
    runtime.port.postMessage({
      type: "run-command",
      commandId,
      requestId,
    });
    await result;
  }

  isRunning(pluginId: string): boolean {
    return this.runtimes.get(pluginId)?.phase === "active";
  }

  private async startRuntime(
    plugin: PluginView,
    generation: number,
  ): Promise<void> {
    const pluginId = plugin.catalog.manifest.id;
    const code = await api.readPluginEntrypoint(pluginId);
    this.assertCurrent(pluginId, generation);

    const moduleUrl = dataModuleUrl(code);
    const bootstrapUrl = dataModuleUrl(
      createBootstrap(
        moduleUrl,
        pluginId,
        plugin.catalog.manifest.version,
        plugin.approvedPermissions.map(
          (permission) => permission.capability,
        ),
      ),
    );
    const worker = new Worker(bootstrapUrl, {
      type: "module",
      name: `denote-plugin-${pluginId}`,
    });
    const channel = new MessageChannel();
    const runtime: Runtime = {
      worker,
      port: channel.port1,
      commands: new Map(),
      stagedCommands: new Map(),
      permissions: new Set(
        plugin.approvedPermissions.map(
          (permission) => permission.capability,
        ),
      ),
      pending: new Map(),
      hostRequests: new Set(),
      handshakes: new Set(),
      activated: false,
      phase: "starting",
    };
    this.runtimes.set(pluginId, runtime);
    runtime.port.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!isRuntimeMessage(event.data)) {
        const error = new Error(
          `Plugin ${pluginId} sent an invalid runtime message.`,
        );
        void this.failRuntime(pluginId, error);
        return;
      }
      void this.handleMessage(pluginId, event.data);
    });
    runtime.port.start();
    runtime.worker.addEventListener("error", (event) => {
      const error = new Error(
        event.message || `Plugin ${pluginId} worker crashed.`,
      );
      void this.failRuntime(pluginId, error);
    });

    try {
      const ready = this.waitForMessage(runtime, "ready", ACTIVATION_TIMEOUT_MS);
      worker.postMessage({ type: "connect" }, [channel.port2]);
      await ready;
      this.assertCurrent(pluginId, generation);
      const activated = this.waitForMessage(
        runtime,
        "activated",
        ACTIVATION_TIMEOUT_MS,
      );
      runtime.phase = "activating";
      runtime.port.postMessage({ type: "activate" });
      await activated;
      this.assertCurrent(pluginId, generation);
      runtime.activated = true;
      runtime.phase = "active";
      for (const [commandId, command] of runtime.stagedCommands) {
        runtime.commands.set(commandId, command);
      }
      runtime.stagedCommands.clear();
      this.publishCommands();
    } catch (error) {
      await this.teardownRuntime(pluginId);
      throw error;
    }
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
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("commands") ||
          !message.id.startsWith(`${pluginId}.`)
        ) {
          const error = new Error(
            `Plugin ${pluginId} attempted an unauthorized command registration.`,
          );
          void this.failRuntime(pluginId, error);
          return;
        }
        const command = {
          pluginId,
          id: message.id,
          title: message.title,
        };
        if (runtime.activated) {
          runtime.commands.set(message.id, command);
          this.publishCommands();
        } else {
          runtime.stagedCommands.set(message.id, command);
        }
        return;
      }
      case "unregister-command":
        runtime.commands.delete(message.id);
        runtime.stagedCommands.delete(message.id);
        this.publishCommands();
        return;
      case "host-request":
        if (runtime.phase === "stopping") {
          runtime.port.postMessage({
            type: "host-response",
            requestId: message.requestId,
            error: "Plugin runtime is stopping.",
          });
          return;
        }
        {
          const request = this.handleHostRequest(pluginId, runtime, message);
          runtime.hostRequests.add(request);
          void request.finally(() => runtime.hostRequests.delete(request));
        }
        return;
      case "command-result":
      case "deactivated":
        this.settle(runtime, message.requestId, message.error);
        return;
      case "runtime-error":
        void this.failRuntime(pluginId, new Error(message.error));
        return;
      case "log":
        console[message.level](
          `[plugin:${pluginId}] ${message.message}`,
          message.details,
        );
        return;
      case "ready":
        if (runtime.phase !== "starting") {
          this.protocolViolation(pluginId, `unexpected ${message.type}`);
        }
        return;
      case "activated":
        if (runtime.phase !== "activating") {
          this.protocolViolation(pluginId, `unexpected ${message.type}`);
        }
        return;
      case "activation-error":
        if (runtime.phase !== "starting" && runtime.phase !== "activating") {
          this.protocolViolation(pluginId, `unexpected ${message.type}`);
        }
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
      runtime.port.postMessage({
        type: "host-response",
        requestId: message.requestId,
        value,
      });
    } catch (error) {
      runtime.port.postMessage({
        type: "host-response",
        requestId: message.requestId,
        error: errorMessage(error),
      });
    }
  }

  private waitForMessage(
    runtime: Runtime,
    expectedType: "ready" | "activated",
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const handshake: PendingHandshake = {
        reject,
        timeout: 0,
      };
      const timeout = window.setTimeout(() => {
        runtime.port.removeEventListener("message", listener);
        runtime.handshakes.delete(handshake);
        reject(new Error(`Plugin ${expectedType} timed out.`));
      }, timeoutMs);
      handshake.timeout = timeout;
      const listener = (event: MessageEvent<unknown>) => {
        if (!isRuntimeMessage(event.data)) {
          return;
        }
        if (event.data.type === expectedType) {
          window.clearTimeout(timeout);
          runtime.port.removeEventListener("message", listener);
          runtime.handshakes.delete(handshake);
          resolve();
        } else if (event.data.type === "activation-error") {
          window.clearTimeout(timeout);
          runtime.port.removeEventListener("message", listener);
          runtime.handshakes.delete(handshake);
          reject(new Error(event.data.error));
        }
      };
      runtime.handshakes.add(handshake);
      runtime.port.addEventListener("message", listener);
    });
  }

  private waitForRequest(
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
    runtime.port.close();
    runtime.worker.terminate();
    this.rejectPending(runtime, new Error(`Plugin ${pluginId} stopped.`));
    for (const handshake of runtime.handshakes) {
      window.clearTimeout(handshake.timeout);
      handshake.reject(new Error(`Plugin ${pluginId} stopped.`));
    }
    runtime.handshakes.clear();
    this.runtimes.delete(pluginId);
    this.publishCommands();
  }

  private protocolViolation(pluginId: string, detail: string): void {
    const error = new Error(
      `Plugin ${pluginId} violated the runtime protocol: ${detail}.`,
    );
    void this.failRuntime(pluginId, error);
  }

  private async failRuntime(pluginId: string, error: Error): Promise<void> {
    await this.teardownRuntime(pluginId);
    this.onError(pluginId, error);
  }

  private async teardownRuntime(pluginId: string): Promise<void> {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      return;
    }
    runtime.phase = "stopping";
    await Promise.allSettled([...runtime.hostRequests]);
    this.terminate(pluginId);
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

  private nextGeneration(pluginId: string): number {
    const generation = (this.generations.get(pluginId) ?? 0) + 1;
    this.generations.set(pluginId, generation);
    return generation;
  }

  private assertCurrent(pluginId: string, generation: number): void {
    if (this.generations.get(pluginId) !== generation) {
      throw new Error(`Plugin ${pluginId} start was cancelled.`);
    }
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

function dataModuleUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
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
    case "host-request":
      return (
        typeof value.requestId === "string" &&
        typeof value.operation === "string" &&
        (value.key === undefined || typeof value.key === "string")
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

function createBootstrap(
  moduleUrl: string,
  pluginId: string,
  version: string,
  permissions: string[],
): string {
  return `
const pluginId = ${JSON.stringify(pluginId)};
const expectedVersion = ${JSON.stringify(version)};
const permissions = new Set(${JSON.stringify(permissions)});
const commandHandlers = new Map();
const subscriptions = [];
const pending = new Map();
let plugin;
let port;
let sendMessage;
let createRequestId;
let cleaned = false;

function send(message) {
  sendMessage(message);
}

function hostRequest(operation, key, value) {
  const requestId = createRequestId();
  send({ type: "host-request", requestId, operation, key, value });
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

function runtimeContext() {
  const logger = Object.fromEntries(
    ["debug", "info", "warn", "error"].map((level) => [
      level,
      (message, details) => send({ type: "log", level, message, details }),
    ]),
  );
  const capabilities = {};
  if (permissions.has("commands")) {
    capabilities.commands = {
      register(command) {
        if (!command || typeof command.id !== "string" || typeof command.title !== "string" || typeof command.run !== "function") {
          throw new Error("Invalid command registration.");
        }
        if (!command.id.startsWith(pluginId + ".")) {
          throw new Error("Plugin command IDs must use the " + pluginId + ". prefix.");
        }
        if (commandHandlers.has(command.id)) {
          throw new Error("Command " + command.id + " is already registered.");
        }
        commandHandlers.set(command.id, command.run);
        send({ type: "register-command", id: command.id, title: command.title });
        return {
          dispose() {
            commandHandlers.delete(command.id);
            send({ type: "unregister-command", id: command.id });
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
  return {
    pluginId,
    logger,
    storage: {
      get: (key) => hostRequest("storage.get", key),
      set: (key, value) => hostRequest("storage.set", key, value),
      delete: (key) => hostRequest("storage.delete", key),
      clear: () => hostRequest("storage.clear"),
    },
    settings: {
      getAll: () => hostRequest("settings.get"),
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
}

async function cleanup() {
  if (cleaned) return [];
  cleaned = true;
  const failures = [];
  try {
    if (typeof plugin?.deactivate === "function") await plugin.deactivate();
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
  return failures;
}

async function handleMessage(message) {
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
      await plugin.activate(runtimeContext());
      send({ type: "activated" });
    } catch (error) {
      await cleanup();
      send({ type: "activation-error", error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type === "run-command") {
    try {
      const run = commandHandlers.get(message.commandId);
      if (!run) throw new Error("Plugin command is no longer registered.");
      await run({ capabilities: {} });
      send({ type: "command-result", requestId: message.requestId });
    } catch (error) {
      send({ type: "command-result", requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type === "deactivate") {
    const failures = await cleanup();
    send({
      type: "deactivated",
      requestId: message.requestId,
      error: failures.length > 0 ? "Plugin cleanup failed." : undefined,
    });
  }
}

self.onmessage = async (event) => {
  if (event.data?.type !== "connect" || event.ports.length !== 1) {
    return;
  }
  port = event.ports[0];
  sendMessage = port.postMessage.bind(port);
  createRequestId = crypto.randomUUID.bind(crypto);
  self.onmessage = null;
  port.onmessage = (portEvent) => void handleMessage(portEvent.data);
  port.start();
  try {
    plugin = (await import(${JSON.stringify(moduleUrl)})).default;
    send({ type: "ready" });
  } catch (error) {
    send({ type: "activation-error", error: error instanceof Error ? error.message : String(error) });
  }
};
`;
}
