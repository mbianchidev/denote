import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { PluginBundleMetadata, PluginView } from "../types";
import type {
  PluginDiagramRenderRequest,
  PluginDiagramRenderResult,
  PluginNoteEvent,
  PluginEmojiPreferences,
  PluginPermissionRequest,
  PluginProjectContext,
  PluginProjectRepositoryContext,
  PluginSourceControlAction,
  PluginStructuredViewerParseRequest,
  PluginStructuredViewModel,
} from "@denote/plugin-sdk";
import {
  PluginWorkerRuntime,
  type PluginActionLeaseScope,
  type PluginActionHostSecrets,
  type PluginVaultClonedHandler,
  type PluginAutomaticLocalCommitContribution,
  type PluginCommandContribution,
  type PluginSidebarContribution,
  type PluginStatusContribution,
  type PluginDecorationContribution,
  type PluginDiagramRendererContribution,
  type PluginEmojiPickerContribution,
  type PluginSourceControlContribution,
  type PluginStructuredViewerContribution,
} from "./workerRuntime";
import { emojiPreferenceSettings } from "./emojiPickers";
import {
  getPluginAutoUpdateEnabled,
  savePluginAutoUpdateEnabled,
} from "../lib/pluginAutoUpdate";

const EMPTY_PROJECT_REPOSITORIES: PluginProjectRepositoryContext[] = [];

/**
 * Compares two permission requests for exact equality, independent of key
 * order. Used to decide whether an update can be applied automatically: an
 * update that expands or otherwise changes what a plugin can access must
 * always go through explicit, reviewed approval instead.
 *
 * This switches exhaustively over every current `PluginPermissionRequest`
 * variant. A future scoped variant added to the SDK must be handled here
 * explicitly (the `never` check below fails the build otherwise) so this
 * comparison can never silently treat a differently scoped grant as
 * unchanged.
 */
