import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import catalogJson from "../../plugins/catalog.json";
import {
  assertValidPluginCatalogEntry,
  type PluginProjectContext,
  type PluginEmojiPreferences,
} from "@denote/plugin-sdk";
import type { PluginEmojiPickerContribution } from "./emojiPickers";
import type { PluginView } from "../types";
import { api } from "../lib/api";
import { usePlugins } from "./usePlugins";

interface MockRuntimeInstance {
  onCommandsChanged: unknown;
  onSourceControlProvidersChanged?: unknown;
  onAutomaticLocalCommitsChanged?: unknown;
  onEmojiPickersChanged?: (pickers: PluginEmojiPickerContribution[]) => void;
  getEmojiPicker: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
  isRunning: ReturnType<typeof vi.fn>;
  runCommand: ReturnType<typeof vi.fn>;
  runSourceControlAction: ReturnType<typeof vi.fn>;
  broadcastNoteEvent: ReturnType<typeof vi.fn>;
  setProjectContext: ReturnType<typeof vi.fn>;
  setWorkspaceIdentity: ReturnType<typeof vi.fn>;
  invalidateActionLeases: ReturnType<typeof vi.fn>;
}

// Hoisted so the values are available both inside the vi.mock factories
// (which vitest hoists above these imports) and inside the test bodies below.
const { runtimeInstances, callOrder } = vi.hoisted(() => ({
  runtimeInstances: [] as MockRuntimeInstance[],
  callOrder: [] as string[],
}));

vi.mock("../lib/api", () => ({
  api: {
    listPlugins: vi.fn(),
    listPluginBundles: vi.fn(),
    preparePluginEnable: vi.fn(),
    commitPluginEnable: vi.fn(),
    rollbackPluginEnable: vi.fn(),
    recoverPluginTransactions: vi.fn(),
    disablePlugin: vi.fn(),
    setPluginSettings: vi.fn(),
    getPluginSettings: vi.fn(),
    importPluginSettings: vi.fn(),
  },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

vi.mock("./workerRuntime", () => {
  class MockPluginWorkerRuntime {
    start = vi.fn(async () => {
      callOrder.push("start");
    });
    stop = vi.fn(async () => {
      callOrder.push("stop");
    });
    stopAll = vi.fn(async () => {
      callOrder.push("stopAll");
    });
    isRunning = vi.fn(() => true);
    runCommand = vi.fn(async () => {});
    runSourceControlAction = vi.fn(async () => {});
    broadcastNoteEvent = vi.fn();
    setProjectContext = vi.fn();
    setWorkspaceIdentity = vi.fn();
    invalidateActionLeases = vi.fn();
    getEmojiPicker = vi.fn();

    constructor(
      public onCommandsChanged: unknown,
      public onError: unknown,
      public onSidebarViewsChanged?: unknown,
      public onStatusItemsChanged?: unknown,
      public onDecorationsChanged?: unknown,
      public onSourceControlProvidersChanged?: unknown,
      public onAutomaticLocalCommitsChanged?: unknown,
      public onVaultCloned?: unknown,
      public onEmojiPickersChanged?: (pickers: PluginEmojiPickerContribution[]) => void,
    ) {
      runtimeInstances.push(this);
    }
  }
  return { PluginWorkerRuntime: MockPluginWorkerRuntime };
});

const catalogValue: unknown = catalogJson[0];
assertValidPluginCatalogEntry(catalogValue);
const catalog = catalogValue;
const pluginId = catalog.manifest.id;
const emojiPicker: PluginEmojiPickerContribution = {
  pluginId,
  id: `${pluginId}.emoji`,
  title: "Insert emoji",
  entries: [{
    id: "wave", name: "Waving hand", unicode: "\u{1f44b}", category: "People",
    keywords: ["hello"], shortcodes: ["wave"], variants: [],
  }],
  shortcodes: true,
  settingsKeys: { recents: "recents", favorites: "favorites", tone: "tone" },
};
const emojiPreferences: PluginEmojiPreferences = {
  recents: ["\u{1f44b}"], favorites: [], tone: 0,
};

function makePlugin(overrides: Partial<PluginView> = {}): PluginView {
  return {
    catalog,
    status: "not-installed",
    enabled: false,
    error: null,
    approvedPermissions: [],
    previouslyApproved: false,
    settings: {},
    hasCredentials: false,
    ...overrides,
  };
}

/** Queues one `api.listPlugins` resolution that also records call order. */
function queueListPlugins(plugins: PluginView[]) {
  vi.mocked(api.listPlugins).mockImplementationOnce(async () => {
    callOrder.push("listPlugins");
    return plugins;
  });
}

/** Queues one `api.recoverPluginTransactions` resolution recording call order. */
function queueRecoverTransactions() {
  vi.mocked(api.recoverPluginTransactions).mockImplementationOnce(async () => {
    callOrder.push("recoverPluginTransactions");
  });
}

/**
 * Mounts the hook and waits for the startup effect (recovery, restore of
 * already-enabled plugins, then a final refresh) to finish, then clears
 * recorded call order so each test can assert only the behavior it triggers
 * afterward. The startup effect unconditionally calls `api.listPlugins`
 * twice: once for the initial catalog fetch and once after the restore loop.
 */
async function mountReady(
  initialPlugins: PluginView[],
  projectContext: PluginProjectContext | null = null,
  workspaceIdentity: string | null = "/synthetic/vault-alpha",
) {
  queueRecoverTransactions();
  queueListPlugins(initialPlugins);
  queueListPlugins(initialPlugins);
  const rendered = renderHook(
    ({
      currentProjectContext,
      currentWorkspaceIdentity,
    }: {
      currentProjectContext: PluginProjectContext | null;
      currentWorkspaceIdentity: string | null;
    }) =>
      usePlugins(reportError, currentProjectContext, currentWorkspaceIdentity),
    {
      initialProps: {
        currentProjectContext: projectContext,
        currentWorkspaceIdentity: workspaceIdentity,
      },
    },
  );
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  callOrder.length = 0;
  vi.mocked(api.recoverPluginTransactions).mockClear();
  vi.mocked(api.listPlugins).mockClear();
  return rendered;
}

const reportError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.setPluginSettings).mockReset().mockResolvedValue({});
  vi.mocked(api.getPluginSettings).mockReset().mockResolvedValue({});
  vi.mocked(api.listPluginBundles).mockResolvedValue([]);
  runtimeInstances.length = 0;
  callOrder.length = 0;
});

