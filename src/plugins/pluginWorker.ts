/// <reference lib="webworker" />

import type {
  DenotePlugin,
  PluginActivationContext,
  PluginCapabilities,
  PluginCapability,
  PluginCommand,
  PluginDisposable,
  PluginGitResult,
  PluginLogger,
  PluginNetworkResponse,
  PluginNoteEvent,
  PluginProcessResult,
  PluginProjectContext,
  PluginProjectContextChangeEvent,
  PluginProjectRepositoryContext,
  PluginSourceControlProvider,
  PluginSourceControlViewModel,
  PluginTextDocument,
  PluginUserActionContext,
} from "@denote/plugin-sdk";
import type {
  PluginHostMessage,
  PluginRuntimeMessage,
  PluginWorkerConnectMessage,
} from "./runtimeMessages";
import {
  isPluginHostMessage,
  isPluginSourceControlViewModel,
} from "./runtimeMessages";
import { normalizeAutomaticLocalCommitSchedule } from "./automaticCommits";
import { createGitCapability } from "./gitCapability";
import { isPluginEmojiPicker, emojiPickerMatchesManifest } from "@denote/plugin-sdk";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * The one standardized source-control action that must reach a provider while
 * the operation it names is still running. Queueing it behind that operation
 * would make it arrive only once there is nothing left to cancel.
 */
const CANCEL_SOURCE_CONTROL_ACTION = "cancel-operation";

const commandHandlers = new Map<string, PluginCommand["run"]>();
const sourceControlHandlers = new Map<
  string,
  PluginSourceControlProvider["runAction"]
>();
const noteListeners = new Set<
  (event: PluginNoteEvent) => void | Promise<void>
>();
const automaticCommitSchedules = new Set<string>();
const emojiPickers = new Set<string>();
const projectContextListeners = new Set<
  (event: PluginProjectContextChangeEvent) => void | Promise<void>
>();
const subscriptions: PluginDisposable[] = [];
const pending = new Map<string, PendingRequest>();
let pluginId = "";
let expectedVersion = "";
let permissions = new Set<PluginCapability>();
let plugin: DenotePlugin | null = null;
let port: MessagePort | null = null;
let cleaned = false;
let projectContext: PluginProjectContext | null = null;
let projectRepositories: PluginProjectRepositoryContext[] = [];
let projectContextObserved = false;
let hostMessageQueue = Promise.resolve();
let projectContextQueue = Promise.resolve();

function send(message: PluginRuntimeMessage): void {
  if (!port) {
    throw new Error("Plugin worker is not connected.");
  }
  port.postMessage(message);
}

function hostRequest<T>(
  operation: string,
  key?: string,
  value?: unknown,
  actionId?: string,
  operationId?: string,
): Promise<T> {
  const requestId = crypto.randomUUID();
  send({
    type: "host-request",
    requestId,
    operation,
    key,
    value,
    actionId,
    operationId,
  });
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, {
      resolve: (result) => resolve(result as T),
      reject,
    });
  });
}

function userActionContext(actionId: string): PluginUserActionContext {
  const capabilities: PluginUserActionContext["capabilities"] = {};
  if (permissions.has("workspace-read")) {
    capabilities.workspaceRead = {
      readText: (path) =>
        hostRequest<PluginTextDocument>(
          "workspace.read",
          undefined,
          { path },
          actionId,
        ),
    };
  }
  if (permissions.has("workspace-write")) {
    capabilities.workspaceWrite = {
      readText: (path) =>
        hostRequest<PluginTextDocument>(
          "workspace.read-write",
          undefined,
          { path },
          actionId,
        ),
      writeText: (path, content, version) =>
        hostRequest<void>(
          "workspace.write",
          undefined,
          { path, content, version },
          actionId,
        ),
    };
  }
  if (permissions.has("network")) {
    capabilities.network = {
      request: (request) =>
        hostRequest<PluginNetworkResponse>(
          "network.request",
          undefined,
          request,
          actionId,
        ),
    };
  }
  if (permissions.has("clipboard-read")) {
    capabilities.clipboardRead = {
      readText: () =>
        hostRequest<string>(
          "clipboard.read",
          undefined,
          undefined,
          actionId,
        ),
    };
  }
  if (permissions.has("clipboard-write")) {
    capabilities.clipboardWrite = {
      writeText: (text) =>
        hostRequest<void>("clipboard.write", undefined, text, actionId),
    };
  }
  if (permissions.has("notifications")) {
    capabilities.notifications = {
      show: (title, body) =>
        hostRequest<void>(
          "notifications.show",
          undefined,
          { title, body },
          actionId,
        ),
    };
  }
  if (permissions.has("process")) {
    capabilities.process = {
      run: (request) =>
        hostRequest<PluginProcessResult>(
          "process.run",
          undefined,
          request,
          actionId,
        ),
    };
  }
  if (permissions.has("git")) {
    capabilities.git = createGitCapability(
      (request, operationId) =>
        hostRequest<PluginGitResult>(
          "git.run",
          undefined,
          request,
          actionId,
          operationId,
        ),
      (operation, value, operationId) =>
        hostRequest(operation, undefined, value, actionId, operationId),
    );
  }
  return { capabilities };
}

