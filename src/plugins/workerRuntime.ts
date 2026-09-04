import { api, errorMessage } from "../lib/api";
import type { PluginView } from "../types";
import type {
  PluginNoteEvent,
  PluginManifest,
  PluginProjectContext,
  PluginProjectContextChangeEvent,
  PluginProjectRepositoryContext,
  PluginSourceControlAction,
} from "@denote/plugin-sdk";
import { emojiPickerMatchesManifest } from "@denote/plugin-sdk";
import {
  privilegedHostOperation,
  runHostOperation,
  type PluginVaultClonedHandler,
  type PluginActionLeaseScope,
} from "./hostOperations";
import {
  isPluginRuntimeMessage,
  type PluginAutomaticLocalCommitContribution,
  type PluginCommandContribution,
  type PluginDecorationContribution,
  type PluginEmojiPickerContribution,
  type PluginRuntimeMessage,
  type PluginSidebarContribution,
  type PluginSourceControlContribution,
  type PluginStatusContribution,
  type PluginWorkerConnectMessage,
} from "./runtimeMessages";

export type {
  PluginAutomaticLocalCommitContribution,
  PluginCommandContribution,
  PluginDecorationContribution,
  PluginEmojiPickerContribution,
  PluginSidebarContribution,
  PluginSourceControlContribution,
  PluginStatusContribution,
} from "./runtimeMessages";
export type {
  PluginActionHostSecrets,
  PluginActionLeaseScope,
  PluginVaultClonedHandler,
} from "./hostOperations";

const ACTIVATION_TIMEOUT_MS = 10_000;
const DEACTIVATION_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 30_000;
// Source-control actions drive the bounded native Git transport, whose own hard
// timeout is ten minutes. Only this lease is extended to match it.
const SOURCE_CONTROL_ACTION_TIMEOUT_MS = 600_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
  expectedType:
    | "command-result"
    | "source-control-action-result"
    | "deactivated";
}

interface PendingHandshake {
  reject: (error: Error) => void;
  timeout: number;
}