describe("usePlugins", () => {
  it("reactivates after settings import so shortcode enablement and lists take effect", async () => {
    const enabled = makePlugin({ enabled: true });
    const { result } = await mountReady([enabled]);
    const imported = { autocomplete: false, recents: "[]", favorites: "[]", tone: 0 };
    queueListPlugins([{ ...enabled, settings: imported }]);
    queueListPlugins([{ ...enabled, settings: imported }]);
    runtimeInstances[0].start.mockClear();
    await act(async () => {
      await result.current.importSettings(pluginId, 1, imported);
    });
    expect(api.importPluginSettings).toHaveBeenCalledWith(pluginId, 1, imported);
    expect(runtimeInstances[0].stop).toHaveBeenCalledWith(pluginId);
    expect(runtimeInstances[0].start).toHaveBeenCalledWith(expect.objectContaining({ settings: imported }));
  });

  it("rejects preference writes while a Settings operation owns the plugin queue", async () => {
    const { result } = await mountReady([makePlugin({ enabled: false })]);
    runtimeInstances[0].getEmojiPicker.mockReturnValue(emojiPicker);
    let finish: (value: Record<string, unknown>) => void = () => {};
    vi.mocked(api.setPluginSettings).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    queueListPlugins([makePlugin()]);
    await act(async () => {
      const updating = result.current.updateSettings(pluginId, {});
      await vi.waitFor(() => expect(api.setPluginSettings).toHaveBeenCalled());
      await expect(result.current.saveEmojiPreferences(pluginId, emojiPicker.id, emojiPreferences))
        .rejects.toThrow(/no longer available/);
      finish({});
      await updating;
    });
    expect(api.getPluginSettings).not.toHaveBeenCalled();
  });

  it("publishes emoji contributions and saves scoped preferences without a worker restart", async () => {
    const { result } = await mountReady([makePlugin({ enabled: true })]);
    const runtime = runtimeInstances[0];
    runtime.getEmojiPicker.mockReturnValue(emojiPicker);
    await act(async () => runtime.onEmojiPickersChanged?.([emojiPicker]));
    expect(result.current.emojiPickers).toEqual([emojiPicker]);
    vi.mocked(api.getPluginSettings).mockResolvedValue({ autocomplete: true });
    vi.mocked(api.setPluginSettings).mockImplementation(async (_id, settings) => settings);
    runtime.start.mockClear();
    await act(async () => {
      await result.current.saveEmojiPreferences(pluginId, emojiPicker.id, emojiPreferences);
    });
    expect(api.setPluginSettings).toHaveBeenCalledWith(pluginId, {
      autocomplete: true, recents: '["\u{1f44b}"]', favorites: "[]", tone: 0,
    });
    expect(result.current.plugins[0].settings.recents).toBe('["\u{1f44b}"]');
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it("serializes preferences and reports persistence errors without suppressing the next save", async () => {
    const { result } = await mountReady([makePlugin({ enabled: true })]);
    runtimeInstances[0].getEmojiPicker.mockReturnValue(emojiPicker);
    vi.mocked(api.getPluginSettings).mockResolvedValue({});
    vi.mocked(api.setPluginSettings)
      .mockRejectedValueOnce(new Error("Synthetic settings failure"))
      .mockImplementationOnce(async (_id, settings) => settings);
    await act(async () => {
      const first = result.current.saveEmojiPreferences(pluginId, emojiPicker.id, emojiPreferences);
      const second = result.current.saveEmojiPreferences(pluginId, emojiPicker.id, { ...emojiPreferences, tone: 3 });
      await expect(first).rejects.toThrow("Synthetic settings failure");
      await second;
    });
    expect(result.current.plugins[0].settings.tone).toBe(3);
  });

  it("flushes accepted preferences before shutdown while refusing new writes", async () => {
    const { result } = await mountReady([makePlugin({ enabled: true })]);
    runtimeInstances[0].getEmojiPicker.mockReturnValue(emojiPicker);
    vi.mocked(api.recoverPluginTransactions).mockResolvedValue();
    vi.mocked(api.getPluginSettings).mockResolvedValue({});
    vi.mocked(api.setPluginSettings).mockImplementation(async (_id, settings) => settings);
    await act(async () => {
      const write = result.current.saveEmojiPreferences(pluginId, emojiPicker.id, emojiPreferences);
      const shutdown = result.current.shutdown();
      await expect(result.current.saveEmojiPreferences(pluginId, emojiPicker.id, emojiPreferences))
        .rejects.toThrow(/no longer available/);
      await write;
      await shutdown;
    });
    expect(api.setPluginSettings).toHaveBeenCalledTimes(1);
    expect(runtimeInstances[0].stopAll).toHaveBeenCalled();
  });

  it("rejects in-flight preferences after a vault change or worker replacement", async () => {
    const { result, rerender } = await mountReady([makePlugin({ enabled: true })]);
    runtimeInstances[0].getEmojiPicker.mockReturnValue(emojiPicker);
    let finishRead: (value: Record<string, unknown>) => void = () => {};
    vi.mocked(api.getPluginSettings).mockImplementation(
      () => new Promise((resolve) => { finishRead = resolve; }),
    );
    await act(async () => {
      const write = result.current.saveEmojiPreferences(pluginId, emojiPicker.id, emojiPreferences);
      const rejected = expect(write).rejects.toThrow(/changed/);
      await Promise.resolve();
      rerender({ currentProjectContext: null, currentWorkspaceIdentity: "/synthetic/vault-beta" });
      runtimeInstances[0].getEmojiPicker.mockReturnValue({ ...emojiPicker });
      finishRead({});
      await rejected;
    });
    expect(api.setPluginSettings).not.toHaveBeenCalled();
  });

  it("waits for an issued settings write before disabling and deleting plugin data", async () => {
    const enabled = makePlugin({ enabled: true });
    const { result } = await mountReady([enabled]);
    runtimeInstances[0].getEmojiPicker.mockReturnValue(emojiPicker);
    vi.mocked(api.getPluginSettings).mockResolvedValue({});
    let finishWrite: (value: Record<string, unknown>) => void = () => {};
    vi.mocked(api.setPluginSettings).mockImplementation(
      () => new Promise((resolve) => { finishWrite = resolve; }),
    );
    queueListPlugins([makePlugin()]);
    await act(async () => {
      const write = result.current.saveEmojiPreferences(pluginId, emojiPicker.id, emojiPreferences);
      const rejected = expect(write).rejects.toThrow(/changed/);
      await vi.waitFor(() => expect(api.setPluginSettings).toHaveBeenCalled());
      const disable = result.current.disable(pluginId);
      expect(api.disablePlugin).not.toHaveBeenCalled();
      finishWrite({});
      await rejected;
      await disable;
    });
    expect(api.disablePlugin).toHaveBeenCalledWith(pluginId);
  });

  it("keeps the catalog usable when bundle metadata fails to load", async () => {
    vi.mocked(api.listPluginBundles).mockRejectedValueOnce(
      new Error("Invalid embedded plugin bundles"),
    );
    const { result } = await mountReady([makePlugin()]);

    expect(result.current.plugins).toEqual([makePlugin()]);
    expect(result.current.bundles).toEqual([]);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid embedded plugin bundles" }),
    );
  });

  it("exposes bundle metadata independently from the plugin catalog", async () => {
    vi.mocked(api.listPluginBundles).mockResolvedValueOnce([
      {
        id: "code-tooling",
        name: "Code tooling",
        categories: ["code"],
        roles: [
          {
            id: "terminal",
            name: "Terminal",
            candidatePluginIds: [],
          },
        ],
      },
    ]);
    const { result } = await mountReady([makePlugin()]);

    await waitFor(() => expect(result.current.bundles).toHaveLength(1));
    expect(result.current.bundles[0].roles[0].name).toBe("Terminal");
  });

  it("enables a plugin in prepare -> runtime.start -> commit -> refresh order", async () => {
    const notEnabled = makePlugin({ enabled: false });
    const { result } = await mountReady([notEnabled]);

    vi.mocked(api.preparePluginEnable).mockImplementationOnce(async () => {
      callOrder.push("prepare");
      return {
        pluginId,
        version: "1.0.0",
        entrypoint: "dist/index.js",
        transactionId: "tx-1",
      };
    });

    queueListPlugins([notEnabled]); // re-fetch of the "prepared" plugin state
    vi.mocked(api.commitPluginEnable).mockImplementationOnce(async () => {
      callOrder.push("commit");
    });
    queueListPlugins([makePlugin({ enabled: true })]); // post-commit refresh

    await act(async () => {
      await result.current.enable(pluginId, []);
    });

    expect(callOrder).toEqual([
      "prepare",
      "listPlugins",
      "start",
      "commit",
      "listPlugins",
    ]);
    expect(runtimeInstances[0].start).toHaveBeenCalledTimes(1);
    expect(api.commitPluginEnable).toHaveBeenCalledWith("tx-1");
    expect(result.current.plugins).toEqual([makePlugin({ enabled: true })]);
  });

  it("updates only previously approved plugins that actually have updates", async () => {
    const gitCatalog = {
      ...catalog,
      manifest: {
        ...catalog.manifest,
        id: "denote.git",
        name: "Git vault versioning",
      },
    };
    const git = makePlugin({
      catalog: gitCatalog,
      status: "update-available",
      enabled: true,
      previouslyApproved: true,
    });
    const reference = makePlugin({
      status: "not-installed",
      previouslyApproved: true,
    });
    const { result } = await mountReady([git, reference]);
    vi.mocked(api.preparePluginEnable).mockImplementationOnce(async () => {
      callOrder.push("prepare");
      return {
        pluginId: "denote.git",
        version: "0.4.0",
        entrypoint: "dist/index.js",
        transactionId: "tx-git",
      };
    });
    queueListPlugins([git, reference]);
    vi.mocked(api.commitPluginEnable).mockImplementationOnce(async () => {
      callOrder.push("commit");
    });
    queueListPlugins([
      { ...git, status: "enabled", enabled: true },
      reference,
    ]);

    await act(async () => {
      await result.current.updateAll();
    });

    expect(callOrder).toEqual([
      "stop",
      "prepare",
      "listPlugins",
      "start",
      "commit",
      "listPlugins",
    ]);
    expect(api.preparePluginEnable).toHaveBeenCalledTimes(1);
    expect(api.preparePluginEnable).toHaveBeenCalledWith(
      "denote.git",
      gitCatalog.manifest.permissions,
    );
    expect(api.commitPluginEnable).toHaveBeenCalledWith("tx-git");
    expect(runtimeInstances[0].start).toHaveBeenCalledWith(git);
  });

  it("restarts the installed version when an explicit update fails", async () => {
    const current = makePlugin({
      status: "update-available",
      enabled: true,
      previouslyApproved: true,
    });
    const { result } = await mountReady([current]);
    vi.mocked(api.preparePluginEnable).mockImplementationOnce(async () => {
      callOrder.push("prepare");
      return {
        pluginId,
        version: "2.0.0",
        entrypoint: "dist/index.js",
        transactionId: "tx-update",
      };
    });
    queueListPlugins([current]);
    runtimeInstances[0].start.mockRejectedValueOnce(
      new Error("Synthetic update activation failed"),
    );
    vi.mocked(api.rollbackPluginEnable).mockImplementationOnce(async () => {
      callOrder.push("rollback");
    });
    queueListPlugins([current]);

    await act(async () => {
      await expect(
        result.current.enable(pluginId, current.catalog.manifest.permissions),
      ).rejects.toThrow("Synthetic update activation failed");
    });

    expect(callOrder).toEqual([
      "stop",
      "prepare",
      "listPlugins",
      "rollback",
      "listPlugins",
      "start",
    ]);
    expect(api.rollbackPluginEnable).toHaveBeenCalledWith(
      "tx-update",
      "Synthetic update activation failed",
    );
    expect(runtimeInstances[0].start).toHaveBeenLastCalledWith(current);
  });

  it("restarts the installed version when the update download returns 404 before preparation", async () => {
    const current = makePlugin({
      status: "update-available",
      enabled: true,
      previouslyApproved: true,
    });
    const { result } = await mountReady([current]);
    vi.mocked(api.preparePluginEnable).mockImplementationOnce(async () => {
      callOrder.push("prepare");
      throw new Error("Synthetic plugin download returned HTTP 404 Not Found");
    });
    queueListPlugins([current]);

    await act(async () => {
      await expect(
        result.current.enable(pluginId, current.catalog.manifest.permissions),
      ).rejects.toThrow("HTTP 404 Not Found");
    });

    expect(callOrder).toEqual(["stop", "prepare", "listPlugins", "start"]);
    expect(api.commitPluginEnable).not.toHaveBeenCalled();
    expect(api.rollbackPluginEnable).not.toHaveBeenCalled();
    expect(api.disablePlugin).not.toHaveBeenCalled();
    expect(runtimeInstances[0].start).toHaveBeenLastCalledWith(current);
    expect(result.current.busyPluginIds.size).toBe(0);
  });

  it("stops the runtime and rolls back without committing when the runtime fails to start", async () => {
    const notEnabled = makePlugin({ enabled: false });
    const { result } = await mountReady([notEnabled]);

    vi.mocked(api.preparePluginEnable).mockImplementationOnce(async () => {
      callOrder.push("prepare");
      return {
        pluginId,
        version: "1.0.0",
        entrypoint: "dist/index.js",
        transactionId: "tx-2",
      };
    });
    queueListPlugins([notEnabled]);
    // The runtime reports it started, but is no longer running by the time
    // enablement checks it, which is the "failed start" path that must roll
    // back and must never commit.
    runtimeInstances[0].isRunning.mockReturnValueOnce(false);
    vi.mocked(api.rollbackPluginEnable).mockImplementationOnce(async () => {
      callOrder.push("rollback");
    });
    queueListPlugins([notEnabled]); // post-failure refresh

    await act(async () => {
      await expect(result.current.enable(pluginId, [])).rejects.toThrow(
        /stopped before enablement completed/,
      );
    });

    expect(callOrder).toEqual([
      "prepare",
      "listPlugins",
      "start",
      "stop",
      "rollback",
      "listPlugins",
    ]);
    expect(api.commitPluginEnable).not.toHaveBeenCalled();
    expect(api.rollbackPluginEnable).toHaveBeenCalledWith(
      "tx-2",
      expect.stringMatching(/stopped before enablement completed/),
    );
  });

  it("stops the runtime before deleting the native package on disable", async () => {
    const enabled = makePlugin({ enabled: true });
    const { result } = await mountReady([enabled]);

    vi.mocked(api.disablePlugin).mockImplementationOnce(async () => {
      callOrder.push("disablePlugin");
    });
    queueListPlugins([makePlugin({ enabled: false })]);

    await act(async () => {
      await result.current.disable(pluginId);
    });

    expect(callOrder).toEqual(["stop", "disablePlugin", "listPlugins"]);
    expect(api.disablePlugin).toHaveBeenCalledWith(pluginId);
  });

  it("restores only previously enabled plugins, and only after transaction recovery", async () => {
    const enabled = makePlugin({ enabled: true });
    const disabled = makePlugin({
      enabled: false,
      catalog: {
        ...catalog,
        manifest: { ...catalog.manifest, id: "denote.other" },
      },
    });
    queueRecoverTransactions();
    queueListPlugins([enabled, disabled]);
    queueListPlugins([enabled, disabled]); // final listPlugins after restore loop

    const { result } = renderHook(() => usePlugins(reportError));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(callOrder).toEqual([
      "recoverPluginTransactions",
      "listPlugins",
      "start",
      "listPlugins",
    ]);
    expect(runtimeInstances[0].start).toHaveBeenCalledTimes(1);
    expect(runtimeInstances[0].start).toHaveBeenCalledWith(
      expect.objectContaining({
        catalog: expect.objectContaining({
          manifest: expect.objectContaining({ id: pluginId }),
        }),
      }),
    );
  });

  it("stops all runtimes and recovers transactions on shutdown", async () => {
    const { result } = await mountReady([makePlugin({ enabled: false })]);
    queueRecoverTransactions();

    await act(async () => {
      await result.current.shutdown();
    });

    expect(callOrder).toEqual(["stopAll", "recoverPluginTransactions"]);
    expect(runtimeInstances[0].stopAll).toHaveBeenCalledTimes(1);
    expect(api.recoverPluginTransactions).toHaveBeenCalledTimes(1);
  });

  it("publishes command contributions from the active runtime", async () => {
    const { result } = await mountReady([makePlugin({ enabled: true })]);
    const publishCommands = runtimeInstances[0].onCommandsChanged as (
      commands: Array<{ pluginId: string; id: string; title: string }>,
    ) => void;

    act(() => {
      publishCommands([
        {
          pluginId,
          id: "denote.reference.verify-keychain",
          title: "Plugin host: verify keychain isolation",
        },
      ]);
    });

    expect(result.current.commands).toEqual([
      {
        pluginId,
        id: "denote.reference.verify-keychain",
        title: "Plugin host: verify keychain isolation",
      },
    ]);
  });

  it("provides the current project before startup and forwards later changes", async () => {
    const initial = {
      projectId: "project-alpha",
      rootPath: "code/alpha",
    };
    const rendered = await mountReady([makePlugin({ enabled: true })], initial);

    expect(runtimeInstances[0].setProjectContext).toHaveBeenCalledWith(
      initial,
      [],
    );
    expect(runtimeInstances[0].setWorkspaceIdentity).toHaveBeenCalledWith(
      "/synthetic/vault-alpha",
    );

    const next = {
      projectId: "project-beta",
      rootPath: "code/beta",
    };
    rendered.rerender({
      currentProjectContext: next,
      currentWorkspaceIdentity: "/synthetic/vault-alpha",
    });
    await waitFor(() => {
      expect(runtimeInstances[0].setProjectContext).toHaveBeenLastCalledWith(
        next,
        [],
      );
    });

    rendered.rerender({
      currentProjectContext: null,
      currentWorkspaceIdentity: "/synthetic/vault-alpha",
    });
    await waitFor(() => {
      expect(runtimeInstances[0].setProjectContext).toHaveBeenLastCalledWith(
        null,
        [],
      );
    });
  });

  it("reports a vault switch that leaves the project context null", async () => {
    const rendered = await mountReady([makePlugin({ enabled: true })]);
    const runtime = runtimeInstances[0];
    runtime.setWorkspaceIdentity.mockClear();
    runtime.setProjectContext.mockClear();

    rendered.rerender({
      currentProjectContext: null,
      currentWorkspaceIdentity: "/synthetic/vault-beta",
    });

    await waitFor(() => {
      expect(runtime.setWorkspaceIdentity).toHaveBeenLastCalledWith(
        "/synthetic/vault-beta",
      );
    });
    // The workspace is applied before the project, so a plugin cannot act on
    // the new project while it still believes it is in the previous vault.
    expect(
      runtime.setWorkspaceIdentity.mock.invocationCallOrder[0],
    ).toBeLessThan(runtime.setProjectContext.mock.invocationCallOrder[0]);
  });

  it("captures the current nullable project ID when a command starts", async () => {
    const initial = {
      projectId: "project-alpha",
      rootPath: "code/alpha",
    };
    const rendered = await mountReady([makePlugin({ enabled: true })], initial);

    await act(async () => {
      await rendered.result.current.runCommand(
        pluginId,
        "denote.reference.synthetic",
        "/vault",
      );
    });
    expect(runtimeInstances[0].runCommand).toHaveBeenLastCalledWith(
      pluginId,
      "denote.reference.synthetic",
      {
        workspaceScope: "/vault",
        projectId: "project-alpha",
        sourceControlActionId: null,
      },
    );

    rendered.rerender({
      currentProjectContext: null,
      currentWorkspaceIdentity: "/synthetic/vault-alpha",
    });
    await act(async () => {
      await rendered.result.current.runCommand(
        pluginId,
        "denote.reference.synthetic",
        "/vault",
      );
    });
    expect(runtimeInstances[0].runCommand).toHaveBeenLastCalledWith(
      pluginId,
      "denote.reference.synthetic",
      { workspaceScope: "/vault", projectId: null, sourceControlActionId: null },
    );
  });

  it("publishes source control providers and scopes their actions", async () => {
    const projectContext = {
      projectId: "project-alpha",
      rootPath: "code/alpha",
    };
    const rendered = await mountReady(
      [makePlugin({ enabled: true })],
      projectContext,
    );
    const model = {
      selectedTab: "changes",
      selectedView: { kind: "repository" },
      repository: {
        repositoryId: "repo-1",
        label: "Synthetic repository",
        initialized: true,
        branch: "main",
        upstream: null,
        ahead: 0,
        behind: 0,
        latestCommit: null,
        busy: false,
      },
      resourceGroups: [],
      branches: [],
      remotes: [],
      history: [],
      historyPage: {
        pageIndex: 0,
        pageSize: 20,
        hasPrevious: false,
        hasNext: false,
        loading: false,
        error: null,
      },
      commitDetail: null,
      diffFiles: [],
      diffSource: null,
      conflicts: [],
      conflictDetail: null,
      operationProgress: null,
      operationPlan: null,
      recovery: { state: "idle" },
      remoteAccess: {
        authMode: "public" as const,
        cloneAvailable: true,
        githubAvailable: false,
        repositories: [],
        cleanup: null,
        review: null,
      },
    } as const;
    const publishProviders = runtimeInstances[0]
      .onSourceControlProvidersChanged as (
      providers: Array<{
        pluginId: string;
        id: string;
        title: string;
        model: typeof model;
      }>,
    ) => void;

    act(() => {
      publishProviders([
        {
          pluginId,
          id: "denote.reference.git",
          title: "Git",
          model,
        },
      ]);
    });
    expect(rendered.result.current.sourceControlProviders).toEqual([
      {
        pluginId,
        id: "denote.reference.git",
        title: "Git",
        model,
      },
    ]);

    await act(async () => {
      await rendered.result.current.runSourceControlAction(
        pluginId,
        "denote.reference.git",
        { id: "refresh", values: { force: true } },
        "/vault",
      );
    });
    expect(
      runtimeInstances[0].runSourceControlAction,
    ).toHaveBeenLastCalledWith(
      pluginId,
      "denote.reference.git",
      { id: "refresh", values: { force: true } },
      {
        workspaceScope: "/vault",
        projectId: "project-alpha",
        // The lease names the action the host is running, so a host operation
        // reserved for one action cannot be reached from another.
        sourceControlActionId: "refresh",
      },
    );

    await act(async () => {
      await rendered.result.current.runSourceControlAction(
        pluginId,
        "denote.reference.git",
        { id: "commit", values: { message: "Signed synthetic change" } },
        "/vault",
        { gitSigningPassphrase: "synthetic-passphrase" },
      );
    });
    expect(
      runtimeInstances[0].runSourceControlAction,
    ).toHaveBeenLastCalledWith(
      pluginId,
      "denote.reference.git",
      { id: "commit", values: { message: "Signed synthetic change" } },
      {
        workspaceScope: "/vault",
        projectId: "project-alpha",
        sourceControlActionId: "commit",
        gitSigningPassphrase: "synthetic-passphrase",
      },
    );
  });

  it("publishes automatic local commit schedules from the active runtime", async () => {
    const rendered = await mountReady([makePlugin({ enabled: true })]);
    const publishSchedules = runtimeInstances[0]
      .onAutomaticLocalCommitsChanged as (
      schedules: Array<Record<string, unknown>>,
    ) => void;

    act(() => {
      publishSchedules([
        {
          pluginId,
          id: "denote.reference.nightly",
          intervalMinutes: 15,
          message: "Synthetic automatic commit",
          includePatterns: [],
          excludePatterns: [],
          authorName: null,
          authorEmail: null,
        },
      ]);
    });

    expect(rendered.result.current.automaticLocalCommits).toEqual([
      expect.objectContaining({
        pluginId,
        id: "denote.reference.nightly",
        intervalMinutes: 15,
      }),
    ]);

    act(() => {
      publishSchedules([]);
    });
    expect(rendered.result.current.automaticLocalCommits).toEqual([]);
  });

  it("reloads a running runtime so a settings change takes effect", async () => {
    const enabled = makePlugin({ enabled: true });
    const { result } = await mountReady([enabled]);
    queueListPlugins([enabled]);
    queueListPlugins([enabled]);

    await act(async () => {
      await result.current.updateSettings(pluginId, {
        autoCommitIntervalMinutes: 15,
      });
    });

    expect(api.setPluginSettings).toHaveBeenCalledWith(pluginId, {
      autoCommitIntervalMinutes: 15,
    });
    // The runtime is restarted, not reinstalled: no transaction is prepared
    // and the plugin stays enabled throughout.
    expect(callOrder).toEqual([
      "listPlugins",
      "stop",
      "start",
      "listPlugins",
    ]);
    expect(api.preparePluginEnable).not.toHaveBeenCalled();
    expect(api.disablePlugin).not.toHaveBeenCalled();
  });

  it("disables a plugin whose runtime cannot restart after a settings change", async () => {
    const enabled = makePlugin({ enabled: true });
    const { result } = await mountReady([enabled]);
    queueListPlugins([enabled]);
    runtimeInstances[0].start.mockRejectedValueOnce(
      new Error("Synthetic reload failure"),
    );
    queueListPlugins([makePlugin({ enabled: false })]);

    let failure: unknown = null;
    await act(async () => {
      failure = await result.current
        .updateSettings(pluginId, { autoCommitIntervalMinutes: 15 })
        .catch((error: unknown) => error);
    });

    expect(failure).toEqual(
      expect.objectContaining({ message: "Synthetic reload failure" }),
    );
    expect(api.disablePlugin).toHaveBeenCalledWith(pluginId);
    expect(result.current.plugins).toEqual([makePlugin({ enabled: false })]);
  });

  it("leaves a disabled plugin unstarted when its settings change", async () => {
    const disabled = makePlugin({ enabled: false });
    const { result } = await mountReady([disabled]);
    queueListPlugins([disabled]);

    await act(async () => {
      await result.current.updateSettings(pluginId, {
        autoCommitIntervalMinutes: 0,
      });
    });

    expect(callOrder).toEqual(["listPlugins"]);
    expect(runtimeInstances[0].stop).not.toHaveBeenCalled();
    expect(runtimeInstances[0].start).not.toHaveBeenCalled();
  });
});
