import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { PluginBundleMetadata, PluginView } from "../types";
import type {
  PluginNoteEvent,
  PluginPermissionRequest,
  PluginProjectContext,
  PluginSourceControlAction,
} from "@denote/plugin-sdk";
import {
  PluginWorkerRuntime,
  type PluginActionLeaseScope,
  type PluginCommandContribution,
  type PluginSidebarContribution,
  type PluginStatusContribution,
  type PluginDecorationContribution,
  type PluginSourceControlContribution,
} from "./workerRuntime";

export interface PluginController {
  plugins: PluginView[];
  bundles: PluginBundleMetadata[];
  commands: PluginCommandContribution[];
  sidebarViews: PluginSidebarContribution[];
  statusItems: PluginStatusContribution[];
  decorations: PluginDecorationContribution[];
  sourceControlProviders: PluginSourceControlContribution[];
  loading: boolean;
  busyPluginIds: ReadonlySet<string>;
  refresh: () => Promise<void>;
  enable: (
    pluginId: string,
    approvedPermissions: PluginPermissionRequest[],
  ) => Promise<void>;
  disable: (pluginId: string) => Promise<void>;
  disableAll: () => Promise<void>;
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
  ) => Promise<void>;
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
  const [sourceControlProviders, setSourceControlProviders] = useState<
    PluginSourceControlContribution[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(new Set());
  const runtimeRef = useRef<PluginWorkerRuntime | null>(null);
  const pendingTransactionsRef = useRef(new Map<string, string>());
  const startsAllowedRef = useRef(true);

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
    );
    runtime.setWorkspaceIdentity(workspaceIdentity);
    runtime.setProjectContext(projectContext);
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
    runtimeRef.current?.setProjectContext(projectContext);
  }, [projectContext, workspaceIdentity]);

  const withBusy = useCallback(
    async (pluginId: string, operation: () => Promise<void>) => {
      setBusyPluginIds((current) => new Set(current).add(pluginId));
      try {
        await operation();
      } finally {
        setBusyPluginIds((current) => {
          const next = new Set(current);
          next.delete(pluginId);
          return next;
        });
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
        let runtimeStarted = false;
        let transactionId: string | null = null;
        let committed = false;
        try {
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
          await runtime.start(prepared);
          runtimeStarted = true;
          if (!runtime.isRunning(pluginId)) {
            throw new Error(`Plugin ${pluginId} stopped before enablement completed.`);
          }
          await api.commitPluginEnable(transactionId);
          committed = true;
          pendingTransactionsRef.current.delete(pluginId);
        } catch (error) {
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
            } catch (rollbackError) {
              reportError(rollbackError);
            }
          }
          await refresh().catch(reportError);
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
    startsAllowedRef.current = false;
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

  const updateSettings = useCallback(
    async (pluginId: string, settings: Record<string, unknown>) => {
      await withBusy(pluginId, async () => {
        await api.setPluginSettings(pluginId, settings);
        await refresh();
      });
    },
    [refresh, withBusy],
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
      runtime.setProjectContext(projectContext);
      const actionScope: PluginActionLeaseScope = {
        workspaceScope,
        projectId: projectContext?.projectId ?? null,
      };
      await runtime.runCommand(pluginId, commandId, actionScope);
    },
    [projectContext, workspaceIdentity],
  );

  const runSourceControlAction = useCallback(
    async (
      pluginId: string,
      providerId: string,
      action: PluginSourceControlAction,
      workspaceScope: string,
    ) => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error("Plugin runtime is unavailable.");
      }
      runtime.setWorkspaceIdentity(workspaceIdentity);
      runtime.setProjectContext(projectContext);
      const actionScope: PluginActionLeaseScope = {
        workspaceScope,
        projectId: projectContext?.projectId ?? null,
      };
      await runtime.runSourceControlAction(
        pluginId,
        providerId,
        action,
        actionScope,
      );
    },
    [projectContext, workspaceIdentity],
  );

  const importSettings = useCallback(
    async (
      pluginId: string,
      sourceVersion: number,
      settings: Record<string, unknown>,
    ) => {
      await withBusy(pluginId, async () => {
        await api.importPluginSettings(pluginId, sourceVersion, settings);
        await refresh();
      });
    },
    [refresh, withBusy],
  );

  const shutdown = useCallback(async () => {
    startsAllowedRef.current = false;
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
    sourceControlProviders,
    loading,
    busyPluginIds,
    refresh,
    enable,
    disable,
    disableAll,
    clearData,
    clearCredentials,
    updateSettings,
    importSettings,
    runCommand,
    runSourceControlAction,
    emitNoteEvent,
    invalidateActionLeases,
    shutdown,
  };
}