function permissionRequestEqual(
  a: PluginPermissionRequest,
  b: PluginPermissionRequest,
): boolean {
  if (a.capability !== b.capability) {
    return false;
  }
  const sortedJson = (values: string[] | undefined) =>
    JSON.stringify([...(values ?? [])].sort());
  switch (a.capability) {
    case "network": {
      const other = b as Extract<PluginPermissionRequest, { capability: "network" }>;
      return sortedJson(a.hosts) === sortedJson(other.hosts);
    }
    case "process": {
      const other = b as Extract<PluginPermissionRequest, { capability: "process" }>;
      return (
        sortedJson(a.executables.macos) === sortedJson(other.executables.macos) &&
        sortedJson(a.executables.linux) === sortedJson(other.executables.linux) &&
        sortedJson(a.executables.windows) === sortedJson(other.executables.windows)
      );
    }
    case "commands":
    case "sidebar":
    case "status":
    case "editor-decoration":
    case "emoji-picker":
    case "structured-viewer":
    case "diagram-renderer":
    case "note-events":
    case "project-context":
    case "source-control":
    case "automatic-local-commit":
    case "git":
    case "workspace-read":
    case "workspace-write":
    case "clipboard-read":
    case "clipboard-write":
    case "notifications":
    case "secure-storage":
      // These capabilities carry no additional scope, so a matching
      // capability name is a complete equality check.
      return true;
    default: {
      const exhaustive: never = a;
      throw new Error(
        `Unhandled plugin capability in permission comparison: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

function permissionsUnchanged(
  approved: PluginPermissionRequest[],
  requested: PluginPermissionRequest[],
): boolean {
  if (approved.length !== requested.length) {
    return false;
  }
  // Consume each approved entry at most once so a single approved permission
  // cannot be reused to match two different requested permissions.
  const remaining = [...approved];
  for (const requestedPermission of requested) {
    const matchIndex = remaining.findIndex((approvedPermission) =>
      permissionRequestEqual(approvedPermission, requestedPermission),
    );
    if (matchIndex === -1) {
      return false;
    }
    remaining.splice(matchIndex, 1);
  }
  return true;
}

export interface PluginController {
  plugins: PluginView[];
  bundles: PluginBundleMetadata[];
  commands: PluginCommandContribution[];
  sidebarViews: PluginSidebarContribution[];
  statusItems: PluginStatusContribution[];
  decorations: PluginDecorationContribution[];
  emojiPickers: PluginEmojiPickerContribution[];
  structuredViewers: PluginStructuredViewerContribution[];
  diagramRenderers: PluginDiagramRendererContribution[];
  saveEmojiPreferences: (
    pluginId: string,
    pickerId: string,
    preferences: PluginEmojiPreferences,
  ) => Promise<void>;
  sourceControlProviders: PluginSourceControlContribution[];
  automaticLocalCommits: PluginAutomaticLocalCommitContribution[];
  developmentSupported: boolean;
  loading: boolean;
  busyPluginIds: ReadonlySet<string>;
  refresh: () => Promise<void>;
  enable: (
    pluginId: string,
    approvedPermissions: PluginPermissionRequest[],
  ) => Promise<void>;
  disable: (pluginId: string) => Promise<void>;
  disableAll: () => Promise<void>;
  updateAll: () => Promise<void>;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (enabled: boolean) => void;
  loadDevelopmentPlugin: () => Promise<void>;
  clearData: (pluginId: string) => Promise<void>;
  clearCredentials: (pluginId: string) => Promise<void>;
  updateSettings: (
    pluginId: string,
    settings: Record<string, unknown>,
  ) => Promise<void>;
  importSettings: (
    pluginId: string,
    sourceVersion: number,
    settings: Record<string, unknown>,
  ) => Promise<void>;
  runCommand: (
    pluginId: string,
    commandId: string,
    workspaceScope: string,
  ) => Promise<void>;
  runSourceControlAction: (
    pluginId: string,
    providerId: string,
    action: PluginSourceControlAction,
    workspaceScope: string,
    hostSecrets?: PluginActionHostSecrets,
  ) => Promise<void>;
  parseStructuredView: (
    pluginId: string,
    viewerId: string,
    request: PluginStructuredViewerParseRequest,
  ) => Promise<PluginStructuredViewModel>;
  renderDiagram: (
    renderer: PluginDiagramRendererContribution,
    request: PluginDiagramRenderRequest,
    scopeId: string,
    signal: AbortSignal,
  ) => Promise<PluginDiagramRenderResult>;
  releaseDiagramScope: (scopeId: string) => void;
  emitNoteEvent: (event: PluginNoteEvent) => void;
  invalidateActionLeases: () => void;
  shutdown: () => Promise<void>;
}

export function usePlugins(
  reportError: (error: unknown) => void,
  projectContext: PluginProjectContext | null = null,
  /**
   * Identifies the workspace the host is showing. It stays inside the host:
   * the runtime only compares it, and a plugin is told that the workspace
   * changed without ever being told which one it is.
   */
  workspaceIdentity: string | null = null,
  /**
   * Opens the workspace a host clone produced. It is a host-only callback: the
   * snapshot never crosses the plugin boundary, so a plugin cannot learn where
   * the new vault is.
   */
  onVaultCloned: PluginVaultClonedHandler = () => {},
  projectRepositories: PluginProjectRepositoryContext[] = EMPTY_PROJECT_REPOSITORIES,
  contentAvailable = true,
): PluginController {
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [bundles, setBundles] = useState<PluginBundleMetadata[]>([]);
  const [commands, setCommands] = useState<PluginCommandContribution[]>([]);
  const [sidebarViews, setSidebarViews] = useState<
    PluginSidebarContribution[]
  >([]);
  const [statusItems, setStatusItems] = useState<PluginStatusContribution[]>([]);
  const [decorations, setDecorations] = useState<
    PluginDecorationContribution[]
  >([]);
  const [emojiPickers, setEmojiPickers] = useState<PluginEmojiPickerContribution[]>([]);
  const [structuredViewers, setStructuredViewers] = useState<
    PluginStructuredViewerContribution[]
  >([]);
  const [diagramRenderers, setDiagramRenderers] = useState<
    PluginDiagramRendererContribution[]
  >([]);
  const [sourceControlProviders, setSourceControlProviders] = useState<
    PluginSourceControlContribution[]
  >([]);
  const [automaticLocalCommits, setAutomaticLocalCommits] = useState<
    PluginAutomaticLocalCommitContribution[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(new Set());
  const [autoUpdateEnabled, setAutoUpdateEnabledState] = useState(
    getPluginAutoUpdateEnabled,
  );
  const autoUpdateAttemptedRef = useRef(new Set<string>());
  const setAutoUpdateEnabled = useCallback((enabled: boolean) => {
    savePluginAutoUpdateEnabled(enabled);
    setAutoUpdateEnabledState(enabled);
  }, []);
  const runtimeRef = useRef<PluginWorkerRuntime | null>(null);
  // Held in a ref so a changing handler never restarts every plugin runtime.
  const vaultClonedRef = useRef(onVaultCloned);
  vaultClonedRef.current = onVaultCloned;
  const pendingTransactionsRef = useRef(new Map<string, string>());
  const startsAllowedRef = useRef(true);
  // Set while an explicit `disableAll` recovery action is in flight so the
  // automatic-update effect never races it: `disableAll` is not funneled
  // through the per-plugin `withBusy` queue, and an automatic update could
  // otherwise re-enable a plugin the user just asked to stop.
  const bulkDisableInFlightRef = useRef(false);
  const emojiWritesRef = useRef(new Map<string, Promise<void>>());
  const pluginOperationsRef = useRef(new Map<string, Promise<void>>());
  const emojiWriteGenerations = useRef(new Map<string, number>());
  const workspaceIdentityRef = useRef(workspaceIdentity);
  workspaceIdentityRef.current = workspaceIdentity;
  const contentAvailableRef = useRef(contentAvailable);
  contentAvailableRef.current = contentAvailable;

  const refresh = useCallback(async () => {
    setPlugins(await api.listPlugins());
  }, []);

  useEffect(() => {
    let cancelled = false;
    startsAllowedRef.current = true;
    const runtime = new PluginWorkerRuntime(
      setCommands,
      (pluginId, error) => {
        reportError(error);
        const transactionId = pendingTransactionsRef.current.get(pluginId);
        void (async () => {
          if (transactionId) {
            try {
              await api.rollbackPluginEnable(
                transactionId,
                errorMessage(error),
              );
              pendingTransactionsRef.current.delete(pluginId);
              await refresh();
              return;
            } catch (rollbackError) {
              reportError(rollbackError);
            }
          }
          await api.disablePlugin(pluginId);
          await refresh();
        })().catch(reportError);
      },
      setSidebarViews,
      setStatusItems,
      setDecorations,
      setSourceControlProviders,
      setAutomaticLocalCommits,
      (snapshot) => vaultClonedRef.current(snapshot),
      setEmojiPickers,
      setStructuredViewers,
      setDiagramRenderers,
    );
    runtime.setWorkspaceIdentity(workspaceIdentity);
    runtime.setProjectContext(projectContext, projectRepositories);
    runtimeRef.current = runtime;
    void api
      .listPluginBundles()
      .then((available) => {
        if (!cancelled) {
          setBundles(available);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          reportError(error);
        }
      });
    void api
      .recoverPluginTransactions()
      .then(api.listPlugins)
      .then(async (available) => {
        if (cancelled) {
          return;
        }
        setPlugins(available);
        for (const plugin of available.filter((entry) => entry.enabled)) {
          if (cancelled || !startsAllowedRef.current) {
            break;
          }
          if (!contentAvailableRef.current && requiresContent(plugin)) {
            continue;
          }
          try {
            await runtime.start(plugin);
          } catch (error) {
            if (
              cancelled ||
              !startsAllowedRef.current ||
              errorMessage(error).includes("start was cancelled")
            ) {
              break;
            }
            await api.disablePlugin(plugin.catalog.manifest.id);
            reportError(error);
          }
        }
        if (!cancelled) {
          setPlugins(await api.listPlugins());
        }
      })
      .catch(reportError)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      startsAllowedRef.current = false;
      runtimeRef.current = null;
      void runtime
        .stopAll()
        .then(api.recoverPluginTransactions)
        .catch(reportError);
    };
  }, [refresh, reportError]);

  useEffect(() => {
    // The workspace is applied first: a plugin has to learn that it changed
    // before it is told which project inside it is now current.
    runtimeRef.current?.setWorkspaceIdentity(workspaceIdentity);
    runtimeRef.current?.setProjectContext(projectContext, projectRepositories);
  }, [projectContext, projectRepositories, workspaceIdentity]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const plugin of plugins) {
        if (
          cancelled ||
          !plugin.enabled ||
          !requiresContent(plugin)
        ) {
          continue;
        }
        const pluginId = plugin.catalog.manifest.id;
        try {
          if (contentAvailable) {
            if (!runtime.isRunning(pluginId) && startsAllowedRef.current) {
              await runtime.start(plugin);
            }
          } else if (runtime.isRunning(pluginId)) {
            await runtime.stop(pluginId);
          }
        } catch (error) {
          if (!cancelled) {
            reportError(error);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contentAvailable, plugins, reportError]);

  const withBusy = useCallback(
    async (pluginId: string, operation: () => Promise<void>) => {
      emojiWriteGenerations.current.set(
        pluginId,
        (emojiWriteGenerations.current.get(pluginId) ?? 0) + 1,
      );
      setBusyPluginIds((current) => new Set(current).add(pluginId));
      const perform = async () => {
        await Promise.allSettled([emojiWritesRef.current.get(pluginId)]);
        await operation();
      };
      const previous = pluginOperationsRef.current.get(pluginId) ?? Promise.resolve();
      const currentOperation = previous.then(perform, perform);
      pluginOperationsRef.current.set(pluginId, currentOperation);
      try {
        await currentOperation;
      } finally {
        if (pluginOperationsRef.current.get(pluginId) === currentOperation) {
          pluginOperationsRef.current.delete(pluginId);
          setBusyPluginIds((current) => {
            const next = new Set(current);
            next.delete(pluginId);
            return next;
          });
        }
      }
    },
    [],
  );

  const enable = useCallback(
    async (
      pluginId: string,
      approvedPermissions: PluginPermissionRequest[],
    ) => {
      await withBusy(pluginId, async () => {
        startsAllowedRef.current = true;
        const staleTransaction = pendingTransactionsRef.current.get(pluginId);
        if (staleTransaction) {
          await api.rollbackPluginEnable(
            staleTransaction,
            "Retrying a previously interrupted plugin enablement.",
          );
          pendingTransactionsRef.current.delete(pluginId);
        }
        const current = plugins.find(
          (plugin) => plugin.catalog.manifest.id === pluginId,
        );
        if (!current) {
          throw new Error(`Plugin ${pluginId} is not in the catalog.`);
        }
        const updating =
          current.enabled && current.status === "update-available";
        if (current.enabled && !updating) {
          throw new Error(`Plugin ${pluginId} is already enabled.`);
        }
        let previousRuntimeStopped = false;
        let runtimeStarted = false;
        let transactionId: string | null = null;
        let committed = false;
        try {
          if (updating) {
            const runtime = runtimeRef.current;
            if (!runtime) {
              throw new Error("Plugin runtime is unavailable.");
            }
            await runtime.stop(pluginId);
            previousRuntimeStopped = true;
          }
          const installation = await api.preparePluginEnable(
            pluginId,
            approvedPermissions,
          );
          transactionId = installation.transactionId;
          pendingTransactionsRef.current.set(pluginId, transactionId);
          const prepared =
            (await api.listPlugins()).find(
              (plugin) => plugin.catalog.manifest.id === pluginId,
            ) ?? current;
          const runtime = runtimeRef.current;
          if (!runtime) {
            throw new Error("Plugin runtime is unavailable.");
          }
          await runtime.start({
            ...prepared,
            approvedPermissions,
          });
          runtimeStarted = true;
          if (!runtime.isRunning(pluginId)) {
            throw new Error(`Plugin ${pluginId} stopped before enablement completed.`);
          }
          await api.commitPluginEnable(transactionId);
          committed = true;
          pendingTransactionsRef.current.delete(pluginId);
        } catch (error) {
          let rollbackError: unknown = null;
          if (runtimeStarted) {
            await runtimeRef.current?.stop(pluginId).catch(reportError);
          }
          if (
            transactionId &&
            pendingTransactionsRef.current.get(pluginId) === transactionId
          ) {
            try {
              await api.rollbackPluginEnable(
                transactionId,
                errorMessage(error),
              );
              pendingTransactionsRef.current.delete(pluginId);
            } catch (caughtRollbackError) {
              reportError(caughtRollbackError);
              rollbackError = caughtRollbackError;
            }
          }
          if (previousRuntimeStopped && rollbackError === null) {
            try {
              const available = await api.listPlugins();
              setPlugins(available);
              const previous = available.find(
                (plugin) =>
                  plugin.catalog.manifest.id === pluginId && plugin.enabled,
              );
              if (previous) {
                await runtimeRef.current?.start(previous);
              }
            } catch (restartError) {
              reportError(restartError);
              throw new Error(
                `${errorMessage(error)} The previous plugin version could not be restarted: ${errorMessage(restartError)}`,
              );
            }
          } else {
            await refresh().catch(reportError);
          }
          if (rollbackError) {
            throw new Error(
              `${errorMessage(error)} The plugin update could not be rolled back: ${errorMessage(rollbackError)}`,
            );
          }
          throw error;
        }
        if (committed) {
          await refresh().catch(reportError);
        }
      });
    },
    [plugins, refresh, reportError, withBusy],
  );

  const disable = useCallback(
    async (pluginId: string) => {
      await withBusy(pluginId, async () => {
        const staleTransaction = pendingTransactionsRef.current.get(pluginId);
        if (staleTransaction) {
          await api.rollbackPluginEnable(
            staleTransaction,
            "Plugin enablement was cancelled.",
          );

          pendingTransactionsRef.current.delete(pluginId);
        }
        let runtimeError: unknown = null;
        try {
          await runtimeRef.current?.stop(pluginId);
        } catch (error) {
          runtimeError = error;
        }
        await api.disablePlugin(pluginId);
        await refresh();
        if (runtimeError) {
          throw runtimeError;
        }
      });
    },
    [refresh, withBusy],
  );

  const updateAll = useCallback(async () => {
    const targets = plugins.filter(
      (plugin) =>
        plugin.status === "update-available" &&
        plugin.previouslyApproved === true,
    );
    const failures: string[] = [];
    for (const plugin of targets) {
      try {
        await enable(
          plugin.catalog.manifest.id,
          plugin.catalog.manifest.permissions,
        );
      } catch (error) {
        failures.push(
          `${plugin.catalog.manifest.name}: ${errorMessage(error)}`,
        );
      }
    }
    if (failures.length > 0) {
      throw new Error(`Some plugin updates failed. ${failures.join(" ")}`);
    }
  }, [enable, plugins]);

  useEffect(() => {
    // Wait until startup restoration (recovery, restart of already-enabled
    // plugins, then a final refresh) has settled: acting on an intermediate
    // snapshot could race the native transaction it starts from.
    if (!autoUpdateEnabled || loading) {
      return;
    }
    const eligible = plugins.filter((plugin) => {
      if (
        !plugin.enabled ||
        plugin.status !== "update-available" ||
        plugin.previouslyApproved !== true ||
        busyPluginIds.has(plugin.catalog.manifest.id)
      ) {
        return false;
      }
      const attemptKey = `${plugin.catalog.manifest.id}@${plugin.catalog.manifest.version}`;
      return (
        !autoUpdateAttemptedRef.current.has(attemptKey) &&
        permissionsUnchanged(
          plugin.approvedPermissions,
          plugin.catalog.manifest.permissions,
        )
      );
    });
    if (eligible.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const plugin of eligible) {
        if (cancelled || bulkDisableInFlightRef.current) {
          return;
        }
        const attemptKey = `${plugin.catalog.manifest.id}@${plugin.catalog.manifest.version}`;
        autoUpdateAttemptedRef.current.add(attemptKey);
        try {
          await enable(
            plugin.catalog.manifest.id,
            plugin.catalog.manifest.permissions,
          );
        } catch (error) {
          reportError(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoUpdateEnabled, loading, plugins, busyPluginIds, enable, reportError]);

  const loadDevelopmentPlugin = useCallback(async () => {
    const pluginId = await api.chooseDevelopmentPluginArchive();
    if (pluginId) {
      await refresh();
    }
  }, [refresh]);

  const clearData = useCallback(
    async (pluginId: string) => {
      await withBusy(pluginId, async () => {
        await api.disablePlugin(pluginId, true, false);
        await refresh();
      });
    },
    [refresh, withBusy],
  );

  const disableAll = useCallback(async () => {
    bulkDisableInFlightRef.current = true;
    try {
      startsAllowedRef.current = false;
      await Promise.allSettled([...emojiWritesRef.current.values()]);
      const runtime = runtimeRef.current;
      if (runtime) {
        await runtime.stopAll().catch(reportError);
      }
      await api.recoverPluginTransactions();
      pendingTransactionsRef.current.clear();
      for (const plugin of plugins) {
        if (plugin.enabled) {
          await api.disablePlugin(plugin.catalog.manifest.id);
        }
      }
      await refresh();
    } finally {
      bulkDisableInFlightRef.current = false;
    }
  }, [plugins, refresh, reportError]);

  const clearCredentials = useCallback(
    async (pluginId: string) => {
      await withBusy(pluginId, async () => {
        await api.disablePlugin(pluginId, false, true);
        await refresh();
      });
    },
    [refresh, withBusy],
  );

  const reloadSettings = useCallback(async (pluginId: string) => {
    const available = await api.listPlugins();
    setPlugins(available);
    const plugin = available.find((entry) => entry.catalog.manifest.id === pluginId);
    const runtime = runtimeRef.current;
    // Explicit settings saves and imports reactivate without reinstalling code.
    if (!plugin?.enabled || !runtime?.isRunning(pluginId) || !startsAllowedRef.current) {
      return;
    }
    await runtime.stop(pluginId);
    if (!startsAllowedRef.current) {
      return;
    }
    try {
      await runtime.start(plugin);
    } catch (error) {
      await api.disablePlugin(pluginId);
      await refresh().catch(reportError);
      throw error;
    }
    await refresh();
  }, [refresh, reportError]);

  const updateSettings = useCallback(
    async (pluginId: string, settings: Record<string, unknown>) => {
      await withBusy(pluginId, async () => {
        await api.setPluginSettings(pluginId, settings);
        await reloadSettings(pluginId);
      });
    },
    [reloadSettings, withBusy],
  );

  const saveEmojiPreferences = useCallback(
    async (pluginId: string, pickerId: string, preferences: PluginEmojiPreferences) => {
      const runtime = runtimeRef.current;
      if (!runtime || !startsAllowedRef.current || pluginOperationsRef.current.has(pluginId)) {
        throw new Error("The emoji picker is no longer available.");
      }
      const picker = runtime.getEmojiPicker(pluginId, pickerId);
      const patch = emojiPreferenceSettings(picker, preferences);
      const generation = emojiWriteGenerations.current.get(pluginId) ?? 0;
      const workspace = workspaceIdentityRef.current;
      const assertCurrent = () => {
        if (
          pluginOperationsRef.current.has(pluginId) ||
          runtimeRef.current !== runtime ||
          workspaceIdentityRef.current !== workspace ||
          (emojiWriteGenerations.current.get(pluginId) ?? 0) !== generation ||
          runtime.getEmojiPicker(pluginId, pickerId) !== picker
        ) {
          throw new Error("The emoji picker changed before its preferences could be saved.");
        }
      };
      const persist = async () => {
        assertCurrent();
        const current = await api.getPluginSettings(pluginId);
        assertCurrent();
        const settings = await api.setPluginSettings(pluginId, { ...current, ...patch });
        assertCurrent();
        setPlugins((available) =>
          available.map((plugin) =>
            plugin.catalog.manifest.id === pluginId ? { ...plugin, settings } : plugin,
          ),
        );
      };
      const previous = emojiWritesRef.current.get(pluginId) ?? Promise.resolve();
      const write = previous.then(persist, persist);
      emojiWritesRef.current.set(pluginId, write);
      const finished = () => {
        if (emojiWritesRef.current.get(pluginId) === write) {
          emojiWritesRef.current.delete(pluginId);
        }
      };
      void write.then(finished, finished);
      return write;
    },
    [],
  );

  const runCommand = useCallback(
    async (
      pluginId: string,
      commandId: string,
      workspaceScope: string,
    ) => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error("Plugin runtime is unavailable.");
      }
      runtime.setWorkspaceIdentity(workspaceIdentity);
      runtime.setProjectContext(projectContext, projectRepositories);
      const projectIds = projectRepositories.flatMap((repository) =>
        repository.projectId ? [repository.projectId] : [],
      );
      const actionScope: PluginActionLeaseScope = {
        workspaceScope,
        projectId: projectContext?.projectId ?? null,
        ...(projectIds.length > 0 ? { projectIds } : {}),
        sourceControlActionId: null,
      };
      await runtime.runCommand(pluginId, commandId, actionScope);
    },
    [projectContext, projectRepositories, workspaceIdentity],
  );

  const runSourceControlAction = useCallback(
    async (
      pluginId: string,
      providerId: string,
      action: PluginSourceControlAction,
      workspaceScope: string,
      hostSecrets?: PluginActionHostSecrets,
    ) => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error("Plugin runtime is unavailable.");
      }
      runtime.setWorkspaceIdentity(workspaceIdentity);
      runtime.setProjectContext(projectContext, projectRepositories);
      const projectIds = projectRepositories.flatMap((repository) =>
        repository.projectId ? [repository.projectId] : [],
      );
      const actionScope: PluginActionLeaseScope = {
        workspaceScope,
        projectId: projectContext?.projectId ?? null,
        ...(projectIds.length > 0 ? { projectIds } : {}),
        sourceControlActionId: action.id,
        ...((action.id === "commit" ||
          action.id === "commit-and-push" ||
          action.id === "branch-switch-commit") &&
        typeof action.values?.sign === "boolean"
          ? { gitCommitSign: action.values.sign }
          : {}),
        ...((action.id === "commit" ||
          action.id === "commit-and-push" ||
          action.id === "branch-switch-commit") &&
        hostSecrets?.gitSigningPassphrase
          ? {
              gitSigningPassphrase: hostSecrets.gitSigningPassphrase,
            }
          : {}),
      };
      await runtime.runSourceControlAction(
        pluginId,
        providerId,
        action,
        actionScope,
      );
    },
    [projectContext, projectRepositories, workspaceIdentity],
  );

  const importSettings = useCallback(
    async (
      pluginId: string,
      sourceVersion: number,
      settings: Record<string, unknown>,
    ) => {
      await withBusy(pluginId, async () => {
        await api.importPluginSettings(pluginId, sourceVersion, settings);
        await reloadSettings(pluginId);
      });
    },
    [reloadSettings, withBusy],
  );

  const parseStructuredView = useCallback(
    (
      pluginId: string,
      viewerId: string,
      request: PluginStructuredViewerParseRequest,
    ) => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error("Plugin runtime is unavailable.");
      }
      return runtime.parseStructuredView(pluginId, viewerId, request);
    },
    [],
  );

  const renderDiagram = useCallback(
    (
      renderer: PluginDiagramRendererContribution,
      request: PluginDiagramRenderRequest,
      scopeId: string,
      signal: AbortSignal,
    ) => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error("Plugin runtime is unavailable.");
      }
      return runtime.renderDiagram(renderer, request, scopeId, signal);
    },
    [],
  );

  const releaseDiagramScope = useCallback((scopeId: string) => {
    runtimeRef.current?.releaseDiagramScope(scopeId);
  }, []);

  const shutdown = useCallback(async () => {
    startsAllowedRef.current = false;
    await Promise.allSettled([...emojiWritesRef.current.values()]);
    await runtimeRef.current?.stopAll().catch(reportError);
    await api.recoverPluginTransactions().catch(reportError);
    pendingTransactionsRef.current.clear();
  }, [reportError]);

  const emitNoteEvent = useCallback((event: PluginNoteEvent) => {
    runtimeRef.current?.broadcastNoteEvent(event);
  }, []);

  const invalidateActionLeases = useCallback(() => {
    runtimeRef.current?.invalidateActionLeases();
  }, []);

  return {
    plugins,
    bundles,
    commands,
    sidebarViews,
    statusItems,
    decorations,
    emojiPickers,
    structuredViewers,
    diagramRenderers,
    saveEmojiPreferences,
    sourceControlProviders,
    automaticLocalCommits,
    developmentSupported: import.meta.env.DEV,
    loading,
    busyPluginIds,
    refresh,
    enable,
    disable,
    disableAll,
    updateAll,
    autoUpdateEnabled,
    setAutoUpdateEnabled,
    loadDevelopmentPlugin,
    clearData,
    clearCredentials,
    updateSettings,
    importSettings,
    runCommand,
    runSourceControlAction,
    parseStructuredView,
    renderDiagram,
    releaseDiagramScope,
    emitNoteEvent,
    invalidateActionLeases,
    shutdown,
  };
}

function requiresContent(plugin: PluginView): boolean {
  return plugin.approvedPermissions.some((permission) =>
    ["structured-viewer", "diagram-renderer"].includes(
      permission.capability,
    ),
  );
}
