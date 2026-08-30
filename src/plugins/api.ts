import {
  PLUGIN_API_VERSION,
  assertValidPluginCatalogEntry,
  assertValidPluginManifest,
  checkPluginCompatibility,
  type DenotePlugin,
  type PluginActivationContext,
  type PluginCatalogEntry,
  type PluginInstallState,
  type PluginLifecycleState,
  type PluginManifest,
} from "@denote/plugin-sdk";

export * from "@denote/plugin-sdk";

export interface PluginInstallation {
  pluginId: string;
  version: string;
  packageRoot: string;
  entrypoint: string;
}

export interface PluginInstaller {
  install: (
    entry: PluginCatalogEntry,
    onStateChange: (state: PluginInstallState) => void,
  ) => Promise<PluginInstallation>;
  remove: (pluginId: string) => Promise<void>;
}

export interface PluginRuntimeLoader {
  load: (installation: PluginInstallation) => Promise<DenotePlugin>;
  unload: (pluginId: string) => Promise<void>;
}

export interface PluginContextFactory {
  create: (
    manifest: PluginManifest,
  ) => Omit<PluginActivationContext, "subscriptions">;
}

export interface PluginHost {
  denoteVersion: string;
  apiVersion?: number;
  installer: PluginInstaller;
  runtime: PluginRuntimeLoader;
  contextFactory: PluginContextFactory;
  reportError: (pluginId: string, error: unknown) => void;
}

export interface PluginState {
  catalog: PluginCatalogEntry;
  status: PluginLifecycleState;
  enabled: boolean;
  error: string | null;
}

interface ActivePlugin {
  plugin: DenotePlugin;
  cleanups: Array<() => void | Promise<void>>;
}

interface PendingTeardown {
  cleanups: Array<() => void | Promise<void>>;
  unload: boolean;
  remove: boolean;
}

export class PluginRegistry {
  private readonly catalog = new Map<string, PluginCatalogEntry>();
  private readonly states = new Map<string, PluginState>();
  private readonly active = new Map<string, ActivePlugin>();
  private readonly teardownPending = new Map<string, PendingTeardown>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly apiVersion: number;
  private shuttingDown = false;

  constructor(private readonly host: PluginHost) {
    this.apiVersion = host.apiVersion ?? PLUGIN_API_VERSION;
  }

  register(entry: PluginCatalogEntry): void {
    assertValidPluginCatalogEntry(entry);
    const pluginId = entry.manifest.id;
    if (this.catalog.has(pluginId)) {
      throw new Error(`Plugin ${pluginId} is already registered.`);
    }

    const compatibility = checkPluginCompatibility(
      entry.manifest,
      this.host.denoteVersion,
      this.apiVersion,
    );
    const catalogEntry = deepFreeze(cloneCatalogEntry(entry));
    this.catalog.set(pluginId, catalogEntry);
    this.states.set(pluginId, {
      catalog: catalogEntry,
      status: compatibility.compatible ? "not-installed" : "incompatible",
      enabled: false,
      error: compatibility.reason,
    });
  }

  list(): PluginState[] {
    return [...this.states.values()].map(clonePluginState);
  }

  get(pluginId: string): PluginState {
    const state = this.states.get(pluginId);
    if (!state) {
      throw new Error(`Plugin ${pluginId} is not registered.`);
    }
    return clonePluginState(state);
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const state = this.requireState(pluginId);
    if (this.operations.has(pluginId)) {
      throw new Error(`Plugin ${pluginId} already has an operation in progress.`);
    }
    if (this.shuttingDown) {
      throw new Error("Plugin lifecycle changes are unavailable during shutdown.");
    }
    if (enabled && this.teardownPending.has(pluginId)) {
      throw new Error(
        `Plugin ${pluginId} still has runtime or package cleanup pending.`,
      );
    }
    if (
      !enabled &&
      !this.active.has(pluginId) &&
      !this.teardownPending.has(pluginId)
    ) {
      if (state.status === "failed") {
        const compatibility = this.compatibilityFor(state.catalog.manifest);
        this.updateState(
          pluginId,
          compatibility.compatible ? "disabled" : "incompatible",
          false,
          compatibility.reason,
        );
      }
      return;
    }
    if (enabled) {
      const compatibility = this.compatibilityFor(state.catalog.manifest);
      if (!compatibility.compatible) {
        this.updateState(
          pluginId,
          "incompatible",
          false,
          compatibility.reason,
        );
        throw new Error(
          compatibility.reason ??
            `Plugin ${pluginId} is incompatible with this Denote version.`,
        );
      }
    }
    if (enabled && state.enabled) {
      return;
    }

    const operation = enabled ? this.enable(pluginId) : this.disable(pluginId);
    this.operations.set(pluginId, operation);
    try {
      await operation;
    } finally {
      if (this.operations.get(pluginId) === operation) {
        this.operations.delete(pluginId);
      }
    }
  }