function runtimeContext(): PluginActivationContext {
  const logger: PluginLogger = {
    debug: (message, details) =>
      send({ type: "log", level: "debug", message, details }),
    info: (message, details) =>
      send({ type: "log", level: "info", message, details }),
    warn: (message, details) =>
      send({ type: "log", level: "warn", message, details }),
    error: (message, details) =>
      send({ type: "log", level: "error", message, details }),
  };
  const capabilities: PluginCapabilities = {};
  if (permissions.has("commands")) {
    capabilities.commands = {
      register(command) {
        validateContribution(command, "command");
        if (commandHandlers.has(command.id)) {
          throw new Error(`Command ${command.id} is already registered.`);
        }
        commandHandlers.set(command.id, command.run);
        send({
          type: "register-command",
          id: command.id,
          title: command.title,
        });
        return disposable(() => {
          commandHandlers.delete(command.id);
          send({ type: "unregister-command", id: command.id });
        });
      },
    };
  }
  if (permissions.has("sidebar")) {
    capabilities.sidebar = {
      register(view) {
        validateContribution(view, "sidebar");
        if (typeof view.content !== "string") {
          throw new Error("Invalid sidebar registration.");
        }
        send({
          type: "register-sidebar",
          id: view.id,
          title: view.title,
          content: view.content,
        });
        return disposable(() =>
          send({ type: "unregister-sidebar", id: view.id }),
        );
      },
    };
  }
  if (permissions.has("status")) {
    capabilities.status = {
      register(item) {
        if (
          !item ||
          typeof item.id !== "string" ||
          typeof item.text !== "string"
        ) {
          throw new Error("Invalid status registration.");
        }
        validateContributionId(item.id, "status");
        send({ type: "register-status", id: item.id, text: item.text });
        return disposable(() =>
          send({ type: "unregister-status", id: item.id }),
        );
      },
    };
  }
  if (permissions.has("editor-decoration")) {
    capabilities.editorDecoration = {
      register(decoration) {
        if (
          !decoration ||
          typeof decoration.id !== "string" ||
          typeof decoration.pattern !== "string" ||
          !["highlight", "warning", "muted"].includes(decoration.style)
        ) {
          throw new Error("Invalid editor decoration registration.");
        }
        validateContributionId(decoration.id, "decoration");
        send({
          type: "register-decoration",
          id: decoration.id,
          pattern: decoration.pattern,
          style: decoration.style,
          caseSensitive: decoration.caseSensitive === true,
        });
        return disposable(() =>
          send({ type: "unregister-decoration", id: decoration.id }),
        );
      },
    };
  }
  if (permissions.has("emoji-picker")) {
    capabilities.emojiPicker = {
      register(picker) {
        if (
          cleaned ||
          !isPluginEmojiPicker(picker) ||
          !plugin ||
          !emojiPickerMatchesManifest(picker, plugin.manifest) ||
          emojiPickers.size > 0
        ) {
          throw new Error("Invalid or duplicate emoji picker registration.");
        }
        emojiPickers.add(picker.id);
        send({ type: "register-emoji-picker", picker });
        let disposed = false;
        return disposable(() => {
          if (!disposed) {
            disposed = true;
            emojiPickers.delete(picker.id);
            send({ type: "unregister-emoji-picker", id: picker.id });
          }
        });
      },
    };
  }
  if (permissions.has("note-events")) {
    capabilities.noteEvents = {
      subscribe(listener) {
        if (typeof listener !== "function") {
          throw new Error("Note event listener must be a function.");
        }
        noteListeners.add(listener);
        return disposable(() => noteListeners.delete(listener));
      },
    };
  }
  if (permissions.has("project-context")) {
    capabilities.projectContext = {
      getCurrent: () => cloneProjectContext(projectContext),
      getRepositories: () => cloneProjectRepositories(projectRepositories),
      subscribe(listener) {
        if (typeof listener !== "function") {
          throw new Error("Project context listener must be a function.");
        }
        projectContextListeners.add(listener);
        return disposable(() => projectContextListeners.delete(listener));
      },
    };
  }
  if (permissions.has("source-control")) {
    capabilities.sourceControl = {
      register(provider) {
        validateContribution(provider, "source control provider");
        if (typeof provider.runAction !== "function") {
          throw new Error("Invalid source control provider registration.");
        }
        validateSourceControlModel(provider.initialModel);
        if (sourceControlHandlers.has(provider.id)) {
          throw new Error(
            `Source control provider ${provider.id} is already registered.`,
          );
        }
        sourceControlHandlers.set(provider.id, provider.runAction);
        let disposed = false;
        send({
          type: "register-source-control",
          id: provider.id,
          title: provider.title,
          model: provider.initialModel,
        });
        return {
          update(model) {
            if (disposed || !sourceControlHandlers.has(provider.id)) {
              throw new Error(
                `Source control provider ${provider.id} is no longer registered.`,
              );
            }
            validateSourceControlModel(model);
            send({
              type: "update-source-control",
              id: provider.id,
              model,
            });
          },
          dispose() {
            if (disposed) {
              return;
            }
            disposed = true;
            sourceControlHandlers.delete(provider.id);
            send({ type: "unregister-source-control", id: provider.id });
          },
        };
      },
    };
  }
  if (permissions.has("automatic-local-commit")) {
    capabilities.automaticLocalCommit = {
      register(schedule) {
        // A standing schedule is validated before it leaves the worker, so a
        // plugin learns immediately that a value was refused instead of
        // silently running on host-repaired terms.
        const normalized = normalizeAutomaticLocalCommitSchedule(
          pluginId,
          schedule,
        );
        if (automaticCommitSchedules.has(normalized.id)) {
          throw new Error(
            `Automatic local commit ${normalized.id} is already registered.`,
          );
        }
        automaticCommitSchedules.add(normalized.id);
        let disposed = false;
        send({
          type: "register-automatic-local-commit",
          schedule: normalized,
        });
        return {
          update(next) {
            if (disposed || !automaticCommitSchedules.has(normalized.id)) {
              throw new Error(
                `Automatic local commit ${normalized.id} is no longer registered.`,
              );
            }
            send({
              type: "update-automatic-local-commit",
              schedule: normalizeAutomaticLocalCommitSchedule(pluginId, {
                ...next,
                id: normalized.id,
              }),
            });
          },
          dispose() {
            if (disposed) {
              return;
            }
            disposed = true;
            automaticCommitSchedules.delete(normalized.id);
            send({
              type: "unregister-automatic-local-commit",
              id: normalized.id,
            });
          },
        };
      },
    };
  }
  if (permissions.has("secure-storage")) {
    capabilities.secureStorage = {
      get: (key) => hostRequest<string | null>("secret.get", key),
      set: (key, value) => hostRequest<void>("secret.set", key, value),
      delete: (key) => hostRequest<void>("secret.delete", key),
    };
  }
  return {
    pluginId,
    logger,
    storage: {
      get: <T>(key: string) => hostRequest<T | null>("storage.get", key),
      set: <T>(key: string, value: T) =>
        hostRequest<void>("storage.set", key, value),
      delete: (key) => hostRequest<void>("storage.delete", key),
      clear: () => hostRequest<void>("storage.clear"),
    },
    settings: {
      getAll: () =>
        hostRequest<Record<string, unknown>>("settings.get"),
    },
    capabilities,
    subscriptions: {
      add(value) {
        if (!value || typeof value.dispose !== "function") {
          throw new Error("Plugin subscription must be disposable.");
        }
        subscriptions.push(value);
      },
    },
  };
}

