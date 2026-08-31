import { api, errorMessage } from "../lib/api";
import type { PluginView } from "../types";
import type {
  PluginNoteEvent,
  PluginProjectContext,
  PluginProjectContextChangeEvent,
} from "@denote/plugin-sdk";
import {
  privilegedHostOperation,
  runHostOperation,
  type PluginActionLeaseScope,
} from "./hostOperations";
import {
  isPluginRuntimeMessage,
  type PluginCommandContribution,
  type PluginDecorationContribution,
  type PluginRuntimeMessage,
  type PluginSidebarContribution,
  type PluginStatusContribution,
  type PluginWorkerConnectMessage,
} from "./runtimeMessages";

export type {
  PluginCommandContribution,
  PluginDecorationContribution,
  PluginSidebarContribution,
  PluginStatusContribution,
} from "./runtimeMessages";
export type { PluginActionLeaseScope } from "./hostOperations";

const ACTIVATION_TIMEOUT_MS = 10_000;
const DEACTIVATION_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 30_000;

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
  sidebarViews: Map<string, PluginSidebarContribution>;
  stagedSidebarViews: Map<string, PluginSidebarContribution>;
  statusItems: Map<string, PluginStatusContribution>;
  stagedStatusItems: Map<string, PluginStatusContribution>;
  decorations: Map<string, PluginDecorationContribution>;
  stagedDecorations: Map<string, PluginDecorationContribution>;
  permissions: Set<string>;
  pending: Map<string, PendingRequest>;
  activeActions: Map<string, PluginActionLeaseScope>;
  hostRequests: Set<Promise<void>>;
  handshakes: Set<PendingHandshake>;
  activated: boolean;
  phase: "starting" | "activating" | "active" | "deactivating" | "stopping";
}

interface PendingStart {
  generation: number;
  operation: Promise<void>;
}

export class PluginWorkerRuntime {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly starts = new Map<string, PendingStart>();
  private readonly stops = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, number>();
  private projectContext: PluginProjectContext | null = null;

