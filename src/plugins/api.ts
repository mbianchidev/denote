export type PluginCapability =
  | "commands"
  | "sidebar"
  | "editor-decoration"
  | "note-events"
  | "filesystem"
  | "network";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: PluginCapability[];
}

export interface PluginContext {
  vaultPath: string;
  reportError: (pluginId: string, error: unknown) => void;
  registerCleanup: (cleanup: () => void | Promise<void>) => void;
}

export interface DenotePlugin {
  manifest: PluginManifest;
  activate: (context: PluginContext) => void | Promise<void>;
}

export interface PluginState {
  manifest: PluginManifest;
  enabled: boolean;
  active: boolean;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, DenotePlugin>();
  private readonly enabled = new Set<string>();
  private readonly cleanups = new Map<
    string,
    Array<() => void | Promise<void>>
  >();

  register(plugin: DenotePlugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(`Plugin ${plugin.manifest.id} is already registered.`);
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  list(): PluginState[] {
    return [...this.plugins.values()].map((plugin) => ({
      manifest: plugin.manifest,
      enabled: this.enabled.has(plugin.manifest.id),
      active: this.cleanups.has(plugin.manifest.id),
    }));
  }

  async setEnabled(
    pluginId: string,
    enabled: boolean,
    context: Omit<PluginContext, "registerCleanup">,
  ): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} is not registered.`);
    }
    if (!enabled) {
      await this.deactivate(pluginId);
      this.enabled.delete(pluginId);
      return;
    }
    if (this.cleanups.has(pluginId)) {
      this.enabled.add(pluginId);
      return;
    }

    const pluginCleanups: Array<() => void | Promise<void>> = [];
    await plugin.activate({
      ...context,
      registerCleanup: (cleanup) => pluginCleanups.push(cleanup),
    });
    this.cleanups.set(pluginId, pluginCleanups);
    this.enabled.add(pluginId);
  }

  async deactivate(pluginId: string): Promise<void> {
    const pluginCleanups = this.cleanups.get(pluginId) ?? [];
    for (const cleanup of pluginCleanups.reverse()) {
      await cleanup();
    }
    this.cleanups.delete(pluginId);
  }
}