function validateContribution(
  value: { id: string; title: string } | null | undefined,
  kind: string,
): asserts value is { id: string; title: string } {
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.title !== "string"
  ) {
    throw new Error(`Invalid ${kind} registration.`);
  }
  validateContributionId(value.id, kind);
}

function validateContributionId(id: string, kind: string): void {
  if (!id.startsWith(`${pluginId}.`)) {
    throw new Error(
      `Plugin ${kind} IDs must use the ${pluginId}. prefix.`,
    );
  }
}

function validateSourceControlModel(
  model: PluginSourceControlViewModel,
): void {
  if (!isPluginSourceControlViewModel(model)) {
    throw new Error("Invalid source control view model.");
  }
}

function disposable(dispose: () => void): PluginDisposable {
  return { dispose };
}

function cloneProjectContext(
  context: PluginProjectContext | null,
): PluginProjectContext | null {
  return context
    ? { projectId: context.projectId, rootPath: context.rootPath }
    : null;
}

function cloneProjectContextChangeEvent(
  event: PluginProjectContextChangeEvent,
): PluginProjectContextChangeEvent {
  const repositories = cloneProjectRepositories(event.repositories ?? []);
  return {
    previous: cloneProjectContext(event.previous),
    current: cloneProjectContext(event.current),
    ...(repositories.length > 0 ? { repositories } : {}),
    workspaceChanged: event.workspaceChanged === true,
  };
}