  constructor(
    private readonly onCommandsChanged: (
      commands: PluginCommandContribution[],
    ) => void,
    private readonly onError: (pluginId: string, error: unknown) => void,
    private readonly onSidebarViewsChanged: (
      views: PluginSidebarContribution[],
    ) => void = () => {},
    private readonly onStatusItemsChanged: (
      items: PluginStatusContribution[],
    ) => void = () => {},
    private readonly onDecorationsChanged: (
      decorations: PluginDecorationContribution[],
    ) => void = () => {},
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
    runtime.activeActions.clear();
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

  async runCommand(
    pluginId: string,
    commandId: string,
    actionScope: PluginActionLeaseScope,
  ): Promise<void> {
    const runtime = this.requireRuntime(pluginId);
    if (!runtime.activated || !runtime.commands.has(commandId)) {
      throw new Error(`Plugin command ${commandId} is not registered.`);
    }
    const requestId = crypto.randomUUID();
    const result = this.waitForRequest(runtime, requestId, COMMAND_TIMEOUT_MS);
    runtime.activeActions.set(requestId, {
      ...actionScope,
      projectId: runtime.permissions.has("project-context")
        ? actionScope.projectId
        : null,
    });
    runtime.port.postMessage({
      type: "run-command",
      commandId,
      requestId,
    });
    try {
      await result;
    } finally {
      runtime.activeActions.delete(requestId);
    }
  }

  isRunning(pluginId: string): boolean {
    return this.runtimes.get(pluginId)?.phase === "active";
  }

  broadcastNoteEvent(event: PluginNoteEvent): void {
    for (const runtime of this.runtimes.values()) {
      if (
        runtime.phase === "active" &&
        runtime.permissions.has("note-events")
      ) {
        runtime.port.postMessage({ type: "note-event", event });
      }
    }
  }

  setProjectContext(context: PluginProjectContext | null): void {
    validateProjectContext(context);
    if (sameProjectContext(this.projectContext, context)) {
      return;
    }
    if (projectIdentity(this.projectContext) !== projectIdentity(context)) {
      this.invalidateActionLeases();
    }
    const event: PluginProjectContextChangeEvent = {
      previous: cloneProjectContext(this.projectContext),
      current: cloneProjectContext(context),
    };
    this.projectContext = cloneProjectContext(context);
    for (const runtime of this.runtimes.values()) {
      if (
        (runtime.phase === "activating" || runtime.phase === "active") &&
        runtime.permissions.has("project-context")
      ) {
        runtime.port.postMessage({ type: "project-context-change", event });
      }
    }
  }

  invalidateActionLeases(): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.permissions.has("project-context")) {
        runtime.activeActions.clear();
      }
    }
  }

  private async startRuntime(
    plugin: PluginView,
    generation: number,
  ): Promise<void> {
    const pluginId = plugin.catalog.manifest.id;
    const code = await api.readPluginEntrypoint(pluginId);
    this.assertCurrent(pluginId, generation);

    const moduleUrl = dataModuleUrl(code);
    const worker = new Worker(new URL("./pluginWorker.ts", import.meta.url), {
      type: "module",
      name: `denote-plugin-${pluginId}`,
    });
    const channel = new MessageChannel();
    const runtime: Runtime = {
      worker,
      port: channel.port1,
      commands: new Map(),
      stagedCommands: new Map(),
      sidebarViews: new Map(),
      stagedSidebarViews: new Map(),
      statusItems: new Map(),
      stagedStatusItems: new Map(),
      decorations: new Map(),
      stagedDecorations: new Map(),
      permissions: new Set(
        plugin.approvedPermissions.map(
          (permission) => permission.capability,
        ),
      ),
      pending: new Map(),
      activeActions: new Map(),
      hostRequests: new Set(),
      handshakes: new Set(),
      activated: false,
      phase: "starting",
    };
    this.runtimes.set(pluginId, runtime);
    runtime.port.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!isPluginRuntimeMessage(event.data)) {
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
      const connect: PluginWorkerConnectMessage = {
        type: "connect",
        moduleUrl,
        pluginId,
        expectedVersion: plugin.catalog.manifest.version,
        permissions: plugin.approvedPermissions.map(
          (permission) => permission.capability,
        ),
      };
      worker.postMessage(connect, [channel.port2]);
      await ready;
      this.assertCurrent(pluginId, generation);
      const activated = this.waitForMessage(
        runtime,
        "activated",
        ACTIVATION_TIMEOUT_MS,
      );
      runtime.phase = "activating";
      runtime.port.postMessage(
        runtime.permissions.has("project-context")
          ? {
              type: "activate",
              projectContext: cloneProjectContext(this.projectContext),
            }
          : { type: "activate" },
      );
      await activated;
      this.assertCurrent(pluginId, generation);
      runtime.activated = true;
      runtime.phase = "active";
      for (const [commandId, command] of runtime.stagedCommands) {
        runtime.commands.set(commandId, command);
      }
      runtime.stagedCommands.clear();
      for (const [viewId, view] of runtime.stagedSidebarViews) {
        runtime.sidebarViews.set(viewId, view);
      }
      runtime.stagedSidebarViews.clear();
      for (const [itemId, item] of runtime.stagedStatusItems) {
        runtime.statusItems.set(itemId, item);
      }
      runtime.stagedStatusItems.clear();
      for (const [decorationId, decoration] of runtime.stagedDecorations) {
        runtime.decorations.set(decorationId, decoration);
      }
      runtime.stagedDecorations.clear();
      this.publishCommands();
      this.publishSidebarViews();
      this.publishStatusItems();
      this.publishDecorations();
    } catch (error) {
      await this.teardownRuntime(pluginId);
      throw error;
    }
  }

  private async handleMessage(
    pluginId: string,
    message: PluginRuntimeMessage,
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
      case "register-sidebar": {
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("sidebar") ||
          !message.id.startsWith(`${pluginId}.`)
        ) {
          void this.failRuntime(
            pluginId,
            new Error(
              `Plugin ${pluginId} attempted an unauthorized sidebar registration.`,
            ),
          );
          return;
        }
        const view = {
          pluginId,
          id: message.id,
          title: message.title,
          content: message.content,
        };
        if (runtime.activated) {
          runtime.sidebarViews.set(message.id, view);
          this.publishSidebarViews();
        } else {
          runtime.stagedSidebarViews.set(message.id, view);
        }
        return;
      }
      case "unregister-sidebar":
        runtime.sidebarViews.delete(message.id);
        runtime.stagedSidebarViews.delete(message.id);
        this.publishSidebarViews();
        return;
      case "register-status": {
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("status") ||
          !message.id.startsWith(`${pluginId}.`)
        ) {
          void this.failRuntime(
            pluginId,
            new Error(
              `Plugin ${pluginId} attempted an unauthorized status registration.`,
            ),
          );
          return;
        }
        const item = {
          pluginId,
          id: message.id,
          text: message.text,
        };
        if (runtime.activated) {
          runtime.statusItems.set(message.id, item);
          this.publishStatusItems();
        } else {
          runtime.stagedStatusItems.set(message.id, item);
        }
        return;
      }
      case "unregister-status":
        runtime.statusItems.delete(message.id);
        runtime.stagedStatusItems.delete(message.id);
        this.publishStatusItems();
        return;
      case "register-decoration": {
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("editor-decoration") ||
          !message.id.startsWith(`${pluginId}.`) ||
          message.pattern.length > 256
        ) {
          void this.failRuntime(
            pluginId,
            new Error(
              `Plugin ${pluginId} attempted an unauthorized editor decoration.`,
            ),
          );
          return;
        }
        const decoration = {
          pluginId,
          id: message.id,
          pattern: message.pattern,
          style: message.style,
          caseSensitive: message.caseSensitive,
        };
        if (runtime.activated) {
          runtime.decorations.set(message.id, decoration);
          this.publishDecorations();
        } else {
          runtime.stagedDecorations.set(message.id, decoration);
        }
        return;
      }
      case "unregister-decoration":
        runtime.decorations.delete(message.id);
        runtime.stagedDecorations.delete(message.id);
        this.publishDecorations();
        return;
      case "host-request":
        if (
          privilegedHostOperation(message.operation) &&
          (runtime.phase !== "active" ||
            !message.actionId ||
            !runtime.activeActions.has(message.actionId))
        ) {
          runtime.port.postMessage({
            type: "host-response",
            requestId: message.requestId,
            error: "Plugin action capability lease is invalid or expired.",
          });
          return;
        }
        if (runtime.phase === "stopping") {
          runtime.port.postMessage({
            type: "host-response",
            requestId: message.requestId,
            error: "Plugin runtime is stopping.",
          });
          return;
        }
        {
          const request = this.handleHostRequest(
            pluginId,
            runtime,
            message,
            message.actionId
              ? runtime.activeActions.get(message.actionId)
              : undefined,
          );
          runtime.hostRequests.add(request);
          void request.finally(() => runtime.hostRequests.delete(request));
        }
        return;
      case "command-result":
        runtime.activeActions.delete(message.requestId);
        this.settle(runtime, message.requestId, message.error);
        return;
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
    message: Extract<PluginRuntimeMessage, { type: "host-request" }>,
    actionScope?: PluginActionLeaseScope,
  ): Promise<void> {
    try {
      const value = await runHostOperation(
        pluginId,
        message.operation,
        message.key,
        message.value,
        actionScope,
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
        if (!isPluginRuntimeMessage(event.data)) {
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
    this.publishSidebarViews();
    this.publishStatusItems();
    this.publishDecorations();
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

  private publishSidebarViews(): void {
    this.onSidebarViewsChanged(
      [...this.runtimes.values()].flatMap((runtime) => [
        ...runtime.sidebarViews.values(),
      ]),
    );
  }

  private publishStatusItems(): void {
    this.onStatusItemsChanged(
      [...this.runtimes.values()].flatMap((runtime) => [
        ...runtime.statusItems.values(),
      ]),
    );
  }

  private publishDecorations(): void {
    this.onDecorationsChanged(
      [...this.runtimes.values()].flatMap((runtime) => [
        ...runtime.decorations.values(),
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

function dataModuleUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}

function cloneProjectContext(
  context: PluginProjectContext | null,
): PluginProjectContext | null {
  return context
    ? { projectId: context.projectId, rootPath: context.rootPath }
    : null;
}

function sameProjectContext(
  left: PluginProjectContext | null,
  right: PluginProjectContext | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.projectId === right.projectId &&
      left.rootPath === right.rootPath)
  );
}

function projectIdentity(context: PluginProjectContext | null): string | null {
  return context?.projectId ?? null;
}

function validateProjectContext(context: PluginProjectContext | null): void {
  if (context === null) {
    return;
  }
  if (
    typeof context.projectId !== "string" ||
    context.projectId.length === 0 ||
    typeof context.rootPath !== "string" ||
    context.rootPath.includes("\0") ||
    context.rootPath.startsWith("/") ||
    context.rootPath.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(context.rootPath) ||
    context.rootPath.split(/[\\/]/).some((segment) => segment === "..")
  ) {
    throw new Error("Plugin project context must use a vault-relative root path.");
  }
}
