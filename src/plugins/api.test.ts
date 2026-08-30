import { describe, expect, it, vi } from "vitest";
import {
  PluginRegistry,
  type DenotePlugin,
  type PluginCatalogEntry,
  type PluginHost,
  type PluginInstallation,
} from "./api";

function catalogEntry(
  overrides: Partial<PluginCatalogEntry["manifest"]> = {},
): PluginCatalogEntry {
  return {
    manifest: {
      schemaVersion: 1,
      id: "denote.reference",
      name: "Reference plugin",
      version: "1.0.0",
      description: "Exercises the plugin host without adding a user feature.",
      publisher: {
        name: "Denote",
        url: "https://github.com/mbianchidev/denote",
      },
      license: "MIT",
      repository: "https://github.com/mbianchidev/denote",
      icon: "icon.svg",
      category: "other",
      compatibility: {
        apiVersion: 1,
        minimumDenoteVersion: "0.1.0",
        maximumDenoteVersion: "1.0.0",
      },
      permissions: [{ capability: "commands" }],
      entrypoint: "dist/index.js",
      documentation: "guide.md",
      ...overrides,
    },
    artifact: {
      url: "https://plugins.denote.example/denote.reference-1.0.0.zip",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
    },
    guide: [
      "# Reference plugin",
      "## Purpose",
      "Reference host test.",
      "## Enablement and permissions",
      "Commands only.",
      "## Usage",
      "Run the reference command.",
      "## Settings",
      "No settings.",
      "## Disable behavior",
      "Remove package code.",
      "## Troubleshooting",
      "Retry activation.",
    ].join("\n\n"),
  };
}

function createHost(plugin?: DenotePlugin) {
  const defaultPlugin: DenotePlugin = plugin ?? {
    manifest: catalogEntry().manifest,
    activate: vi.fn(),
  };
  const installation: PluginInstallation = {
    pluginId: defaultPlugin.manifest.id,
    version: defaultPlugin.manifest.version,
    packageRoot: "/app-data/plugins/denote.reference/1.0.0",
    entrypoint:
      "/app-data/plugins/denote.reference/1.0.0/dist/index.js",
  };
  const host: PluginHost = {
    denoteVersion: "0.1.0",
    installer: {
      install: vi.fn(async (_entry, onStateChange) => {
        onStateChange("verifying");
        onStateChange("installing");
        return installation;
      }),
      remove: vi.fn(),
    },
    runtime: {
      load: vi.fn(async () => defaultPlugin),
      unload: vi.fn(),
    },
    contextFactory: {
      create: vi.fn(() => ({
        pluginId: defaultPlugin.manifest.id,
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        storage: {
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
          clear: vi.fn(),
        },
        capabilities: {
          commands: {
            register: vi.fn(() => ({ dispose: vi.fn() })),
          },
        },
      })),
    },
    reportError: vi.fn(),
  };
  return { host, installation };
}