function cloneProjectRepositories(
  repositories: PluginProjectRepositoryContext[],
): PluginProjectRepositoryContext[] {
  return repositories.map((repository) => ({ ...repository }));
}

async function cleanup(): Promise<unknown[]> {
  if (cleaned) {
    return [];
  }
  cleaned = true;
  const failures: unknown[] = [];
  try {
    await plugin?.deactivate?.();
  } catch (error) {
    failures.push(error);
  }
  for (const subscription of subscriptions.reverse()) {
    try {
      await subscription.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  noteListeners.clear();
  projectContextListeners.clear();
  commandHandlers.clear();
  sourceControlHandlers.clear();
  automaticCommitSchedules.clear();
  emojiPickers.clear();
  return failures;
}

async function handleMessage(message: PluginHostMessage): Promise<void> {
  if (message.type === "host-response") {
    const request = pending.get(message.requestId);
    if (!request) {
      return;
    }
    pending.delete(message.requestId);
    if (message.error) {
      request.reject(new Error(message.error));
    } else {
      request.resolve(message.value);
    }
    return;
  }
  if (message.type === "activate") {
    try {
      if (
        !plugin ||
        plugin.manifest.id !== pluginId ||
        plugin.manifest.version !== expectedVersion
      ) {
        throw new Error("Loaded plugin does not match catalog metadata.");
      }
      if (
        permissions.has("project-context") &&
        !projectContextObserved &&
        Object.prototype.hasOwnProperty.call(message, "projectContext")
      ) {
        // A change that arrived while activation was still running is newer
        // than the snapshot the activation message carried.
        projectContext = cloneProjectContext(message.projectContext ?? null);
        projectRepositories = cloneProjectRepositories(message.repositories ?? []);
      }
      await plugin.activate(runtimeContext());
      send({ type: "activated" });
    } catch (error) {
      await cleanup();
      send({ type: "activation-error", error: errorMessage(error) });
    }
    return;
  }
  if (message.type === "project-context-change") {
    if (!permissions.has("project-context")) {
      return;
    }
    projectContextObserved = true;
    projectContext = cloneProjectContext(message.event.current);
    projectRepositories = cloneProjectRepositories(message.event.repositories ?? []);
    const event = cloneProjectContextChangeEvent(message.event);
    for (const listener of projectContextListeners) {
      try {
        await listener(cloneProjectContextChangeEvent(event));
      } catch (error) {
        send({ type: "runtime-error", error: errorMessage(error) });
        return;
      }
    }
    return;
  }
  if (message.type === "run-command") {
    try {
      const run = commandHandlers.get(message.commandId);
      if (!run) {
        throw new Error("Plugin command is no longer registered.");
      }
      await run(userActionContext(message.requestId));
      send({ type: "command-result", requestId: message.requestId });
    } catch (error) {
      send({
        type: "command-result",
        requestId: message.requestId,
        error: errorMessage(error),
      });
    }
    return;
  }
  if (message.type === "run-source-control-action") {
    try {
      const run = sourceControlHandlers.get(message.providerId);
      if (!run) {
        throw new Error("Source control provider is no longer registered.");
      }
      await run(message.action, userActionContext(message.requestId));
      send({
        type: "source-control-action-result",
        requestId: message.requestId,
      });
    } catch (error) {
      send({
        type: "source-control-action-result",
        requestId: message.requestId,
        error: errorMessage(error),
      });
    }
    return;
  }
  if (message.type === "note-event") {
    for (const listener of noteListeners) {
      try {
        await listener(message.event);
      } catch (error) {
        send({ type: "runtime-error", error: errorMessage(error) });
        return;
      }
    }
    return;
  }
  const failures = await cleanup();
  send({
    type: "deactivated",
    requestId: message.requestId,
    error: failures.length > 0 ? "Plugin cleanup failed." : undefined,
  });
}

function blockAmbientCapabilities(): void {
  const names = [
    "BroadcastChannel",
    "EventSource",
    "SharedWorker",
    "WebSocket",
    "WebTransport",
    "Worker",
    "XMLHttpRequest",
    "caches",
    "fetch",
    "importScripts",
    "indexedDB",
  ];
  for (const name of names) {
    Object.defineProperty(self, name, {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  }
}

function isPlugin(value: unknown): value is DenotePlugin {
  return (
    isRecord(value) &&
    isRecord(value.manifest) &&
    typeof value.manifest.id === "string" &&
    typeof value.manifest.version === "string" &&
    typeof value.activate === "function"
  );
}

function isConnectMessage(value: unknown): value is PluginWorkerConnectMessage {
  return (
    isRecord(value) &&
    value.type === "connect" &&
    typeof value.moduleUrl === "string" &&
    typeof value.pluginId === "string" &&
    typeof value.expectedVersion === "string" &&
    Array.isArray(value.permissions) &&
    value.permissions.every((permission) => typeof permission === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportRuntimeError(error: unknown): void {
  send({ type: "runtime-error", error: errorMessage(error) });
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!isConnectMessage(event.data) || event.ports.length !== 1) {
    return;
  }
  const message = event.data;
  pluginId = message.pluginId;
  expectedVersion = message.expectedVersion;
  permissions = new Set(message.permissions);
  port = event.ports[0];
  self.onmessage = null;
  port.onmessage = (portEvent: MessageEvent<unknown>) => {
    if (!isPluginHostMessage(portEvent.data)) {
      send({ type: "runtime-error", error: "Invalid plugin host message." });
      return;
    }
    const hostMessage: PluginHostMessage = portEvent.data;
    if (hostMessage.type === "host-response") {
      void handleMessage(hostMessage);
      return;
    }
    if (
      hostMessage.type === "run-source-control-action" &&
      hostMessage.action.id === CANCEL_SOURCE_CONTROL_ACTION
    ) {
      // Cancellation is the only action that runs concurrently, because the
      // operation it names is what would otherwise be holding the queue. It
      // still carries its own request ID and its own host-validated action
      // lease, so correlation, lease checks, and the failure result it reports
      // are exactly those of any other action.
      void handleMessage(hostMessage).catch(reportRuntimeError);
      return;
    }
    if (hostMessage.type === "project-context-change") {
      // A project change is delivered while an action is still in flight, so a
      // provider can invalidate a model update that belongs to the workspace
      // the user just left. Ordinary messages received afterwards still wait
      // for it, so nothing else becomes concurrent.
      const change = (projectContextQueue = projectContextQueue
        .then(() => handleMessage(hostMessage))
        .catch(reportRuntimeError));
      hostMessageQueue = hostMessageQueue.then(() => change);
      return;
    }
    hostMessageQueue = hostMessageQueue
      .then(() => handleMessage(hostMessage))
      .catch(reportRuntimeError);
  };
  port.start();
  try {
    blockAmbientCapabilities();
    const loaded: unknown = (
      await import(/* @vite-ignore */ message.moduleUrl)
    ).default;
    if (!isPlugin(loaded)) {
      throw new Error("Plugin entrypoint does not export a valid plugin.");
    }
    plugin = loaded;
    send({ type: "ready" });
  } catch (error) {
    send({ type: "activation-error", error: errorMessage(error) });
  }
};