interface Runtime {
  manifest: PluginManifest;
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
  emojiPickers: Map<string, PluginEmojiPickerContribution>;
  stagedEmojiPickers: Map<string, PluginEmojiPickerContribution>;
  sourceControlProviders: Map<string, PluginSourceControlContribution>;
  stagedSourceControlProviders: Map<string, PluginSourceControlContribution>;
  automaticCommits: Map<string, PluginAutomaticLocalCommitContribution>;
  stagedAutomaticCommits: Map<string, PluginAutomaticLocalCommitContribution>;
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
  private projectRepositories: PluginProjectRepositoryContext[] = [];
  /**
   * Identifies the workspace the host is showing. It never leaves the host: it
   * is compared here and only the resulting change flag is broadcast.
   */
  private workspaceIdentity: string | null = null;

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
    private readonly onSourceControlProvidersChanged: (
      providers: PluginSourceControlContribution[],
    ) => void = () => {},
    private readonly onAutomaticLocalCommitsChanged: (
      schedules: PluginAutomaticLocalCommitContribution[],
    ) => void = () => {},
    /**
     * Receives the workspace a host clone produced. It stays in the host: the
     * runtime hands the snapshot to the renderer and returns only the clone
     * outcome to the plugin.
     */
    private readonly onVaultCloned: PluginVaultClonedHandler = () => {},
    private readonly onEmojiPickersChanged: (
      pickers: PluginEmojiPickerContribution[],
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
    this.publishEmojiPickers();
    runtime.activeActions.clear();
    const requestId = crypto.randomUUID();
    const result = this.waitForRequest(
      runtime,
      requestId,
      DEACTIVATION_TIMEOUT_MS,
      "deactivated",
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
    const result = this.waitForRequest(
      runtime,
      requestId,
      COMMAND_TIMEOUT_MS,
      "command-result",
    );
    runtime.activeActions.set(requestId, {
      ...actionScope,
      projectId: runtime.permissions.has("project-context")
        ? actionScope.projectId
        : null,
      projectIds: runtime.permissions.has("project-context")
        ? [...(actionScope.projectIds ?? [])]
        : [],
      // A command is not a source-control action, so its lease authorises none
      // of the host operations that are bound to one.
      sourceControlActionId: null,
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

  async runSourceControlAction(
    pluginId: string,
    providerId: string,
    action: PluginSourceControlAction,
    actionScope: PluginActionLeaseScope,
  ): Promise<void> {
    const runtime = this.requireRuntime(pluginId);
    if (
      !runtime.activated ||
      !runtime.sourceControlProviders.has(providerId)
    ) {
      throw new Error(
        `Plugin source control provider ${providerId} is not registered.`,
      );
    }
    const requestId = crypto.randomUUID();
    const result = this.waitForRequest(
      runtime,
      requestId,
      SOURCE_CONTROL_ACTION_TIMEOUT_MS,
      "source-control-action-result",
    );
    runtime.activeActions.set(requestId, {
      ...actionScope,
      projectId: runtime.permissions.has("project-context")
        ? actionScope.projectId
        : null,
      projectIds: runtime.permissions.has("project-context")
        ? [...(actionScope.projectIds ?? [])]
        : [],
      // The lease carries the action the host is running, so a host operation
      // reserved for one action cannot be reached from another.
      sourceControlActionId: action.id,
    });
    runtime.port.postMessage({
      type: "run-source-control-action",
      providerId,
      action,
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

  getEmojiPicker(pluginId: string, pickerId: string): PluginEmojiPickerContribution {
    const runtime = this.requireRuntime(pluginId);
    const picker = runtime.emojiPickers.get(pickerId);
    if (runtime.phase !== "active" || !picker) {
      throw new Error("The emoji picker is no longer available.");
    }
    return picker;
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

  setProjectContext(
    context: PluginProjectContext | null,
    repositories: PluginProjectRepositoryContext[] = [],
  ): void {
    validateProjectContext(context);
    validateProjectRepositories(repositories);
    if (
      sameProjectContext(this.projectContext, context) &&
      sameProjectRepositories(this.projectRepositories, repositories)
    ) {
      return;
    }
    if (projectIdentity(this.projectContext) !== projectIdentity(context)) {
      this.invalidateActionLeases();
    }
    const nextRepositories = cloneProjectRepositories(repositories);
    const event: PluginProjectContextChangeEvent = {
      previous: cloneProjectContext(this.projectContext),
      current: cloneProjectContext(context),
      ...(nextRepositories.length > 0
        ? { repositories: nextRepositories }
        : {}),
      workspaceChanged: false,
    };
    this.projectContext = cloneProjectContext(context);
    this.projectRepositories = nextRepositories;
    this.broadcastProjectContextChange(event);
  }

  /**
   * Records which workspace the host is showing. The identity is host-only: it
   * is never sent to a worker, so plugin code cannot read the vault path or
   * correlate one workspace with another. Only the fact that the workspace
   * changed crosses the boundary.
   */
  setWorkspaceIdentity(identity: string | null): void {
    if (this.workspaceIdentity === identity) {
      return;
    }
    this.workspaceIdentity = identity;
    // Every lease was granted against the previous workspace, so an action
    // still in flight must not be allowed to land on the new one. Unlike a
    // project change, this reaches plugins that never asked for project
    // context: their leases named the previous vault just the same.
    for (const runtime of this.runtimes.values()) {
      runtime.activeActions.clear();
    }
    const repositories = cloneProjectRepositories(this.projectRepositories);
    this.broadcastProjectContextChange({
      previous: cloneProjectContext(this.projectContext),
      current: cloneProjectContext(this.projectContext),
      ...(repositories.length > 0 ? { repositories } : {}),
      workspaceChanged: true,
    });
  }

  private broadcastProjectContextChange(
    event: PluginProjectContextChangeEvent,
  ): void {
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
    const manifest = plugin.runtimeManifest ?? plugin.catalog.manifest;
    const pluginId = manifest.id;
    const code = await api.readPluginEntrypoint(pluginId);
    this.assertCurrent(pluginId, generation);

    const moduleUrl = dataModuleUrl(code);
    const worker = new Worker(new URL("./pluginWorker.ts", import.meta.url), {
      type: "module",
      name: `denote-plugin-${pluginId}`,
    });
    const channel = new MessageChannel();
    const runtime: Runtime = {
      manifest,
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
      emojiPickers: new Map(),
      stagedEmojiPickers: new Map(),
      sourceControlProviders: new Map(),
      stagedSourceControlProviders: new Map(),
      automaticCommits: new Map(),
      stagedAutomaticCommits: new Map(),
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
      if (this.runtimes.get(pluginId) !== runtime) {
        return;
      }
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
      if (this.runtimes.get(pluginId) !== runtime) {
        return;
      }
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
        expectedVersion: manifest.version,
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
              ...(this.projectRepositories.length > 0
                ? {
                    repositories: cloneProjectRepositories(
                      this.projectRepositories,
                    ),
                  }
                : {}),
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
      for (const [id, picker] of runtime.stagedEmojiPickers) {
        runtime.emojiPickers.set(id, picker);
      }
      runtime.stagedEmojiPickers.clear();
      for (const [providerId, provider] of runtime.stagedSourceControlProviders) {
        runtime.sourceControlProviders.set(providerId, provider);
      }
      runtime.stagedSourceControlProviders.clear();
      for (const [scheduleId, schedule] of runtime.stagedAutomaticCommits) {
        runtime.automaticCommits.set(scheduleId, schedule);
      }
      runtime.stagedAutomaticCommits.clear();
      this.publishCommands();
      this.publishSidebarViews();
      this.publishStatusItems();
      this.publishDecorations();
      this.publishSourceControlProviders();
      this.publishAutomaticLocalCommits();
      this.publishEmojiPickers();
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
      case "register-emoji-picker": {
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("emoji-picker") ||
          !emojiPickerMatchesManifest(message.picker, runtime.manifest) ||
          runtime.emojiPickers.size + runtime.stagedEmojiPickers.size > 0
        ) {
          void this.failRuntime(
            pluginId,
            new Error(`Plugin ${pluginId} attempted an unauthorized emoji picker registration.`),
          );
          return;
        }
        const pickers = runtime.activated ? runtime.emojiPickers : runtime.stagedEmojiPickers;
        pickers.set(message.picker.id, { ...message.picker, pluginId });
        if (runtime.activated) {
          this.publishEmojiPickers();
        }
        return;
      }
      case "unregister-emoji-picker":
        runtime.emojiPickers.delete(message.id);
        runtime.stagedEmojiPickers.delete(message.id);
        this.publishEmojiPickers();
        return;
      case "register-source-control": {
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("source-control") ||
          !message.id.startsWith(`${pluginId}.`)
        ) {
          void this.failRuntime(
            pluginId,
            new Error(
              `Plugin ${pluginId} attempted an unauthorized source control registration.`,
            ),
          );
          return;
        }
        if (
          this.sourceControlProviderIdRegistered(message.id)
        ) {
          void this.failRuntime(
            pluginId,
            new Error(
              `Plugin ${pluginId} attempted a duplicate source control registration.`,
            ),
          );
          return;
        }
        const provider: PluginSourceControlContribution = {
          pluginId,
          id: message.id,
          title: message.title,
          model: message.model,
        };
        if (runtime.activated) {
          runtime.sourceControlProviders.set(message.id, provider);
          this.publishSourceControlProviders();
        } else {
          runtime.stagedSourceControlProviders.set(message.id, provider);
        }
        return;
      }
      case "update-source-control": {
        const current =
          runtime.sourceControlProviders.get(message.id) ??
          runtime.stagedSourceControlProviders.get(message.id);
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("source-control") ||
          !current
        ) {
          void this.failRuntime(
            pluginId,
            new Error(
              `Plugin ${pluginId} attempted to update an unregistered source control provider.`,
            ),
          );
          return;
        }
        const updated = { ...current, model: message.model };
        if (runtime.activated) {
          runtime.sourceControlProviders.set(message.id, updated);
          this.publishSourceControlProviders();
        } else {
          runtime.stagedSourceControlProviders.set(message.id, updated);
        }
        return;
      }
      case "unregister-source-control":
        runtime.sourceControlProviders.delete(message.id);
        runtime.stagedSourceControlProviders.delete(message.id);
        this.publishSourceControlProviders();
        return;
      case "register-automatic-local-commit":
      case "update-automatic-local-commit": {
        const registering = message.type === "register-automatic-local-commit";
        const staged = runtime.activated
          ? runtime.automaticCommits
          : runtime.stagedAutomaticCommits;
        const known =
          runtime.automaticCommits.has(message.schedule.id) ||
          runtime.stagedAutomaticCommits.has(message.schedule.id);
        if (
          (runtime.phase !== "activating" && runtime.phase !== "active") ||
          !runtime.permissions.has("automatic-local-commit") ||
          !message.schedule.id.startsWith(`${pluginId}.`) ||
          (registering && known) ||
          (!registering && !known)
        ) {
          void this.failRuntime(
            pluginId,
            new Error(
              `Plugin ${pluginId} attempted an unauthorized automatic local commit registration.`,
            ),
          );
          return;
        }
        // The whole schedule is replaced in one step, so a timer is never
        // rebuilt from a half-updated contribution.
        staged.set(message.schedule.id, {
          pluginId,
          ...message.schedule,
        });
        if (runtime.activated) {
          this.publishAutomaticLocalCommits();
        }
        return;
      }
      case "unregister-automatic-local-commit":
        runtime.automaticCommits.delete(message.id);
        runtime.stagedAutomaticCommits.delete(message.id);
        this.publishAutomaticLocalCommits();
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
      case "source-control-action-result": {
        if (!this.settle(runtime, message.requestId, message.type, message.error)) {
          this.protocolViolation(
            pluginId,
            `unexpected ${message.type} for pending request`,
          );
          return;
        }
        runtime.activeActions.delete(message.requestId);
        return;
      }
      case "deactivated":
        if (!this.settle(runtime, message.requestId, message.type, message.error)) {
          this.protocolViolation(
            pluginId,
            `unexpected ${message.type} for pending request`,
          );
        }
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
      const hostScope = takeHostOperationScope(
        actionScope,
        message.operation,
        message.value,
      );
      const value = await runHostOperation(
        pluginId,
        message.operation,
        message.key,
        message.value,
        hostScope,
        message.operationId,
        this.onVaultCloned,
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
    expectedType: PendingRequest["expectedType"],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        runtime.pending.delete(requestId);
        reject(new Error("Plugin operation timed out."));
      }, timeoutMs);
      runtime.pending.set(requestId, {
        resolve,
        reject,
        timeout,
        expectedType,
      });
    });
  }

  private settle(
    runtime: Runtime,
    requestId: string,
    responseType: PendingRequest["expectedType"],
    error?: string,
  ): boolean {
    const pending = runtime.pending.get(requestId);
    if (!pending) {
      return true;
    }
    if (pending.expectedType !== responseType) {
      return false;
    }
    window.clearTimeout(pending.timeout);
    runtime.pending.delete(requestId);
    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(undefined);
    }
    return true;
  }

  private sourceControlProviderIdRegistered(id: string): boolean {
    for (const runtime of this.runtimes.values()) {
      if (
        runtime.sourceControlProviders.has(id) ||
        runtime.stagedSourceControlProviders.has(id)
      ) {
        return true;
      }
    }
    return false;
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
    this.publishSourceControlProviders();
    this.publishAutomaticLocalCommits();
    this.publishEmojiPickers();
  }

  private protocolViolation(pluginId: string, detail: string): void {
    const error = new Error(
      `Plugin ${pluginId} violated the runtime protocol: ${detail}.`,
    );
    void this.failRuntime(pluginId, error);
  }

  private async failRuntime(pluginId: string, error: Error): Promise<void> {
    this.nextGeneration(pluginId);
    await this.teardownRuntime(pluginId);
    this.onError(pluginId, error);
  }

  private async teardownRuntime(pluginId: string): Promise<void> {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      return;
    }
    runtime.phase = "stopping";
    this.publishEmojiPickers();
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

  private publishEmojiPickers(): void {
    this.onEmojiPickersChanged(
      [...this.runtimes.values()].flatMap((runtime) =>
        runtime.phase === "active" ? [...runtime.emojiPickers.values()] : [],
      ),
    );
  }

  private publishSourceControlProviders(): void {
    this.onSourceControlProvidersChanged(
      [...this.runtimes.values()].flatMap((runtime) => [
        ...runtime.sourceControlProviders.values(),
      ]),
    );
  }

  /**
   * Publishes every schedule the host may hold a timer for. A stopped, failed,
   * or disabled runtime is already gone from the map, so its schedules
   * disappear in the same publication and the host clears their timers.
   */
  private publishAutomaticLocalCommits(): void {
    this.onAutomaticLocalCommitsChanged(
      [...this.runtimes.values()].flatMap((runtime) => [
        ...runtime.automaticCommits.values(),
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

function isCommitGitRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "request" in value &&
    typeof value.request === "object" &&
    value.request !== null &&
    "operation" in value.request &&
    value.request.operation === "commit"
  );
}

export function takeHostOperationScope(
  actionScope: PluginActionLeaseScope | undefined,
  operation: string,
  value: unknown,
): PluginActionLeaseScope | undefined {
  const hostScope = actionScope ? { ...actionScope } : undefined;
  if (operation === "git.run" && isCommitGitRequest(value) && actionScope) {
    // The sign choice and passphrase belong to one commit request. The copy
    // returned here receives them; the reusable live lease does not.
    delete actionScope.gitSigningPassphrase;
    delete actionScope.gitCommitSign;
  }
  return hostScope;
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

function cloneProjectRepositories(
  repositories: PluginProjectRepositoryContext[],
): PluginProjectRepositoryContext[] {
  return repositories.map((repository) => ({ ...repository }));
}

function sameProjectRepositories(
  left: PluginProjectRepositoryContext[],
  right: PluginProjectRepositoryContext[],
): boolean {
  return (
    left.length === right.length &&
    left.every((repository, index) => {
      const candidate = right[index];
      return (
        candidate?.repositoryId === repository.repositoryId &&
        candidate.projectId === repository.projectId &&
        candidate.label === repository.label
      );
    })
  );
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

function validateProjectRepositories(
  repositories: PluginProjectRepositoryContext[],
): void {
  const ids = new Set<string>();
  for (const repository of repositories) {
    if (
      !repository.repositoryId ||
      !repository.label ||
      (repository.projectId !== null && !repository.projectId) ||
      ids.has(repository.repositoryId)
    ) {
      throw new Error(
        "Plugin repository contexts must use unique host-issued identities.",
      );
    }
    ids.add(repository.repositoryId);
  }
}