  async deactivateAll(): Promise<void> {
    this.shuttingDown = true;
    const failures: unknown[] = [];
    for (const operation of [...this.operations.values()]) {
      try {
        await operation;
      } catch (error) {
        failures.push(error);
      }
    }
    const pluginIds = new Set([
      ...this.active.keys(),
      ...this.teardownPending.keys(),
    ]);
    for (const pluginId of pluginIds) {
      try {
        await this.disable(pluginId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new PluginOperationError(
        "One or more plugins failed to disable.",
        failures,
      );
    }
  }

  private async enable(pluginId: string): Promise<void> {
    const entry = this.requireCatalogEntry(pluginId);
    const cleanups: Array<() => void | Promise<void>> = [];
    let loadAttempted = false;

    try {
      this.updateState(pluginId, "downloading", false, null);
      const installation = await this.host.installer.install(entry, (status) => {
        this.updateState(pluginId, status, false, null);
      });
      this.assertInstallationMatches(entry, installation);
      this.updateState(pluginId, "installing", false, null);

      loadAttempted = true;
      const plugin = await this.host.runtime.load(installation);
      assertValidPluginManifest(plugin.manifest);
      this.assertLoadedManifestMatches(entry.manifest, plugin.manifest);

      const context = this.host.contextFactory.create(entry.manifest);
      if (context.pluginId !== entry.manifest.id) {
        throw new Error(
          `Plugin context ${context.pluginId} does not match ${entry.manifest.id}.`,
        );
      }
      assertContextCapabilities(entry.manifest, context.capabilities);
      await plugin.activate({
        ...context,
        subscriptions: {
          add: (disposable) => cleanups.push(() => disposable.dispose()),
        },
      });

      this.active.set(pluginId, { plugin, cleanups });
      this.updateState(pluginId, "enabled", true, null);
    } catch (error) {
      const rollbackErrors = await this.rollbackEnable(
        pluginId,
        cleanups,
        loadAttempted,
      );
      const failure =
        rollbackErrors.length === 0
          ? error
          : new PluginOperationError(
              `Plugin ${pluginId} failed to enable and rollback cleanly.`,
              [error, ...rollbackErrors],
            );
      this.host.reportError(pluginId, failure);
      this.updateState(pluginId, "failed", false, errorMessage(failure));
      throw failure;
    }
  }

  private async disable(pluginId: string): Promise<void> {
    this.requireCatalogEntry(pluginId);
    this.updateState(pluginId, "disabling", false, null);
    const current = this.active.get(pluginId);
    const pending = this.teardownPending.get(pluginId);
    const failures: unknown[] = [];
    const cleanupQueue = [...(pending?.cleanups ?? [])];

    if (current?.plugin.deactivate) {
      cleanupQueue.push(() => current.plugin.deactivate?.());
    }
    if (current) {
      cleanupQueue.push(...[...current.cleanups].reverse());
    }
    this.active.delete(pluginId);
    const cleanupResult = await runCleanupQueue(cleanupQueue);
    failures.push(...cleanupResult.failures);

    let unloadPending = pending?.unload ?? true;
    let removePending = pending?.remove ?? true;
    if (unloadPending) {
      try {
        await this.host.runtime.unload(pluginId);
        unloadPending = false;
      } catch (error) {
        failures.push(error);
      }
    }
    if (!unloadPending && removePending) {
      try {
        await this.host.installer.remove(pluginId);
        removePending = false;
      } catch (error) {
        failures.push(error);
      }
    }
    if (
      cleanupResult.pending.length > 0 ||
      unloadPending ||
      removePending
    ) {
      this.teardownPending.set(pluginId, {
        cleanups: cleanupResult.pending,
        unload: unloadPending,
        remove: removePending,
      });
    } else {
      this.teardownPending.delete(pluginId);
    }

    if (failures.length > 0) {
      const failure = new PluginOperationError(
        `Plugin ${pluginId} did not disable cleanly.`,
        failures,
      );
      this.host.reportError(pluginId, failure);
      this.updateState(pluginId, "failed", false, errorMessage(failure));
      throw failure;
    }
    const compatibility = this.compatibilityFor(
      this.requireCatalogEntry(pluginId).manifest,
    );
    this.updateState(
      pluginId,
      compatibility.compatible ? "disabled" : "incompatible",
      false,
      compatibility.reason,
    );
  }

  private async rollbackEnable(
    pluginId: string,
    cleanups: Array<() => void | Promise<void>>,
    loadAttempted: boolean,
  ): Promise<unknown[]> {
    const cleanupResult = await runCleanupQueue([...cleanups].reverse());
    const failures = [...cleanupResult.failures];
    let unloadPending = false;
    let removePending = true;
    if (loadAttempted) {
      try {
        await this.host.runtime.unload(pluginId);
      } catch (error) {
        failures.push(error);
        unloadPending = true;
      }
    }
    if (!unloadPending) {
      try {
        await this.host.installer.remove(pluginId);
        removePending = false;
      } catch (error) {
        failures.push(error);
      }
    }
    if (
      cleanupResult.pending.length > 0 ||
      unloadPending ||
      removePending
    ) {
      this.teardownPending.set(pluginId, {
        cleanups: cleanupResult.pending,
        unload: unloadPending,
        remove: removePending,
      });
    } else {
      this.teardownPending.delete(pluginId);
    }
    this.active.delete(pluginId);
    return failures;
  }

  private assertInstallationMatches(
    entry: PluginCatalogEntry,
    installation: PluginInstallation,
  ): void {
    if (
      installation.pluginId !== entry.manifest.id ||
      installation.version !== entry.manifest.version
    ) {
      throw new Error(
        `Installed package does not match catalog entry ${entry.manifest.id}@${entry.manifest.version}.`,
      );
    }
  }

  private assertLoadedManifestMatches(
    expected: PluginManifest,
    actual: PluginManifest,
  ): void {
    if (stableStringify(actual) !== stableStringify(expected)) {
      throw new Error(
        `Loaded plugin manifest does not match catalog entry ${expected.id}@${expected.version}.`,
      );
    }
  }

  private compatibilityFor(manifest: PluginManifest) {
    return checkPluginCompatibility(
      manifest,
      this.host.denoteVersion,
      this.apiVersion,
    );
  }

  private requireCatalogEntry(pluginId: string): PluginCatalogEntry {
    const entry = this.catalog.get(pluginId);
    if (!entry) {
      throw new Error(`Plugin ${pluginId} is not registered.`);
    }
    return entry;
  }

  private requireState(pluginId: string): PluginState {
    const state = this.states.get(pluginId);
    if (!state) {
      throw new Error(`Plugin ${pluginId} is not registered.`);
    }
    return state;
  }

  private updateState(
    pluginId: string,
    status: PluginLifecycleState,
    enabled: boolean,
    error: string | null,
  ): void {
    const current = this.requireState(pluginId);
    this.states.set(pluginId, {
      ...current,
      status,
      enabled,
      error,
    });
  }
}

async function runCleanupQueue(
  cleanups: Array<() => void | Promise<void>>,
): Promise<{
  failures: unknown[];
  pending: Array<() => void | Promise<void>>;
}> {
  const failures: unknown[] = [];
  const pending: Array<() => void | Promise<void>> = [];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
      pending.push(cleanup);
    }
  }
  return { failures, pending };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

class PluginOperationError extends Error {
  constructor(
    message: string,
    readonly failures: readonly unknown[],
  ) {
    super(message);
    this.name = "PluginOperationError";
  }
}

function assertContextCapabilities(
  manifest: PluginManifest,
  capabilities: PluginActivationContext["capabilities"],
): void {
  const permissions = new Set(
    manifest.permissions.map((permission) => permission.capability),
  );
  const mappedCapabilities = [
    ["commands", capabilities.commands],
    ["sidebar", capabilities.sidebar],
    ["editor-decoration", capabilities.editorDecoration],
    ["note-events", capabilities.noteEvents],
    ["workspace-read", capabilities.workspaceRead],
    ["network", capabilities.network],
    ["clipboard-read", capabilities.clipboardRead],
    ["notifications", capabilities.notifications],
    ["secure-storage", capabilities.secureStorage],
  ] as const;
  const allowedContextKeys = new Set([
    "commands",
    "sidebar",
    "editorDecoration",
    "noteEvents",
    "workspaceRead",
    "network",
    "clipboardRead",
    "notifications",
    "secureStorage",
  ]);
  for (const capability of Object.keys(capabilities)) {
    if (!allowedContextKeys.has(capability)) {
      throw new Error(
        `Plugin ${manifest.id} received capability ${capability} outside a user action.`,
      );
    }
  }

  for (const [permission, capability] of mappedCapabilities) {
    if (permissions.has(permission) && capability === undefined) {
      throw new Error(
        `Plugin ${manifest.id} was not provided its declared ${permission} capability.`,
      );
    }
    if (!permissions.has(permission) && capability !== undefined) {
      throw new Error(
        `Plugin ${manifest.id} received undeclared ${permission} capability.`,
      );
    }
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

function clonePluginState(state: PluginState): PluginState {
  return {
    ...state,
    catalog: cloneCatalogEntry(state.catalog),
  };
}

function cloneCatalogEntry(entry: PluginCatalogEntry): PluginCatalogEntry {
  return JSON.parse(JSON.stringify(entry)) as PluginCatalogEntry;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