describe("PluginRegistry", () => {
  it("registers catalog metadata without installing or loading plugin code", () => {
    const { host } = createHost();
    const registry = new PluginRegistry(host);

    registry.register(catalogEntry());

    expect(registry.get("denote.reference")).toMatchObject({
      status: "not-installed",
      enabled: false,
    });
    expect(host.installer.install).not.toHaveBeenCalled();
    expect(host.runtime.load).not.toHaveBeenCalled();
  });

  it("does not expose mutable catalog state", () => {
    const { host } = createHost();
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());
    const returned = registry.get("denote.reference");

    returned.catalog.artifact.url = "https://attacker.example/plugin.zip";
    returned.catalog.manifest.permissions.push({
      capability: "secure-storage",
    });

    expect(registry.get("denote.reference").catalog).toEqual(catalogEntry());
  });

  it("does not tear down a plugin that was never active", async () => {
    const { host } = createHost();
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    await registry.setEnabled("denote.reference", false);

    expect(host.runtime.unload).not.toHaveBeenCalled();
    expect(host.installer.remove).not.toHaveBeenCalled();
    expect(registry.get("denote.reference").status).toBe("not-installed");
  });

  it("installs and loads only on enable, then unloads and removes on disable", async () => {
    const cleanup = vi.fn();
    const deactivate = vi.fn();
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: (context) => {
        context.subscriptions.add({ dispose: cleanup });
      },
      deactivate,
    };
    const { host } = createHost(plugin);
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    await registry.setEnabled("denote.reference", true);

    expect(host.installer.install).toHaveBeenCalledOnce();
    expect(host.runtime.load).toHaveBeenCalledOnce();
    expect(registry.get("denote.reference")).toMatchObject({
      status: "enabled",
      enabled: true,
    });

    await registry.setEnabled("denote.reference", false);

    expect(deactivate).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.runtime.unload).toHaveBeenCalledWith("denote.reference");
    expect(host.installer.remove).toHaveBeenCalledWith("denote.reference");
    expect(registry.get("denote.reference")).toMatchObject({
      status: "disabled",
      enabled: false,
    });
  });

  it("rejects incompatible plugins before package installation", async () => {
    const { host } = createHost();
    const registry = new PluginRegistry(host);
    registry.register(
      catalogEntry({
        compatibility: {
          apiVersion: 2,
          minimumDenoteVersion: "0.1.0",
        },
      }),
    );

    expect(registry.get("denote.reference").status).toBe("incompatible");
    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/plugin api version 2/i);
    expect(host.installer.install).not.toHaveBeenCalled();
    expect(host.runtime.load).not.toHaveBeenCalled();
  });

  it("rolls back package code and registered resources when activation fails", async () => {
    const cleanup = vi.fn();
    const activationFailure = new Error("Activation failed");
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: (context) => {
        context.subscriptions.add({ dispose: cleanup });
        throw activationFailure;
      },
    };
    const { host } = createHost(plugin);
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow("Activation failed");

    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.runtime.unload).toHaveBeenCalledWith("denote.reference");
    expect(host.installer.remove).toHaveBeenCalledWith("denote.reference");
    expect(host.reportError).toHaveBeenCalledWith(
      "denote.reference",
      activationFailure,
    );
    expect(registry.get("denote.reference")).toMatchObject({
      status: "failed",
      enabled: false,
      error: "Activation failed",
    });
  });

  it("unloads after a runtime load attempt fails before removing package code", async () => {
    const { host } = createHost();
    host.runtime.load = vi.fn(async () => {
      throw new Error("Runtime load failed");
    });
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow("Runtime load failed");

    expect(host.runtime.unload).toHaveBeenCalledWith("denote.reference");
    expect(host.installer.remove).toHaveBeenCalledWith("denote.reference");
    expect(
      vi.mocked(host.runtime.unload).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(host.installer.remove).mock.invocationCallOrder[0]);
  });

  it("continues cleanup and package deletion after a deactivation error", async () => {
    const cleanup = vi.fn();
    const deactivate = vi
      .fn()
      .mockRejectedValueOnce(new Error("Deactivate failed"))
      .mockResolvedValueOnce(undefined);
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: (context) => {
        context.subscriptions.add({ dispose: cleanup });
      },
      deactivate,
    };
    const { host } = createHost(plugin);
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());
    await registry.setEnabled("denote.reference", true);

    await expect(
      registry.setEnabled("denote.reference", false),
    ).rejects.toThrow(/did not disable cleanly/i);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.runtime.unload).toHaveBeenCalledWith("denote.reference");
    expect(host.installer.remove).toHaveBeenCalledWith("denote.reference");
    expect(registry.get("denote.reference")).toMatchObject({
      status: "failed",
      enabled: false,
    });
    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/cleanup pending/i);

    await registry.setEnabled("denote.reference", false);

    expect(deactivate).toHaveBeenCalledTimes(2);
    expect(registry.get("denote.reference")).toMatchObject({
      status: "disabled",
      enabled: false,
    });
  });

  it("retries failed disposable cleanup before allowing re-enable", async () => {
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error("Cleanup failed"))
      .mockResolvedValueOnce(undefined);
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: (context) => {
        context.subscriptions.add({ dispose: cleanup });
      },
    };
    const { host } = createHost(plugin);
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());
    await registry.setEnabled("denote.reference", true);

    await expect(
      registry.setEnabled("denote.reference", false),
    ).rejects.toThrow(/did not disable cleanly/i);
    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/cleanup pending/i);

    await registry.setEnabled("denote.reference", false);

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(host.runtime.unload).toHaveBeenCalledTimes(1);
    expect(host.installer.remove).toHaveBeenCalledTimes(1);
    expect(registry.get("denote.reference").status).toBe("disabled");
  });

  it("tracks failed runtime teardown and retries before allowing re-enable", async () => {
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: vi.fn(),
    };
    const { host } = createHost(plugin);
    vi.mocked(host.runtime.unload)
      .mockRejectedValueOnce(new Error("Runtime still running"))
      .mockResolvedValueOnce();
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());
    await registry.setEnabled("denote.reference", true);

    await expect(
      registry.setEnabled("denote.reference", false),
    ).rejects.toThrow(/did not disable cleanly/i);
    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/cleanup pending/i);

    await registry.setEnabled("denote.reference", false);

    expect(host.runtime.unload).toHaveBeenCalledTimes(2);
    expect(host.installer.remove).toHaveBeenCalledTimes(1);
    expect(registry.get("denote.reference")).toMatchObject({
      status: "disabled",
      enabled: false,
    });
  });

  it("waits for in-progress enablement and disables it during shutdown", async () => {
    let finishInstall!: () => void;
    const installBarrier = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: vi.fn(),
    };
    const { host, installation } = createHost(plugin);
    host.installer.install = vi.fn(async () => {
      await installBarrier;
      return installation;
    });
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    const enablement = registry.setEnabled("denote.reference", true);
    const shutdown = registry.deactivateAll();
    finishInstall();
    await enablement;
    await shutdown;

    expect(host.runtime.unload).toHaveBeenCalledWith("denote.reference");
    expect(host.installer.remove).toHaveBeenCalledWith("denote.reference");
    expect(registry.get("denote.reference").status).toBe("disabled");
    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/unavailable during shutdown/i);
  });

  it("rejects duplicate catalog IDs", () => {
    const { host } = createHost();
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    expect(() => registry.register(catalogEntry())).toThrow(
      "Plugin denote.reference is already registered.",
    );
  });

  it("rejects runtime manifests that differ from signed catalog metadata", async () => {
    const plugin: DenotePlugin = {
      manifest: {
        ...catalogEntry().manifest,
        permissions: [
          { capability: "commands" },
          { capability: "secure-storage" },
        ],
      },
      activate: vi.fn(),
    };
    const { host } = createHost(plugin);
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/does not match catalog entry/i);
    expect(plugin.activate).not.toHaveBeenCalled();
    expect(host.runtime.unload).toHaveBeenCalledWith("denote.reference");
    expect(host.installer.remove).toHaveBeenCalledWith("denote.reference");
  });

  it("rejects capabilities that were not declared in the manifest", async () => {
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: vi.fn(),
    };
    const { host } = createHost(plugin);
    host.contextFactory.create = vi.fn(() => ({
      pluginId: plugin.manifest.id,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      storage: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn(),
      },
      capabilities: {
        commands: {
          register: vi.fn(() => ({ dispose: vi.fn() })),
        },
        secureStorage: {
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
        },
      },
    }));
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/received undeclared secure-storage capability/i);
    expect(plugin.activate).not.toHaveBeenCalled();
    expect(host.installer.remove).toHaveBeenCalledWith("denote.reference");
  });

  it("withholds mutating capabilities from activation", async () => {
    const entry = catalogEntry({
      permissions: [
        { capability: "workspace-write" },
        { capability: "clipboard-write" },
        { capability: "process" },
      ],
    });
    const activate = vi.fn();
    const plugin: DenotePlugin = {
      manifest: entry.manifest,
      activate,
    };
    const { host } = createHost(plugin);
    host.contextFactory.create = vi.fn(() => ({
      pluginId: plugin.manifest.id,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      storage: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn(),
      },
      capabilities: {},
    }));
    const registry = new PluginRegistry(host);
    registry.register(entry);

    await registry.setEnabled("denote.reference", true);

    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: {},
      }),
    );
  });

  it("rejects mutating capabilities exposed outside a user action", async () => {
    const plugin: DenotePlugin = {
      manifest: catalogEntry().manifest,
      activate: vi.fn(),
    };
    const { host } = createHost(plugin);
    host.contextFactory.create = vi.fn(() => ({
      pluginId: plugin.manifest.id,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      storage: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn(),
      },
      capabilities: {
        commands: {
          register: vi.fn(() => ({ dispose: vi.fn() })),
        },
        workspaceWrite: {
          readText: vi.fn(),
          writeText: vi.fn(),
        },
      },
    }));
    const registry = new PluginRegistry(host);
    registry.register(catalogEntry());

    await expect(
      registry.setEnabled("denote.reference", true),
    ).rejects.toThrow(/workspaceWrite outside a user action/i);
    expect(plugin.activate).not.toHaveBeenCalled();
  });
});
