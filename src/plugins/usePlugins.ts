import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { PluginView } from "../types";
import {
  PluginWorkerRuntime,
  type PluginCommandContribution,
} from "./workerRuntime";

export interface PluginController {
  plugins: PluginView[];
  commands: PluginCommandContribution[];
  loading: boolean;
  busyPluginIds: ReadonlySet<string>;
  refresh: () => Promise<void>;
  enable: (pluginId: string, approvedPermissions: string[]) => Promise<void>;
  disable: (pluginId: string) => Promise<void>;
  clearData: (pluginId: string) => Promise<void>;
  clearCredentials: (pluginId: string) => Promise<void>;
  updateSettings: (
    pluginId: string,
    settings: Record<string, unknown>,
  ) => Promise<void>;
  runCommand: (pluginId: string, commandId: string) => Promise<void>;
}

export function usePlugins(
  reportError: (error: unknown) => void,
): PluginController {
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [commands, setCommands] = useState<PluginCommandContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPluginIds, setBusyPluginIds] = useState<Set<string>>(new Set());
  const runtimeRef = useRef<PluginWorkerRuntime | null>(null);

  const refresh = useCallback(async () => {
    setPlugins(await api.listPlugins());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const runtime = new PluginWorkerRuntime(setCommands, (pluginId, error) => {
      reportError(error);
      void api
        .disablePlugin(pluginId)
        .then(refresh)
        .catch(reportError);
    });
    runtimeRef.current = runtime;
    void api
      .listPlugins()
      .then(async (available) => {
        if (cancelled) {
          return;
        }
        setPlugins(available);
        for (const plugin of available.filter((entry) => entry.enabled)) {
          try {
            await runtime.start(plugin);
          } catch (error) {
            await api.rollbackPluginEnable(
              plugin.catalog.manifest.id,
              errorMessage(error),
            );
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
      runtimeRef.current = null;
      void runtime.stopAll().catch(reportError);
    };
  }, [reportError]);

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
    async (pluginId: string, approvedPermissions: string[]) => {
      await withBusy(pluginId, async () => {
        const current = plugins.find(
          (plugin) => plugin.catalog.manifest.id === pluginId,
        );
        if (!current) {
          throw new Error(`Plugin ${pluginId} is not in the catalog.`);
        }
        let runtimeStarted = false;
        try {
          await api.preparePluginEnable(pluginId, approvedPermissions);
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
          await api.commitPluginEnable(pluginId);
          await refresh();
        } catch (error) {
          if (runtimeStarted) {
            await runtimeRef.current?.stop(pluginId).catch(reportError);
          }
          await api
            .rollbackPluginEnable(pluginId, errorMessage(error))
            .catch(reportError);
          await refresh().catch(reportError);
          throw error;
        }
      });
    },
    [plugins, refresh, reportError, withBusy],
  );

  const disable = useCallback(
    async (pluginId: string) => {
      await withBusy(pluginId, async () => {
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
    async (pluginId: string, commandId: string) => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error("Plugin runtime is unavailable.");
      }
      await runtime.runCommand(pluginId, commandId);
    },
    [],
  );

  return {
    plugins,
    commands,
    loading,
    busyPluginIds,
    refresh,
    enable,
    disable,
    clearData,
    clearCredentials,
    updateSettings,
    runCommand,
  };
}
